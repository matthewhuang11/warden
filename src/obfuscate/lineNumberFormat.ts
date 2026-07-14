const LINE_PREFIX_RE = /^(\s*\d+)\t/;

export interface LineNumberFormat {
  source: string;
  prefixes: string[];
}

/**
 * Detects and strips the "cat -n"-style line-number prefixes that Claude
 * Code's Read tool prepends to every line (e.g. "     1\timport foo;").
 * Tree-sitter can't parse text with these prefixes, so tool_result content
 * that echoes a Read needs them stripped before obfuscation and restored
 * afterward. Requires every line to carry a strictly-increasing prefix so
 * we don't misfire on code that merely starts a line with a numeric literal.
 */
export function stripLineNumberPrefixes(source: string): LineNumberFormat | null {
  if (source.length === 0) return null;
  const lines = source.split('\n');
  if (lines.length < 2) return null;

  const prefixes: string[] = [];
  const stripped: string[] = [];
  let previousNumber: number | null = null;

  for (const line of lines) {
    const match = LINE_PREFIX_RE.exec(line);
    if (!match) return null;
    const number = parseInt(match[1], 10);
    if (previousNumber !== null && number !== previousNumber + 1) return null;
    previousNumber = number;
    prefixes.push(match[0]);
    stripped.push(line.slice(match[0].length));
  }

  return { source: stripped.join('\n'), prefixes };
}

/**
 * Re-applies prefixes captured by stripLineNumberPrefixes to renamed output.
 * Returns null if the line count no longer matches (renaming should never
 * add/remove newlines, but if it did, splicing back would misalign prefixes
 * with content — safer to signal failure than to return corrupted text).
 */
export function restoreLineNumberPrefixes(source: string, prefixes: string[]): string | null {
  const lines = source.split('\n');
  if (lines.length !== prefixes.length) return null;
  return lines.map((line, i) => prefixes[i] + line).join('\n');
}
