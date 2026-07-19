import type Parser from 'web-tree-sitter';
import { getParser, type Dialect } from './grammar.js';
import { analyzeScopes } from './scopeAnalyzer.js';
import { applyRenames } from './applyRenames.js';
import { redactSensitiveText } from './redactSensitiveText.js';
import type { RenameMap } from './renameMap.js';
import { stripLineNumberPrefixes, restoreLineNumberPrefixes } from './lineNumberFormat.js';
import { logger } from '../log.js';
import { config } from '../config.js';
import { createAuditEvent, type AuditEvent } from '../audit/auditTypes.js';

export interface ObfuscateResult {
  output: string;
  /** True if anything was changed at all — identifier renames, redacted
   * comments, or redacted strings. Check the specific counts below to see
   * which. */
  renamed: boolean;
  renamedCount: number;
  dialect: Dialect | null;
  commentsRedacted: number;
  stringsRedacted: number;
  auditEvents: AuditEvent[];
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

function collectIdentifierLikeNames(text: string): Set<string> {
  return new Set(text.match(/[A-Za-z_$][\w$]*/g) ?? []);
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
    return {
      output: source,
      renamed: false,
      renamedCount: 0,
      dialect: null,
      commentsRedacted: 0,
      stringsRedacted: 0,
      auditEvents: [],
    };
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

    // Comment/string redaction runs as its own independent pass, on its own
    // parse of the original text — it never touches scopeAnalyzer/applyRenames
    // or the offsets they compute. Its (re-parseable) output is simply handed
    // to the existing identifier-renaming pipeline below as if it were the
    // original source.
    renameMap.setForbiddenNames(collectIdentifierLikeNames(workingSource));
    const redaction = redactSensitiveText(workingSource, tree.rootNode, renameMap, {
      redactComments: config.redactComments,
      redactStrings: config.redactStrings,
    });

    let renameTree = tree;
    let renameSource = workingSource;
    if (redaction.output !== workingSource) {
      const reparsed = parser.parse(redaction.output);
      if (reparsed.rootNode.hasError) {
        // Should not happen (redaction only swaps comment/string contents
        // for same-shape placeholders), but if it ever did, silently
        // falling back to the pre-redaction tree/text is safer than either
        // crashing or renaming against offsets that no longer line up.
        logger.warn('obfuscate.redaction_reparse_failed', { dialect, sourceLength: source.length });
      } else {
        renameTree = reparsed;
        renameSource = redaction.output;
      }
    }

    const analysis = analyzeScopes(renameTree.rootNode, renameMap);
    const auditEvents = [
      ...analysis.declarations.map((declaration) => createAuditEvent('identifier', declaration.originalName)),
      ...redaction.auditEvents,
    ];
    const { output, renamedCount } = applyRenames(renameSource, analysis, renameMap);
    renameMap.clearForbiddenNames();
    const restored = lineNumbered ? restoreLineNumberPrefixes(output, lineNumbered.prefixes) : output;
    if (restored === null) {
      logger.warn('obfuscate.line_number_restore_failed', { sourceLength: source.length });
      return {
        output: source,
        renamed: false,
        renamedCount: 0,
        dialect: null,
        commentsRedacted: 0,
        stringsRedacted: 0,
        auditEvents: [],
      };
    }

    logger.info('obfuscate.applied', {
      dialect,
      declarations: analysis.declarations.length,
      renamedCount,
      commentsRedacted: redaction.commentsRedacted,
      stringsRedacted: redaction.stringsRedacted,
      auditEvents,
      lineNumbered: lineNumbered !== null,
    });
    return {
      output: restored,
      renamed: renamedCount > 0 || redaction.commentsRedacted > 0 || redaction.stringsRedacted > 0,
      renamedCount,
      dialect,
      commentsRedacted: redaction.commentsRedacted,
      stringsRedacted: redaction.stringsRedacted,
      auditEvents,
    };
  }

  logger.warn('obfuscate.parse_failed', { sourceLength: source.length, lineNumbered: lineNumbered !== null });
  return {
    output: source,
    renamed: false,
    renamedCount: 0,
    dialect: null,
    commentsRedacted: 0,
    stringsRedacted: 0,
    auditEvents: [],
  };
}
