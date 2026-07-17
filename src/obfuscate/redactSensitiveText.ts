import type Parser from 'web-tree-sitter';
import type { RenameMap } from './renameMap.js';

export interface RedactionOptions {
  redactComments: boolean;
  redactStrings: boolean;
}

export interface RedactionResult {
  output: string;
  commentsRedacted: number;
  stringsRedacted: number;
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
 * always left alone even if they'd otherwise qualify, because those are
 * places where the *exact* string value is load-bearing for control flow
 * the model needs to see. When genuinely unsure, this leans toward NOT
 * redacting.
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

  function walk(node: Parser.SyntaxNode): void {
    if (options.redactComments && node.type === 'comment') {
      sites.push({
        startIndex: node.startIndex,
        endIndex: node.endIndex,
        replacement: buildCommentPlaceholder(node.text),
      });
      commentsRedacted += 1;
      return;
    }

    if (node.type === 'string') {
      if (options.redactStrings && shouldRedactString(node)) {
        // Replace only the content between the quote characters (each
        // exactly one byte), never the quotes themselves — this preserves
        // the original quote style for free and means the placeholder
        // token can be a plain word, safe for the same word-boundary
        // rehydration regex already used for identifiers.
        const rawContent = node.text.slice(1, -1);
        const token = renameMap.getOrCreate(rawContent, 'string');
        sites.push({ startIndex: node.startIndex + 1, endIndex: node.endIndex - 1, replacement: token });
        stringsRedacted += 1;
      }
      return; // nothing further inside a plain string is reachable/relevant
    }

    for (const child of node.children) {
      walk(child);
    }
  }

  walk(root);

  if (sites.length === 0) {
    return { output: source, commentsRedacted: 0, stringsRedacted: 0 };
  }

  sites.sort((a, b) => b.startIndex - a.startIndex);
  let output = source;
  for (const site of sites) {
    output = output.slice(0, site.startIndex) + site.replacement + output.slice(site.endIndex);
  }

  return { output, commentsRedacted, stringsRedacted };
}

function shouldRedactString(stringNode: Parser.SyntaxNode): boolean {
  const content = stringNode.text.slice(1, -1);
  if (content.length < MIN_STRING_LENGTH) return false;
  if (!isMultiWord(content)) return false;
  if (isStructuralContext(stringNode)) return false;
  return true;
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

/** `//` comments are always exactly one physical line, but `/* *\/` block
 * comments can span several — the placeholder must preserve the same
 * newline count, or a line-numbered source (see lineNumberFormat.ts) would
 * fail its line-count check and the whole block would fall back to
 * completely untouched (identifier renaming included), which would be a
 * worse outcome than just redacting the comment. */
function buildCommentPlaceholder(originalText: string): string {
  if (originalText.startsWith('//')) {
    return '// [redacted]';
  }
  const newlineCount = (originalText.match(/\n/g) ?? []).length;
  if (newlineCount === 0) return '/* [redacted] */';
  return `/* [redacted]${'\n'.repeat(newlineCount - 1)}\n*/`;
}
