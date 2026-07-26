import type { RenameMap } from '../obfuscate/renameMap.js';
import type { CoherentCoverStorySession } from '../session.js';
import { rehydrateText } from './rehydrateText.js';

/**
 * Recursively rehydrates every string in a parsed JSON value. Used for the
 * (uncommon, for an interactive coding session) case where Claude Code
 * requests a non-streaming response — the whole message is already
 * buffered, so there's no chunk-boundary concern, just a plain walk.
 */
export function rehydrateJsonValue(
  value: unknown,
  renameMap: RenameMap,
  coherentSession?: CoherentCoverStorySession,
): unknown {
  if (typeof value === 'string') {
    return rehydrateText(value, renameMap, coherentSession);
  }
  if (Array.isArray(value)) {
    return value.map((item) => rehydrateJsonValue(item, renameMap, coherentSession));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = rehydrateJsonValue(val, renameMap, coherentSession);
    }
    return out;
  }
  return value;
}
