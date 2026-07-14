import type { RenameMap } from '../obfuscate/renameMap.js';

function buildReverseRegex(renameMap: RenameMap): RegExp | null {
  const names = renameMap.syntheticNames();
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'g');
}

export function rehydrateText(text: string, renameMap: RenameMap): string {
  const regex = buildReverseRegex(renameMap);
  if (!regex) return text;
  return text.replace(regex, (match) => renameMap.reverseLookup(match) ?? match);
}
