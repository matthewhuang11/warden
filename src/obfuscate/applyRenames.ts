import type { ScopeAnalysis } from './scopeAnalyzer.js';
import type { RenameMap } from './renameMap.js';

export interface ApplyRenamesResult {
  output: string;
  renamedCount: number;
}

/**
 * Splices synthetic names into the original source by exact byte offset,
 * processed last-to-first so earlier offsets stay valid as later ones are
 * rewritten. This deliberately avoids AST regeneration so formatting
 * (whitespace, comments, quote style) is preserved exactly.
 */
export function applyRenames(source: string, analysis: ScopeAnalysis, renameMap: RenameMap): ApplyRenamesResult {
  if (analysis.sites.length === 0) {
    return { output: source, renamedCount: 0 };
  }

  const syntheticByDeclId = new Map<string, string>();
  for (const decl of analysis.declarations) {
    syntheticByDeclId.set(decl.id, renameMap.getOrCreate(decl.originalName, decl.kind));
  }

  const orderedSites = [...analysis.sites].sort((a, b) => b.startIndex - a.startIndex);

  let output = source;
  let renamedCount = 0;
  for (const site of orderedSites) {
    const synthetic = site.via === 'known' ? site.synthetic : syntheticByDeclId.get(site.declId);
    if (!synthetic) continue;
    output = output.slice(0, site.startIndex) + synthetic + output.slice(site.endIndex);
    renamedCount += 1;
  }

  return { output, renamedCount };
}
