import type Parser from 'web-tree-sitter';
import type { RenameMap } from './renameMap.js';
import { createAuditEvent, type AuditEvent } from '../audit/auditTypes.js';

export interface RedactionOptions {
  redactComments: boolean;
  redactStrings: boolean;
}

export interface RedactionResult {
  output: string;
  commentsRedacted: number;
  stringsRedacted: number;
  derivedConstantsRedacted: number;
  auditEvents: AuditEvent[];
}

// Strings shorter than this are almost always structural (flags, short
// keys, technical tokens) rather than business prose — leave them alone.
const MIN_STRING_LENGTH = 15;

// Comparison operators only — deliberately excludes +, &&, ||, etc., which
// aren't "a string used in a conditional check" in the sense that matters
// here (matching/branching on the string's exact value).
const COMPARISON_OPERATORS = new Set(['==', '===', '!=', '!==', '<', '>', '<=', '>=']);

/**
 * Redacts comment text and long, business-prose-looking string literals
 * from a parsed JS/TS tree, independently of and prior to identifier
 * renaming (see obfuscateCode.ts: this runs on its own parse pass, and its
 * output is re-parsed for scope analysis, so scopeAnalyzer/applyRenames
 * never need to know this exists).
 *
 * Comments are always fully replaced (case (1)) — they're pure
 * documentation, the model doesn't need their content to reason about the
 * code. Strings are much more conservative (case (2)): only long,
 * multi-word literals are touched, and several structural contexts (import
 * paths, object keys, JSX attribute values, comparisons/switch values) are
 * left alone by the prose heuristic. Short values explicitly declared in a
 * local interface contract are instead replaced consistently at every site,
 * preserving control-flow relationships without exposing the domain token.
 */
export function redactSensitiveText(
  source: string,
  root: Parser.SyntaxNode,
  renameMap: RenameMap,
  options: RedactionOptions,
): RedactionResult {
  const sites: { startIndex: number; endIndex: number; replacement: string }[] = [];
  let commentsRedacted = 0;
  let stringsRedacted = 0;
  let derivedConstantsRedacted = 0;
  const auditEvents: AuditEvent[] = [];
  const derivedSites = options.redactStrings ? findDerivedConstantSites(root, renameMap) : new Map<number, string>();
  const contractLiterals = options.redactStrings ? findContractLiterals(root) : new Set<string>();

  function walk(node: Parser.SyntaxNode): void {
    const derivedReplacement = derivedSites.get(node.id);
    if (derivedReplacement !== undefined) {
      sites.push({ startIndex: node.startIndex, endIndex: node.endIndex, replacement: derivedReplacement });
      derivedConstantsRedacted += 1;
      return;
    }

    if (options.redactComments && node.type === 'comment') {
      sites.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        // commentsRedacted (pre-increment) varies the phrase picked across
        // successive comments even when they're the same length, so the
        // same source doesn't produce the same placeholder at every site.
        replacement: buildCommentPlaceholder(node.text, commentsRedacted, renameMap.isStealth),
      });
      commentsRedacted += 1;
      auditEvents.push(createAuditEvent('comment', node.text));
      return;
    }

    if (node.type === 'string') {
      const rawContent = node.text.slice(1, -1);
      const isContractLiteral = contractLiterals.has(rawContent) && !isImportOrExportSource(node);
      if (options.redactStrings && (shouldRedactString(node) || isContractLiteral)) {
        // Replace only the content between the quote characters (each
        // exactly one byte), never the quotes themselves — this preserves
        // the original quote style for free and means the placeholder
        // token can be a plain word, safe for the same word-boundary
        // rehydration regex already used for identifiers.
        const token = renameMap.getOrCreate(rawContent, isContractLiteral ? 'literal' : 'string');
        sites.push({ startIndex: node.startIndex + 1, endIndex: node.endIndex - 1, replacement: token });
        stringsRedacted += 1;
        auditEvents.push(createAuditEvent('string', rawContent));
      }
      return; // nothing further inside a plain string is reachable/relevant
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  if (sites.length === 0) {
    return {
      output: source,
      commentsRedacted: 0,
      stringsRedacted: 0,
      derivedConstantsRedacted: 0,
      auditEvents: [],
    };
  }

  sites.sort((a, b) => b.startIndex - a.startIndex);
  let output = source;
  for (const site of sites) {
    output = output.slice(0, site.startIndex) + site.replacement + output.slice(site.endIndex);
  }

  return { output, commentsRedacted, stringsRedacted, derivedConstantsRedacted, auditEvents };
}

/** Collects string values declared as part of an interface contract, then
 * lets the main walk replace those values consistently everywhere in the
 * file. This preserves branch semantics while hiding short domain states. */
function findContractLiterals(root: Parser.SyntaxNode): Set<string> {
  const values = new Set<string>();

  function collectStrings(node: Parser.SyntaxNode): void {
    if (node.type === 'string') {
      values.add(node.text.slice(1, -1));
      return;
    }
    for (const child of node.namedChildren) collectStrings(child);
  }

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'property_signature') {
      const typeNode = node.childForFieldName('type');
      if (typeNode) collectStrings(typeNode);
      return;
    }
    for (const child of node.namedChildren) walk(child);
  }

  walk(root);
  return values;
}

/** Finds top-level const initializers whose value is derived solely from
 * the UTF-16 length of a qualifying sensitive string. Restricting this to
 * one lexical scope avoids guessing across shadowed names; escaped string
 * literals are skipped because their runtime length cannot be recovered
 * safely from source bytes without evaluating code. */
function findDerivedConstantSites(root: Parser.SyntaxNode, renameMap: RenameMap): Map<number, string> {
  const sensitiveConstLengths = new Map<string, number>();
  const declarators: Parser.SyntaxNode[] = [];

  for (const topLevelNode of root.namedChildren) {
    const declaration = unwrapTopLevelLexicalDeclaration(topLevelNode);
    if (!declaration || declaration.children[0]?.text !== 'const') continue;

    for (const child of declaration.namedChildren) {
      if (child.type !== 'variable_declarator') continue;
      declarators.push(child);
      const nameNode = child.childForFieldName('name');
      const valueNode = child.childForFieldName('value');
      if (nameNode?.type !== 'identifier' || valueNode?.type !== 'string') continue;
      const content = unescapedStringContent(valueNode);
      if (content !== null && shouldRedactString(valueNode)) {
        sensitiveConstLengths.set(nameNode.text, content.length);
      }
    }
  }

  const sites = new Map<number, string>();
  for (const declarator of declarators) {
    const valueNode = declarator.childForFieldName('value');
    if (!valueNode || valueNode.type !== 'member_expression') continue;
    const objectNode = valueNode.childForFieldName('object');
    const propertyNode = valueNode.childForFieldName('property');
    if (!objectNode || propertyNode?.text !== 'length') continue;

    let derivedLength: number | undefined;
    if (objectNode.type === 'identifier') {
      derivedLength = sensitiveConstLengths.get(objectNode.text);
    } else if (objectNode.type === 'string' && shouldRedactString(objectNode)) {
      derivedLength = unescapedStringContent(objectNode)?.length;
    }
    if (derivedLength === undefined) continue;

    const replacement = renameMap.registerExactReplacement(valueNode.text, String(derivedLength));
    if (replacement !== undefined) sites.set(valueNode.id, replacement);
  }
  return sites;
}

function unwrapTopLevelLexicalDeclaration(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (node.type === 'lexical_declaration') return node;
  if (node.type !== 'export_statement') return null;
  return node.namedChildren.find((child) => child.type === 'lexical_declaration') ?? null;
}

function unescapedStringContent(stringNode: Parser.SyntaxNode): string | null {
  const content = stringNode.text.slice(1, -1);
  return content.includes('\\') ? null : content;
}

function shouldRedactString(stringNode: Parser.SyntaxNode): boolean {
  const content = stringNode.text.slice(1, -1);
  if (content.length < MIN_STRING_LENGTH) return false;
  if (isMachineToken(content)) return false;
  if (!isMultiWord(content)) return false;
  if (isStructuralContext(stringNode)) return false;
  return true;
}

function isMachineToken(content: string): boolean {
  return /^[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+$/.test(content);
}

function isMultiWord(content: string): boolean {
  const words = content.split(/[ _]+/).filter((w) => w.length > 0);
  return words.length >= 2;
}

/** Contexts where the exact string value is structural/load-bearing rather
 * than human-readable business prose: import/export sources, object keys,
 * JSX attribute values, and comparison/switch values. */
function isStructuralContext(stringNode: Parser.SyntaxNode): boolean {
  const parent = stringNode.parent;
  if (!parent) return false;

  if (
    (parent.type === 'import_statement' || parent.type === 'export_statement') &&
    parent.childForFieldName('source')?.id === stringNode.id
  ) {
    return true;
  }

  if (parent.type === 'pair' && parent.childForFieldName('key')?.id === stringNode.id) {
    return true;
  }

  if (parent.type === 'jsx_attribute') {
    return true;
  }

  if (parent.type === 'binary_expression') {
    const operator = parent.childForFieldName('operator')?.text;
    if (operator && COMPARISON_OPERATORS.has(operator)) return true;
  }

  if (parent.type === 'switch_case' && parent.childForFieldName('value')?.id === stringNode.id) {
    return true;
  }

  return false;
}

function isImportOrExportSource(stringNode: Parser.SyntaxNode): boolean {
  const parent = stringNode.parent;
  return Boolean(
    parent &&
      (parent.type === 'import_statement' || parent.type === 'export_statement') &&
      parent.childForFieldName('source')?.id === stringNode.id,
  );
}

// Generic, innocuous phrases a real developer plausibly could have
// written — bucketed roughly by length so the placeholder's visual "shape"
// stays in the same ballpark as whatever it's replacing, rather than e.g.
// a five-word comment collapsing to a two-word placeholder. Never derived
// from the real comment's words, only its length, so nothing about the
// original content leaks through even indirectly.
const COMPACT_SHORT_PHRASES = ['internal only', 'see below', 'helper logic', 'not user-facing', 'todo: revisit'];
const COMPACT_MEDIUM_PHRASES = [
  'see implementation below',
  'internal logic, not user-facing',
  'handles edge cases internally',
  'utility function, see usage',
  'kept for backwards compatibility',
];
const COMPACT_LONG_PHRASES = [
  'additional internal implementation details are handled here',
  'see the internal implementation for further context',
  'this section contains logic not relevant to the current task',
  'refactor candidate, revisit when touching this area next',
  'internal helper retained for legacy callers, do not remove',
];

const STEALTH_SHORT_PHRASES = ['normalizes input', 'keeps this local', 'handles this case', 'sets the value', 'shared path'];
const STEALTH_MEDIUM_PHRASES = [
  'keeps this path consistent',
  'normalizes the value before use',
  'shared behavior for this branch',
  'keeps related setup together',
  'handles the surrounding state',
];
const STEALTH_LONG_PHRASES = [
  'the remaining details are handled in this section',
  'this path keeps the surrounding behavior consistent',
  'additional setup is kept close to the call site',
  'related processing stays contained in this section',
  'the surrounding flow is kept together here',
];

const SHORT_MAX_LENGTH = 20;
const MEDIUM_MAX_LENGTH = 45;

function pickPhrase(pool: string[], seed: number): string {
  return pool[((seed % pool.length) + pool.length) % pool.length];
}

// A simple, non-reversible fingerprint of the comment's text (bounded so it
// stays a small, well-behaved integer) — used only to pick an index among
// ~5 pool phrases. Many different comments map to the same bucket index, so
// this can't be used to recover anything about the original text; it just
// means two comments of the same length in two different files don't
// deterministically pick the identical phrase the way a pure length+position
// seed would.
function simpleFingerprint(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) % 1_000_003;
  }
  return hash;
}

/** `//` comments are always exactly one physical line, but `/* *\/` block
 * comments can span several — the placeholder must preserve the same
 * newline count, or a line-numbered source (see lineNumberFormat.ts) would
 * fail its line-count check and the whole block would fall back to
 * completely untouched (identifier renaming included), which would be a
 * worse outcome than just redacting the comment. The chosen phrase itself
 * varies by original length, a content fingerprint, and position (see
 * pickPhrase/simpleFingerprint) — never by the original text's actual
 * words — so repeated redactions don't all produce the identical,
 * obviously-synthetic string. */
function buildCommentPlaceholder(originalText: string, index: number, stealth: boolean): string {
  const seed = simpleFingerprint(originalText) + index;

  if (originalText.startsWith('//')) {
    const contentLength = originalText.length - 2;
    return `// ${pickPhrase(phrasePoolFor(contentLength, stealth), seed)}`;
  }

  const newlineCount = (originalText.match(/\n/g) ?? []).length;
  const contentLength = originalText.length - 4; // minus "/*" and "*/"
  const phrase = pickPhrase(phrasePoolFor(contentLength, stealth), seed);

  if (newlineCount === 0) return `/* ${phrase} */`;
  return `/* ${phrase}${'\n'.repeat(newlineCount - 1)}\n*/`;
}

function phrasePoolFor(contentLength: number, stealth: boolean): string[] {
  if (contentLength <= SHORT_MAX_LENGTH) return stealth ? STEALTH_SHORT_PHRASES : COMPACT_SHORT_PHRASES;
  if (contentLength <= MEDIUM_MAX_LENGTH) return stealth ? STEALTH_MEDIUM_PHRASES : COMPACT_MEDIUM_PHRASES;
  return stealth ? STEALTH_LONG_PHRASES : COMPACT_LONG_PHRASES;
}
