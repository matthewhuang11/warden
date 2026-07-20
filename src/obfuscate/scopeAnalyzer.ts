import type Parser from 'web-tree-sitter';
import type { RenameMap } from './renameMap.js';

export type DeclKind = 'function' | 'variable' | 'class' | 'type' | 'property';

// A variable's computational role, inferred from its initializer's AST
// shape. Used only for 'variable' declarations, to pick a replacement name
// that reflects what the value actually is (e.g. a Math.max(0, ...) clamp
// should read as bounded in its fake domain too) instead of one drawn
// independently of role, which is how a clamped/floored quantity or a
// subtraction remainder previously ended up with a name implying a raw,
// unclamped value — the concrete finding that motivated this. 'passthrough'
// is the default for anything that isn't recognizably one of the others
// (a parameter echo, a field access, an opaque function call, ...).
export type VariableRole = 'passthrough' | 'clamped' | 'difference' | 'boolean' | 'accumulator';

export interface Declaration {
  id: string;
  originalName: string;
  kind: DeclKind;
  /** Only meaningful when kind === 'variable'. */
  role?: VariableRole;
}

// A site resolved to a declaration found in *this* parse ('decl'), or one
// that has no local binding at all but whose name was already established
// as renameable earlier in the session ('known') — e.g. a follow-up
// tool_result that merely calls a function declared in an earlier turn.
//
// `shorthandOriginalName` is set when the site is an object-literal
// shorthand property (`{ foo }`, meaning `{ foo: foo }`) whose single token
// serves as both key and value. Splicing the synthetic name in place of
// that token would rename the key too (corrupting e.g. `module.exports = {
// ApiClient }`), so these sites are rendered as an explicit `foo: synthetic`
// pair instead, preserving the real key.
export type RenameSite =
  | { startIndex: number; endIndex: number; via: 'decl'; declId: string; shorthandOriginalName?: string }
  | { startIndex: number; endIndex: number; via: 'known'; synthetic: string; shorthandOriginalName?: string };

export interface ScopeAnalysis {
  declarations: Declaration[];
  sites: RenameSite[];
}

interface Binding {
  id: string;
  name: string;
  renameable: boolean;
}

class Scope {
  private readonly bindings = new Map<string, Binding>();
  constructor(private readonly parent: Scope | null) {}

  declare(name: string, binding: Binding): void {
    this.bindings.set(name, binding);
  }

  lookup(name: string): Binding | undefined {
    let scope: Scope | null = this;
    while (scope) {
      const found = scope.bindings.get(name);
      if (found) return found;
      scope = scope.parent;
    }
    return undefined;
  }
}

// Node types that introduce a new function-like lexical scope for their
// parameters and body. A named function *expression*'s own name is only
// visible inside itself, so it's declared into that new scope rather than
// the enclosing one (function_declaration is the opposite: declared into
// the enclosing scope, since it's callable by siblings).
const NAMED_INTO_OWN_SCOPE = new Set(['function_expression', 'function', 'generator_function']);

const REFERENCE_TYPES = new Set(['identifier', 'shorthand_property_identifier', 'type_identifier']);

const CLAMPING_MATH_METHODS = new Set(['max', 'min', 'floor', 'ceil', 'round']);
const DIFFERENCE_OPERATORS = new Set(['-', '%']);
const BOOLEAN_OPERATORS = new Set(['==', '===', '!=', '!==', '<', '<=', '>', '>=', '&&', '||', '??']);
const ACCUMULATOR_MUTATING_METHODS = new Set(['push', 'unshift', 'splice', 'concat']);

function unwrapParens(node: Parser.SyntaxNode): Parser.SyntaxNode {
  let current = node;
  while (current.type === 'parenthesized_expression') {
    const inner = current.namedChild(0);
    if (!inner) break;
    current = inner;
  }
  return current;
}

// Best-effort: an identifier that's later the target of `x += ...`, `x++`,
// `x--`, or a known mutating array method call anywhere in the parse. Not
// scope-precise (matches by name, not by binding), but a false match only
// costs a slightly-off cosmetic name, never correctness — consistent with
// the rest of this file's "fail toward leaving it alone" posture.
function collectMutatedNames(root: Parser.SyntaxNode): Set<string> {
  const mutated = new Set<string>();
  function visit(node: Parser.SyntaxNode): void {
    if (node.type === 'augmented_assignment_expression') {
      const left = node.childForFieldName('left');
      if (left?.type === 'identifier') mutated.add(left.text);
    } else if (node.type === 'update_expression') {
      const argument = node.childForFieldName('argument');
      if (argument?.type === 'identifier') mutated.add(argument.text);
    } else if (node.type === 'call_expression') {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression') {
        const object = fn.childForFieldName('object');
        const property = fn.childForFieldName('property');
        if (object?.type === 'identifier' && property && ACCUMULATOR_MUTATING_METHODS.has(property.text)) {
          mutated.add(object.text);
        }
      }
    }
    for (const child of node.namedChildren) visit(child);
  }
  visit(root);
  return mutated;
}

// A "seed" initializer (0, [], {}, '') is what an accumulator is declared
// with before the loop that actually mutates it.
function isSeedValue(valueNode: Parser.SyntaxNode | null): boolean {
  if (!valueNode) return false;
  const node = unwrapParens(valueNode);
  if (node.type === 'number') return node.text === '0';
  if (node.type === 'array' || node.type === 'object') return node.namedChildren.length === 0;
  if (node.type === 'string' || node.type === 'template_string') return /^(?:""|''|``)$/.test(node.text);
  return false;
}

function classifyInitializerRole(valueNode: Parser.SyntaxNode | null): VariableRole {
  if (!valueNode) return 'passthrough';
  const node = unwrapParens(valueNode);

  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function');
    if (fn?.type === 'member_expression') {
      const object = fn.childForFieldName('object');
      const property = fn.childForFieldName('property');
      if (object?.text === 'Math' && property && CLAMPING_MATH_METHODS.has(property.text)) {
        return 'clamped';
      }
    }
    return 'passthrough';
  }

  if (node.type === 'binary_expression') {
    const operator = node.childForFieldName('operator')?.text;
    if (operator && DIFFERENCE_OPERATORS.has(operator)) return 'difference';
    if (operator && BOOLEAN_OPERATORS.has(operator)) return 'boolean';
    return 'passthrough';
  }

  if (node.type === 'unary_expression') {
    return node.childForFieldName('operator')?.text === '!' ? 'boolean' : 'passthrough';
  }

  if (node.type === 'true' || node.type === 'false') return 'boolean';

  return 'passthrough';
}

function classifyVariableRole(valueNode: Parser.SyntaxNode | null, name: string, mutatedNames: Set<string>): VariableRole {
  if (mutatedNames.has(name) && isSeedValue(valueNode)) return 'accumulator';
  return classifyInitializerRole(valueNode);
}

/**
 * Walks a tree-sitter TS/TSX syntax tree and resolves every identifier to
 * either a locally-declared binding (function/variable/class/type with a plain
 * name — eligible for renaming) or an opaque binding (imports, parameters,
 * destructured names, catch/loop variables — never renamed, but still
 * tracked so they correctly shadow outer scopes) or nothing at all (a free
 * reference to a global/builtin, left untouched).
 *
 * Two passes are required because declarations can be referenced before
 * their textual position (hoisting, forward calls between sibling
 * functions, closures): pass 1 populates every scope's bindings across the
 * whole tree, pass 2 resolves references against the now-complete scopes.
 *
 * `renameMap` is the session's persistent name -> synthetic mapping. A
 * reference that resolves to nothing in this parse (no local or opaque
 * binding anywhere up the scope chain) would normally be a free reference
 * to a global/builtin and is left alone — but if the session already
 * renamed this exact name in an earlier request (e.g. a function declared
 * in one file and merely called in another), reuse that synthetic name so
 * the same identifier stays consistent across turns instead of leaking the
 * real name on any turn that doesn't redeclare it.
 */
export function analyzeScopes(root: Parser.SyntaxNode, renameMap: RenameMap): ScopeAnalysis {
  const declarations: Declaration[] = [];
  const mutatedNames = collectMutatedNames(root);
  const propertyDeclIds = new Map<string, string>();
  // nodeId -> declId for renameable decl sites, or null for opaque decl sites.
  const declSiteNodeIds = new Map<number, string | null>();
  // nodeId -> the new scope introduced by that (scope-introducing) node.
  const nodeScopes = new Map<number, Scope>();
  let counter = 0;
  const nextId = () => `decl_${++counter}`;

  const rootScope = new Scope(null);
  nodeScopes.set(root.id, rootScope);

  function declareInPattern(patternNode: Parser.SyntaxNode, scope: Scope): void {
    switch (patternNode.type) {
      case 'identifier':
      case 'shorthand_property_identifier_pattern': {
        scope.declare(patternNode.text, { id: '', name: patternNode.text, renameable: false });
        declSiteNodeIds.set(patternNode.id, null);
        break;
      }
      case 'object_pattern': {
        for (const child of patternNode.namedChildren) {
          if (child.type === 'pair_pattern') {
            const value = child.childForFieldName('value');
            if (value) declareInPattern(value, scope);
          } else if (child.type === 'object_assignment_pattern') {
            const left = child.childForFieldName('left');
            if (left) declareInPattern(left, scope);
          } else if (child.type === 'rest_pattern') {
            const arg = child.namedChild(0);
            if (arg) declareInPattern(arg, scope);
          } else {
            declareInPattern(child, scope);
          }
        }
        break;
      }
      case 'array_pattern': {
        for (const child of patternNode.namedChildren) {
          declareInPattern(child, scope);
        }
        break;
      }
      case 'assignment_pattern': {
        const left = patternNode.childForFieldName('left');
        if (left) declareInPattern(left, scope);
        break;
      }
      case 'rest_pattern': {
        const arg = patternNode.namedChild(0);
        if (arg) declareInPattern(arg, scope);
        break;
      }
      default:
        // Unrecognized pattern shape: nothing to declare, fail toward
        // leaving it alone rather than guessing.
        break;
    }
  }

  function declareParameterList(paramsNode: Parser.SyntaxNode, scope: Scope): void {
    for (const child of paramsNode.namedChildren) {
      const pattern = child.childForFieldName('pattern');
      if (pattern) {
        declareInPattern(pattern, scope);
      } else if (child.type === 'identifier') {
        declareInPattern(child, scope);
      }
      // Anything else (e.g. a TS `this` parameter, decorators) is skipped.
    }
  }

  function declareRenameable(nameNode: Parser.SyntaxNode, scope: Scope, kind: DeclKind, role?: VariableRole): void {
    const id = nextId();
    scope.declare(nameNode.text, { id, name: nameNode.text, renameable: true });
    declSiteNodeIds.set(nameNode.id, id);
    declarations.push({ id, originalName: nameNode.text, kind, role });
  }

  function declareOpaque(nameNode: Parser.SyntaxNode, scope: Scope): void {
    scope.declare(nameNode.text, { id: '', name: nameNode.text, renameable: false });
    declSiteNodeIds.set(nameNode.id, null);
  }

  function declareProperty(nameNode: Parser.SyntaxNode): void {
    let id = propertyDeclIds.get(nameNode.text);
    if (!id) {
      id = nextId();
      propertyDeclIds.set(nameNode.text, id);
      declarations.push({ id, originalName: nameNode.text, kind: 'property' });
    }
    declSiteNodeIds.set(nameNode.id, id);
  }

  function walkDeclare(node: Parser.SyntaxNode, scope: Scope): void {
    switch (node.type) {
      case 'function_declaration':
      case 'generator_function_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) declareRenameable(nameNode, scope, 'function');
        const fnScope = new Scope(scope);
        nodeScopes.set(node.id, fnScope);
        const params = node.childForFieldName('parameters');
        if (params) declareParameterList(params, fnScope);
        const body = node.childForFieldName('body');
        if (body) walkDeclare(body, fnScope);
        return;
      }
      case 'function_expression':
      case 'function':
      case 'generator_function':
      case 'arrow_function': {
        const fnScope = new Scope(scope);
        nodeScopes.set(node.id, fnScope);
        const nameNode = node.childForFieldName('name');
        if (nameNode && NAMED_INTO_OWN_SCOPE.has(node.type)) {
          declareRenameable(nameNode, fnScope, 'function');
        }
        const params = node.childForFieldName('parameters');
        if (params) {
          declareParameterList(params, fnScope);
        } else {
          const bareParam = node.childForFieldName('parameter');
          if (bareParam) declareInPattern(bareParam, fnScope);
        }
        const body = node.childForFieldName('body');
        if (body) walkDeclare(body, fnScope);
        return;
      }
      case 'method_definition': {
        const fnScope = new Scope(scope);
        nodeScopes.set(node.id, fnScope);
        const params = node.childForFieldName('parameters');
        if (params) declareParameterList(params, fnScope);
        const body = node.childForFieldName('body');
        if (body) walkDeclare(body, fnScope);
        // The method's own name is a property, not a variable — never renamed.
        return;
      }
      case 'class_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) declareRenameable(nameNode, scope, 'class');
        for (const child of node.namedChildren) {
          if (child.id === nameNode?.id) continue;
          walkDeclare(child, scope);
        }
        return;
      }
      case 'interface_declaration':
      case 'type_alias_declaration': {
        const nameNode = node.childForFieldName('name');
        if (nameNode) declareRenameable(nameNode, scope, 'type');
        for (const child of node.namedChildren) {
          if (child.id === nameNode?.id) continue;
          walkDeclare(child, scope);
        }
        return;
      }
      case 'property_signature': {
        const nameNode = node.childForFieldName('name');
        if (nameNode?.type === 'property_identifier') declareProperty(nameNode);
        for (const child of node.namedChildren) {
          if (child.id !== nameNode?.id) walkDeclare(child, scope);
        }
        return;
      }
      case 'catch_clause': {
        const catchScope = new Scope(scope);
        nodeScopes.set(node.id, catchScope);
        const param = node.childForFieldName('parameter');
        if (param) declareInPattern(param, catchScope);
        const body = node.childForFieldName('body');
        if (body) walkDeclare(body, catchScope);
        return;
      }
      case 'for_statement': {
        const loopScope = new Scope(scope);
        nodeScopes.set(node.id, loopScope);
        for (const child of node.namedChildren) {
          walkDeclare(child, loopScope);
        }
        return;
      }
      case 'for_in_statement': {
        const loopScope = new Scope(scope);
        nodeScopes.set(node.id, loopScope);
        const kind = node.childForFieldName('kind');
        const left = node.childForFieldName('left');
        if (kind && left) declareInPattern(left, loopScope);
        const right = node.childForFieldName('right');
        if (right) walkDeclare(right, loopScope);
        const body = node.childForFieldName('body');
        if (body) walkDeclare(body, loopScope);
        return;
      }
      case 'import_specifier': {
        const nameNode = node.childForFieldName('name');
        const aliasNode = node.childForFieldName('alias');
        const bindingNode = aliasNode ?? nameNode;
        if (bindingNode) declareOpaque(bindingNode, scope);
        if (aliasNode && nameNode && nameNode.id !== bindingNode?.id) {
          // The imported (external) name is not a local reference site at
          // all — mark it opaque too so pass 2 never tries to resolve it.
          declSiteNodeIds.set(nameNode.id, null);
        }
        return;
      }
      case 'namespace_import': {
        const nameNode = node.namedChildren[node.namedChildren.length - 1];
        if (nameNode) declareOpaque(nameNode, scope);
        return;
      }
      case 'import_clause': {
        for (const child of node.namedChildren) {
          if (child.type === 'identifier') {
            declareOpaque(child, scope);
          } else {
            walkDeclare(child, scope);
          }
        }
        return;
      }
      case 'lexical_declaration':
      case 'variable_declaration': {
        for (const child of node.namedChildren) {
          if (child.type !== 'variable_declarator') continue;
          const nameNode = child.childForFieldName('name');
          const valueNode = child.childForFieldName('value');
          if (nameNode) {
            if (nameNode.type === 'identifier') {
              declareRenameable(nameNode, scope, 'variable', classifyVariableRole(valueNode, nameNode.text, mutatedNames));
            } else {
              declareInPattern(nameNode, scope);
            }
          }
          if (valueNode) walkDeclare(valueNode, scope);
        }
        return;
      }
      default: {
        for (const child of node.namedChildren) {
          walkDeclare(child, scope);
        }
      }
    }
  }

  const sites: RenameSite[] = [];

  function walkResolve(node: Parser.SyntaxNode, scope: Scope): void {
    const ownScope = nodeScopes.get(node.id);
    const childScope = ownScope ?? scope;

    if (declSiteNodeIds.has(node.id)) {
      const declId = declSiteNodeIds.get(node.id);
      if (declId) {
        sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, via: 'decl', declId });
      }
      return;
    }

    if (node.type === 'property_identifier') {
      const parent = node.parent;
      const isPropertySite =
        (parent?.type === 'member_expression' && parent.childForFieldName('property')?.id === node.id) ||
        (parent?.type === 'pair' && parent.childForFieldName('key')?.id === node.id);
      const declId = isPropertySite ? propertyDeclIds.get(node.text) : undefined;
      const known = isPropertySite ? renameMap.get(node.text) : undefined;
      if (declId) sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, via: 'decl', declId });
      else if (known) sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, via: 'known', synthetic: known });
      return;
    }

    if (REFERENCE_TYPES.has(node.type)) {
      const shorthandOriginalName =
        node.type === 'shorthand_property_identifier' && !propertyDeclIds.has(node.text) ? node.text : undefined;
      const binding = scope.lookup(node.text);
      if (binding) {
        if (binding.renameable) {
          sites.push({
            startIndex: node.startIndex,
            endIndex: node.endIndex,
            via: 'decl',
            declId: binding.id,
            shorthandOriginalName,
          });
        }
        return;
      }

      // No binding anywhere in the scope chain — a genuine free reference
      // within this parse. Only rename it if the session already committed
      // to a synthetic name for this exact identifier text elsewhere.
      const known = renameMap.get(node.text);
      if (known) {
        sites.push({
          startIndex: node.startIndex,
          endIndex: node.endIndex,
          via: 'known',
          synthetic: known,
          shorthandOriginalName,
        });
      }
      return;
    }

    for (const child of node.namedChildren) {
      walkResolve(child, childScope);
    }
  }

  walkDeclare(root, rootScope);
  walkResolve(root, rootScope);

  return { declarations, sites };
}
