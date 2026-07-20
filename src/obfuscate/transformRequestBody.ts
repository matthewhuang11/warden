import { obfuscateCode } from './obfuscateCode.js';
import { obfuscateKnownNames } from './obfuscateKnownNames.js';
import type { RenameMap } from './renameMap.js';
import { createAuditEvent, type AuditEvent } from '../audit/auditTypes.js';

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
}

// Fixed, invisible instruction injected into the system field of every
// obfuscated request. Scoped narrowly to unprompted naming commentary (the
// category-2 failure in the stealth spec — ordinary naming nitpicks that
// happen on real code too) rather than suppressing the topic outright, so a
// developer who directly asks for a naming/readability review still gets an
// honest answer.
export const NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION =
  "Don't proactively volunteer opinions about whether identifier or variable names accurately reflect their behavior, unless the user explicitly asks for a naming, readability, or code-quality review.";

const EDIT_TOOL_NAMES = new Set(['Edit']);
const WRITE_TOOL_NAMES = new Set(['Write']);
// Bash output (grep/cat/ls/arbitrary command output) is often fragmentary,
// non-code text that a tree-sitter parse would just reject wholesale —
// these get a plain known-names-only substitution instead, see
// obfuscateBashResultText below.
const BASH_TOOL_NAMES = new Set(['Bash']);
const SOURCE_PATH_PATTERN = /(?<![A-Za-z0-9_.-])(?:\.{0,2}\/|\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|json|py|go|rs|java|rb|php|css|scss|html|md|sql|ya?ml)\b/g;
const SOURCE_PATH_EXACT_PATTERN = /^(?:\.{0,2}\/|\/)?(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:[cm]?[jt]sx?|json|py|go|rs|java|rb|php|css|scss|html|md|sql|ya?ml)$/;

/**
 * Walks an Anthropic Messages API request body looking for source code in
 * source-bearing tool inputs/results plus source paths in user text and tool
 * history. Path aliases are rehydrated on the response path before a local
 * tool executes, so the model sees a neutral path while the client still
 * opens the requested local file.
 */
export async function transformRequestBody(
  body: unknown,
  renameMap: RenameMap,
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
  };

  if (!isRecord(body) || !Array.isArray(body.messages)) {
    return { body, stats };
  }

  injectSystemInstruction(body);

  const toolCallById = buildToolCallById(body.messages);

  for (const message of body.messages) {
    if (!isRecord(message) || !Array.isArray(message.content)) continue;

    for (const block of message.content) {
      if (!isRecord(block)) continue;

      if (block.type === 'text' && typeof block.text === 'string') {
        block.text = obfuscateSourcePaths(block.text, renameMap, stats);
        continue;
      }

      if (block.type === 'tool_use' && typeof block.name === 'string' && isRecord(block.input)) {
        const toolCall = typeof block.id === 'string' ? toolCallById.get(block.id) : undefined;
        const label = toolCall?.label ?? deriveLabel(block.name, block.input);
        if (typeof block.input.file_path === 'string') {
          block.input.file_path = obfuscateSourcePath(block.input.file_path, renameMap, stats);
        }
        if (BASH_TOOL_NAMES.has(block.name) && typeof block.input.command === 'string') {
          block.input.command = obfuscateKnownNames(block.input.command, renameMap).output;
        }
        if (EDIT_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'old_string', renameMap, stats, label);
          await obfuscateField(block.input, 'new_string', renameMap, stats, label);
        } else if (WRITE_TOOL_NAMES.has(block.name)) {
          await obfuscateField(block.input, 'content', renameMap, stats, label);
        }
        continue;
      }

      if (block.type === 'tool_result') {
        const toolCall = typeof block.tool_use_id === 'string' ? toolCallById.get(block.tool_use_id) : undefined;
        const isBash = toolCall !== undefined && BASH_TOOL_NAMES.has(toolCall.name);
        const label = toolCall?.label ?? 'tool_result';

        if (typeof block.content === 'string') {
          block.content = isBash
            ? obfuscateBashResultText(block.content, renameMap, stats, label)
            : await obfuscateText(block.content, renameMap, stats, label);
        } else if (Array.isArray(block.content)) {
          for (const inner of block.content) {
            if (isRecord(inner) && inner.type === 'text' && typeof inner.text === 'string') {
              inner.text = isBash
                ? obfuscateBashResultText(inner.text, renameMap, stats, label)
                : await obfuscateText(inner.text, renameMap, stats, label);
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
  label: string;
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
        toolCallById.set(block.id, { name: block.name, input: block.input, label: deriveLabel(block.name, block.input) });
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Adds NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION to the request's `system`
 * field without disturbing whatever's already there. The Anthropic Messages
 * API accepts `system` as a bare string or an array of content blocks
 * (typically with `cache_control` on existing blocks, which appending a new
 * block preserves — rewriting an existing block's text would otherwise
 * invalidate its cache). Idempotent so re-running this on an
 * already-injected body never duplicates the instruction.
 */
function injectSystemInstruction(body: Record<string, unknown>): void {
  const { system } = body;
  if (system === undefined) {
    body.system = NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION;
  } else if (typeof system === 'string') {
    if (!system.includes(NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION)) {
      body.system = `${system}\n\n${NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION}`;
    }
  } else if (Array.isArray(system)) {
    const alreadyPresent = system.some(
      (block) => isRecord(block) && block.type === 'text' && block.text === NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION,
    );
    if (!alreadyPresent) {
      system.push({ type: 'text', text: NAMING_COMMENTARY_SUPPRESSION_INSTRUCTION });
    }
  }
}

function obfuscateSourcePath(pathValue: string, renameMap: RenameMap, stats: TransformStats): string {
  if (!SOURCE_PATH_EXACT_PATTERN.test(pathValue)) return pathValue;
  return aliasSourcePath(pathValue, renameMap, stats);
}

function aliasSourcePath(pathValue: string, renameMap: RenameMap, stats: TransformStats): string {
  const synthetic = renameMap.getOrCreatePath(pathValue);
  stats.stringsRedacted += 1;
  stats.auditEvents.push(createAuditEvent('string', pathValue));
  return synthetic;
}

function obfuscateSourcePaths(text: string, renameMap: RenameMap, stats: TransformStats): string {
  return text.replace(SOURCE_PATH_PATTERN, (pathValue) => aliasSourcePath(pathValue, renameMap, stats));
}

async function obfuscateField(
  obj: Record<string, unknown>,
  field: string,
  renameMap: RenameMap,
  stats: TransformStats,
  label: string,
): Promise<void> {
  const value = obj[field];
  if (typeof value !== 'string' || value.length === 0) return;
  obj[field] = await obfuscateText(value, renameMap, stats, label);
}

async function obfuscateText(text: string, renameMap: RenameMap, stats: TransformStats, label: string): Promise<string> {
  stats.blocksScanned += 1;
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
