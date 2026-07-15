import type Parser from 'web-tree-sitter';
import type { RenameMap } from './renameMap.js';

export type DeclKind = 'function' | 'variable' | 'class';

export interface Declaration {
  id: string;
  originalName: string;
  kind: DeclKind;
}

// A site resolved to a declaration found in *this* parse ('decl'), or one
// that has no local binding at all but whose name was already established
// as renameable earlier in the session ('known') — e.g. a follow-up
// tool_result that merely calls a function declared in an earlier turn.
export type RenameSite =
  | { startIndex: number; endIndex: number; via: 'decl'; declId: string }
  | { startIndex: number; endIndex: number; via: 'known'; synthetic: string };

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

/**
 * Walks a tree-sitter TS/TSX syntax tree and resolves every identifier to
 * either a locally-declared binding (function/variable/class with a plain
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

  function declareRenameable(nameNode: Parser.SyntaxNode, scope: Scope, kind: DeclKind): void {
    const id = nextId();
    scope.declare(nameNode.text, { id, name: nameNode.text, renameable: true });
    declSiteNodeIds.set(nameNode.id, id);
    declarations.push({ id, originalName: nameNode.text, kind });
  }

  function declareOpaque(nameNode: Parser.SyntaxNode, scope: Scope): void {
    scope.declare(nameNode.text, { id: '', name: nameNode.text, renameable: false });
    declSiteNodeIds.set(nameNode.id, null);
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
              declareRenameable(nameNode, scope, 'variable');
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

    if (REFERENCE_TYPES.has(node.type)) {
      const binding = scope.lookup(node.text);
      if (binding) {
        if (binding.renameable) {
          sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, via: 'decl', declId: binding.id });
        }
        return;
      }

      // No binding anywhere in the scope chain — a genuine free reference
      // within this parse. Only rename it if the session already committed
      // to a synthetic name for this exact identifier text elsewhere.
      const known = renameMap.get(node.text);
      if (known) {
        sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, via: 'known', synthetic: known });
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
