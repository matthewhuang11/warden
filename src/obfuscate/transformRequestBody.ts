import { obfuscateCode } from './obfuscateCode.js';
import type { RenameMap } from './renameMap.js';

export interface TransformStats {
  blocksScanned: number;
  blocksRenamed: number;
  totalIdentifiersRenamed: number;
}

const EDIT_TOOL_NAMES = new Set(['Edit']);
const WRITE_TOOL_NAMES = new Set(['Write']);

/**
 * Walks an Anthropic Messages API request body looking for source code in
 * two places: Edit/Write tool_use inputs (code the assistant is about to
 * write) and tool_result content (file/command output sent back to the
 * model as context, e.g. from Read or Bash). Mutates and returns the same
 * body object. Anything outside those two shapes — plain text blocks, the
 * system prompt, other tool inputs — is left untouched, per scope.
 */
export async function transformRequestBody(
  body: unknown,
  renameMap: RenameMap,
): Promise<{ body: unknown; stats: TransformStats }> {
  const stats: TransformStats = { blocksScanned: 0, blocksRenamed: 0, totalIdentifiersRenamed: 0 };

  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, stats };
  }

  for (const message of body.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!isRecord(block)) continue;

      if (block.type === 'tool_use' && typeof block.name === 'string' && isRecord(block.input)) {
        if (EDIT_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'old_string', renameMap, stats);
          await obfuscateField(block.input, 'new_string', renameMap, stats);
        } else if (WRITE_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'content', renameMap, stats);
        }
        continue;
      }

      if (block.type === 'tool_result') {
        if (typeof block.content === 'string') {
          block.content = await obfuscateText(block.content, renameMap, stats);
        } else if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (isRecord(inner) && inner.type === 'text' && typeof inner.text === 'string') {
              inner.text = await obfuscateText(inner.text, renameMap, stats);
            }
          }
        }
      }
    }
  }

  return { body, stats };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function obfuscateField(
  obj: Record<string, unknown>,
  field: string,
  renameMap: RenameMap,
  stats: TransformStats,
): Promise<void> {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) return;
  obj[field] = await obfuscateText(value, renameMap, stats);
}

async function obfuscateText(text: string, renameMap: RenameMap, stats: TransformStats): Promise<string> {
  stats.blocksScanned += 1;
  const result = await obfuscateCode(text, renameMap);
  if (result.renamed) {
    stats.blocksRenamed += 1;
    stats.totalIdentifiersRenamed += result.renamedCount;
  }
  return result.output;
}
