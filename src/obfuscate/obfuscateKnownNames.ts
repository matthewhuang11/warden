import type { RenameMap } from './renameMap.js';

export interface ObfuscateKnownNamesResult {
  output: string;
  renamedCount: number;
}

function buildKnownNamesRegex(renameMap: RenameMap): RegExp | null {
  const names = renameMap.originalNames();
  if (names.length === 0) return null;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(?:${escaped.join('|')})\\b`, 'g');
}

/**
 * Best-effort obfuscation for text that can't be reliably parsed as a
 * complete file — Bash tool_result output (grep/cat/ls, arbitrary command
 * output, fragments) — where tree-sitter parsing would just fail and leave
 * everything untouched. Rather than attempting new identifier discovery
 * against unstructured text (too unreliable to trust), this only reuses
 * names the session already committed to a synthetic name for via an
 * earlier Read/Edit/Write, matched on word boundaries so e.g. renaming
 * `data` never touches `database` or `dataset`.
 */
export function obfuscateKnownNames(text: string, renameMap: RenameMap): ObfuscateKnownNamesResult {
  const regex = buildKnownNamesRegex(renameMap);
  if (!regex) return { output: text, renamedCount: 0 };

  let renamedCount = 0;
  const output = text.replace(regex, (match) => {
    const synthetic = renameMap.get(match);
    if (!synthetic) return match;
    renamedCount += 1;
    return synthetic;
  });

  return { output, renamedCount };
}
