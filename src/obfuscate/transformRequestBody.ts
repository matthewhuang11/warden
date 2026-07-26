import { obfuscateCode } from './obfuscateCode.js';
import { obfuscateKnownNames } from './obfuscateKnownNames.js';
import type { RenameMap } from './renameMap.js';
import type { AuditEvent } from '../audit/auditTypes.js';
import type { CoherentCoverStorySession } from '../session.js';

export type ObfuscationMode = 'pool' | 'coherent';

export interface TransformRequestOptions {
  mode?: ObfuscationMode;
  coherentSession?: CoherentCoverStorySession;
}

// A human-readable label for one obfuscated block (e.g. a file path or
// "Bash: <command>"), purely for presentation — doesn't affect what gets
// renamed or how, only what a caller can report about it afterward.
export interface ObfuscatedBlockSummary {
  label: string;
  renamedCount: number;
}

export interface TransformStats {
  blocksScanned: number;
  blocksRenamed: number;
  totalIdentifiersRenamed: number;
  commentsRedacted: number;
  stringsRedacted: number;
  derivedConstantsRedacted: number;
  secretsRedacted: number;
  auditEvents: AuditEvent[];
  blocks: ObfuscatedBlockSummary[];
  coherentBlocks?: number;
  coherentDomains?: string[];
  coherentFallbacks?: number;
}

const EDIT_TOOL_NAMES = new Set(['Edit']);
const WRITE_TOOL_NAMES = new Set(['Write']);
// Bash output (grep/cat/ls/arbitrary command output) is often fragmentary,
// non-code text that a tree-sitter parse would just reject wholesale —
// these get a plain known-names-only substitution instead, see
// obfuscateBashResultText below.
const BASH_TOOL_NAMES = new Set(['Bash']);

/**
 * Walks an Anthropic Messages API request body looking for source code in
 * Edit/Write tool inputs and tool-result content. Coherent mode also aliases
 * tool file paths before the model sees them; pool mode leaves paths exact.
 */
export async function transformRequestBody(
  body: unknown,
  renameMap: RenameMap,
  options: TransformRequestOptions = {},
): Promise<{ body: unknown; stats: TransformStats }> {
  const stats: TransformStats = {
    blocksScanned: 0,
    blocksRenamed: 0,
    totalIdentifiersRenamed: 0,
    commentsRedacted: 0,
    stringsRedacted: 0,
    derivedConstantsRedacted: 0,
    secretsRedacted: 0,
    auditEvents: [],
    blocks: [],
    coherentBlocks: 0,
    coherentDomains: [],
    coherentFallbacks: 0,
  };

  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, stats };
  }

  if (options.mode === 'coherent' && options.coherentSession) {
    aliasCoherentPaths(body.messages, options.coherentSession);
  }

  const toolCallById = buildToolCallById(body.messages);

  for (const message of body.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!isRecord(block)) continue;

      if (block.type === 'tool_use' && typeof block.name === 'string' && isRecord(block.input)) {
        const label = deriveLabel(block.name, block.input);
        if (EDIT_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'old_string', renameMap, stats, label, options);
          await obfuscateField(block.input, 'new_string', renameMap, stats, label, options);
        } else if (WRITE_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'content', renameMap, stats, label, options);
        }
        continue;
      }

      if (block.type === 'tool_result') {
        const toolCall = typeof block.tool_use_id === 'string' ? toolCallById.get(block.tool_use_id) : undefined;
        const isBash = toolCall !== undefined && BASH_TOOL_NAMES.has(toolCall.name);
        const label = toolCall ? deriveLabel(toolCall.name, toolCall.input) : 'tool_result';

        if (typeof block.content === 'string') {
          block.content = isBash
            ? obfuscateBashResultText(block.content, renameMap, stats, label)
              : await obfuscateText(block.content, renameMap, stats, label, options);
        } else if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (isRecord(inner) && inner.type === 'text' && typeof inner.text === 'string') {
              inner.text = isBash
                ? obfuscateBashResultText(inner.text, renameMap, stats, label)
                : await obfuscateText(inner.text, renameMap, stats, label, options);
            }
          }
        }
      }
    }
  }

  return { body, stats };
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Maps each tool_use block's id to its name and input, across the whole
 * body, so a later tool_result (which only carries tool_use_id) can be
 * matched back to the tool that produced it — both to tell Bash apart from
 * everything else, and to recover a human-readable label (e.g. a file
 * path) for presentation. */
function buildToolCallById(messages: unknown[]): Map<string, ToolCall> {
  const toolCallById = new Map<string, ToolCall>();
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (
        isRecord(block) &&
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string' &&
        isRecord(block.input)
      ) {
        toolCallById.set(block.id, { name: block.name, input: block.input });
      }
    }
  }
  return toolCallById;
}

/** Best-effort human-readable label for a tool call, purely for reporting
 * (e.g. "🔒 3 identifiers protected in src/server.ts"). Falls back to the
 * tool name alone when there's nothing more specific to show. */
function deriveLabel(toolName: string, input: Record<string, unknown>): string {
  if (typeof input.file_path === 'string' && input.file_path.length > 0) {
    return input.file_path;
  }
  if (BASH_TOOL_NAMES.has(toolName) && typeof input.command === 'string' && input.command.length > 0) {
    const command = input.command.length > 60 ? `${input.command.slice(0, 60)}…` : input.command;
    return `Bash: ${command}`;
  }
  return toolName;
}

function aliasCoherentPaths(messages: unknown[], session: CoherentCoverStorySession): void {
  for (const message of messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!isRecord(block)) continue;
      if (block.type === 'tool_use' && isRecord(block.input)) {
        if (typeof block.input.file_path === 'string' && block.input.file_path.length > 0) {
          block.input.file_path = session.aliasPath(block.input.file_path);
        }
      }
      replaceAliasedPathsInTextBlocks(block, session);
    }
  }
}

function replaceAliasedPathsInTextBlocks(block: Record<string, unknown>, session: CoherentCoverStorySession): void {
  if (typeof block.text === 'string') block.text = session.aliasPathsInText(block.text);
  if (typeof block.content === 'string') block.content = session.aliasPathsInText(block.content);
  if (Array.isArray(block.content)) {
    for (const inner of block.content) {
      if (isRecord(inner) && typeof inner.text === 'string') {
        inner.text = session.aliasPathsInText(inner.text);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function obfuscateField(
  obj: Record<string, unknown>,
  field: string,
  renameMap: RenameMap,
  stats: TransformStats,
  label: string,
  options: TransformRequestOptions,
): Promise<void> {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) return;
  obj[field] = await obfuscateText(value, renameMap, stats, label, options);
}

async function obfuscateText(
  text: string,
  renameMap: RenameMap,
  stats: TransformStats,
  label: string,
  options: TransformRequestOptions,
): Promise<string> {
  stats.blocksScanned += 1;
  if (options.mode === 'coherent' && options.coherentSession) {
    try {
      const result = await options.coherentSession.transform(label, text);
      if (result.validation.valid) {
        stats.blocksRenamed += 1;
        stats.totalIdentifiersRenamed += result.renamedCount;
        stats.coherentBlocks = (stats.coherentBlocks ?? 0) + 1;
        if (!stats.coherentDomains?.includes(result.plan.domain.id)) stats.coherentDomains?.push(result.plan.domain.id);
        stats.blocks.push({ label, renamedCount: result.renamedCount });
        return result.output;
      }
    } catch {
      stats.coherentFallbacks = (stats.coherentFallbacks ?? 0) + 1;
    }
  }
  const result = await obfuscateCode(text, renameMap);
  if (result.renamed) {
    stats.blocksRenamed += 1;
    stats.totalIdentifiersRenamed += result.renamedCount;
    stats.commentsRedacted += result.commentsRedacted;
    stats.stringsRedacted += result.stringsRedacted;
    stats.derivedConstantsRedacted += result.derivedConstantsRedacted;
    stats.auditEvents.push(...result.auditEvents);
    stats.blocks.push({ label, renamedCount: result.renamedCount });
  }
  return result.output;
}

function obfuscateBashResultText(text: string, renameMap: RenameMap, stats: TransformStats, label: string): string {
  stats.blocksScanned += 1;
  const { output, renamedCount } = obfuscateKnownNames(text, renameMap);
  if (renamedCount > 0) {
    stats.blocksRenamed += 1;
    stats.totalIdentifiersRenamed += renamedCount;
    stats.blocks.push({ label, renamedCount });
  }
  return output;
}
