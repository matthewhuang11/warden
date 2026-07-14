import { getParser, type Dialect } from './grammar.js';
import { analyzeScopes } from './scopeAnalyzer.js';
import { applyRenames } from './applyRenames.js';
import type { RenameMap } from './renameMap.js';
import { logger } from '../log.js';

export interface ObfuscateResult {
  output: string;
  renamed: boolean;
  renamedCount: number;
  dialect: Dialect | null;
}

const DIALECT_ATTEMPT_ORDER: Dialect[] = ['typescript', 'tsx'];

/**
 * Best-effort obfuscation of one code block. Tries the typescript grammar
 * first, falls back to tsx (for JSX syntax), and if both parses come back
 * with syntax errors, returns the source untouched — renaming from a
 * broken parse risks corrupting code, which is worse than not obfuscating.
 */
export async function obfuscateCode(source: string, renameMap: RenameMap): Promise<ObfuscateResult> {
  for (const dialect of DIALECT_ATTEMPT_ORDER) {
    const parser = await getParser(dialect);
    const tree = parser.parse(source);
    if (tree.rootNode.hasError) continue;

    const analysis = analyzeScopes(tree.rootNode);
    const { output, renamedCount } = applyRenames(source, analysis, renameMap);
    logger.info('obfuscate.applied', { dialect, declarations: analysis.declarations.length, renamedCount });
    return { output, renamed: renamedCount > 0, renamedCount, dialect };
  }

  logger.warn('obfuscate.parse_failed', { sourceLength: source.length });
  return { output: source, renamed: false, renamedCount: 0, dialect: null };
}
