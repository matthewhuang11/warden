import type Parser from 'web-tree-sitter';
import { getParser, type Dialect } from './grammar.js';
import { analyzeScopes } from './scopeAnalyzer.js';
import { applyRenames } from './applyRenames.js';
import type { RenameMap } from './renameMap.js';
import { stripLineNumberPrefixes, restoreLineNumberPrefixes } from './lineNumberFormat.js';
import { logger } from '../log.js';

export interface ObfuscateResult {
  output: string;
  renamed: boolean;
  renamedCount: number;
  dialect: Dialect | null;
}

const DIALECT_ATTEMPT_ORDER: Dialect[] = ['typescript', 'tsx'];

const DEBUG_LOG_MIN_LENGTH = 1000;
const DEBUG_LOG_PREVIEW_LENGTH = 300;

// tree-sitter parse time doesn't stay linear at real-world scale (measured
// ~660ms at 5k lines, ~1.3s at 10k, ~15s at 40k on this machine) and runs
// synchronously on Node's single event loop thread — a large generated or
// vendored file would block every other in-flight request for that whole
// duration. Bailing out above a line-count ceiling keeps that worst case
// bounded and cheap to check (a single char scan, ~20ms even at 200k lines)
// well before we'd pay for a parse attempt.
const MAX_OBFUSCATABLE_LINES = 5000;

// Counts lines without allocating an array of substrings (unlike
// `text.split('\n').length`), so it stays cheap even on pathologically
// large input — exactly the case this guard exists to protect against.
function countLines(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count++;
  }
  return count;
}

// tree-sitter is error-tolerant: a bad parse doesn't throw, it embeds ERROR
// or MISSING nodes in the tree. Walk the tree to find the first one so we
// can see what the parser actually choked on.
function findFirstErrorNode(node: Parser.SyntaxNode): Parser.SyntaxNode | null {
  if (node.isError || node.isMissing) return node;
  for (const child of node.children) {
    const found = findFirstErrorNode(child);
    if (found) return found;
  }
  return null;
}

function logParseFailureDetail(dialect: Dialect, source: string, tree: Parser.Tree): void {
  if (source.length <= DEBUG_LOG_MIN_LENGTH) return;
  const errorNode = findFirstErrorNode(tree.rootNode);
  logger.warn('obfuscate.parse_error_detail', {
    dialect,
    sourceLength: source.length,
    errorType: errorNode?.type ?? null,
    isMissing: errorNode?.isMissing ?? null,
    startPosition: errorNode?.startPosition ?? null,
    endPosition: errorNode?.endPosition ?? null,
    startIndex: errorNode?.startIndex ?? null,
    endIndex: errorNode?.endIndex ?? null,
    errorText: errorNode ? errorNode.text.slice(0, 200) : null,
    sourcePreview: source.slice(0, DEBUG_LOG_PREVIEW_LENGTH),
  });
}

/**
 * Best-effort obfuscation of one code block. Tries the typescript grammar
 * first, falls back to tsx (for JSX syntax), and if both parses come back
 * with syntax errors, returns the source untouched — renaming from a
 * broken parse risks corrupting code, which is worse than not obfuscating.
 */
export async function obfuscateCode(source: string, renameMap: RenameMap): Promise<ObfuscateResult> {
  const lineCount = countLines(source);
  if (lineCount > MAX_OBFUSCATABLE_LINES) {
    logger.warn('obfuscate.skipped_too_large', {
      sourceLength: source.length,
      lineCount,
      maxLines: MAX_OBFUSCATABLE_LINES,
    });
    return { output: source, renamed: false, renamedCount: 0, dialect: null };
  }

  const lineNumbered = stripLineNumberPrefixes(source);
  const workingSource = lineNumbered ? lineNumbered.source : source;

  for (const dialect of DIALECT_ATTEMPT_ORDER) {
    const parser = await getParser(dialect);
    const tree = parser.parse(workingSource);
    if (tree.rootNode.hasError) {
      logParseFailureDetail(dialect, workingSource, tree);
      continue;
    }

    const analysis = analyzeScopes(tree.rootNode, renameMap);
    const { output, renamedCount } = applyRenames(workingSource, analysis, renameMap);
    const restored = lineNumbered ? restoreLineNumberPrefixes(output, lineNumbered.prefixes) : output;
    if (restored === null) {
      logger.warn('obfuscate.line_number_restore_failed', { sourceLength: source.length });
      return { output: source, renamed: false, renamedCount: 0, dialect: null };
    }

    logger.info('obfuscate.applied', {
      dialect,
      declarations: analysis.declarations.length,
      renamedCount,
      lineNumbered: lineNumbered !== null,
    });
    return { output: restored, renamed: renamedCount > 0, renamedCount, dialect };
  }

  logger.warn('obfuscate.parse_failed', { sourceLength: source.length, lineNumbered: lineNumbered !== null });
  return { output: source, renamed: false, renamedCount: 0, dialect: null };
}
