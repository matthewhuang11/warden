import { RenameMap } from './obfuscate/renameMap.js';
import { config } from './config.js';

// Real names never leave the machine; synthetic names never touch disk.
// This map lives only as long as the proxy process runs and is never
// persisted, matching the "session-only" requirement. It's a singleton
// (not per-request) because Claude Code resends full conversation history
// on every turn — the same original name must always obfuscate to the
// same synthetic name across turns for the model's context to stay
// coherent, and for our own SSE rehydration to reverse it correctly.
export const sessionRenameMap = new RenameMap(config.maxSessionMappings, config.sessionMappingTtlMs, 'stealth');
