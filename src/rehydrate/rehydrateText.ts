import type { RenameMap } from '../obfuscate/renameMap.js';

// Captures an optional "key: " immediately preceding a synthetic token
// (identifier, colon, whitespace — as literally written), alongside the
// token itself. This lets a shorthand property that obfuscation expanded
// into explicit `key: value` form (see applyRenames' shorthandOriginalName)
// be recognized here and collapsed back to `{ key }`, so the visible output
// matches the original source even though Warden touched it in transit.
function buildReverseRegex(renameMap: RenameMap): RegExp | null {
  const names = renameMap.syntheticNames();
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b((?:[A-Za-z_$][\\w$]*\\s*:\\s*)?)(${escaped.join('|')})\\b`, 'g');
}

export function rehydrateText(text: string, renameMap: RenameMap): string {
  const regex = buildReverseRegex(renameMap);
  if (!regex) return text;
  return text.replace(regex, (_match, prefix: string, synthetic: string) => {
    const original = renameMap.reverseLookup(synthetic) ?? synthetic;
    if (!prefix) return original;
    const key = prefix.replace(/\s*:\s*$/, '');
    // The key equals the value's real name — this is our own
    // shorthand-expansion round-tripping, so collapse it back to `{ key }`.
    return key === original ? original : `${prefix}${original}`;
  });
}
