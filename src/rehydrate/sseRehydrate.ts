import type { RenameMap } from '../obfuscate/renameMap.js';
import { logger } from '../log.js';
import { rehydrateText } from './rehydrateText.js';

// Long enough to hold back any realistic synthetic token (our longest
// prefix is "class_" plus a short base-36 counter) plus margin, so a
// token split across two upstream chunks never gets flushed half-written.
const TAIL_HOLDBACK = 24;

interface DeltaFrame {
  index: number;
  kind: 'text_delta' | 'input_json_delta';
  text: string;
}

function buildDeltaEventText(frame: DeltaFrame): string {
  const payload =
    frame.kind === 'text_delta'
      ? { type: 'content_block_delta', index: frame.index, delta: { type: 'text_delta', text: frame.text } }
      : { type: 'content_block_delta', index: frame.index, delta: { type: 'input_json_delta', partial_json: frame.text } };
  return `event: content_block_delta\ndata: ${JSON.stringify(payload)}`;
}

/**
 * Reverses obfuscation on a streamed Anthropic Messages API SSE response.
 *
 * text_delta (visible prose/code, shown live in a terminal) is rehydrated
 * incrementally: a small tail of each block's accumulated text is always
 * held back in case it's a partial synthetic token, and flushed once more
 * text (or the block's stop event) confirms it's safe.
 *
 * input_json_delta (tool_use arguments, e.g. Edit/Write inputs) is instead
 * buffered in full per block and rehydrated once, at content_block_stop.
 * These fragments are raw, partially-escaped JSON text — an escaped `\n`
 * puts a word character directly adjacent to a following token with no
 * real boundary, which breaks incremental \b-boundary matching. Buffering
 * the whole block sidesteps that, and tool inputs aren't rendered
 * character-by-character to a user anyway, so there's no streaming UX to
 * preserve there.
 */
class SseRehydrator {
  private readonly textPending = new Map<number, string>();
  private readonly jsonBuffer = new Map<number, string>();

  constructor(private readonly renameMap: RenameMap) {}

  processFrame(frame: string): string {
    const lines = frame.split('\n');
    const dataLines = lines.filter((l) => l.startsWith('data:'));
    const eventLines = lines.filter((l) => !l.startsWith('data:'));
    if (dataLines.length !== 1) return frame;

    const jsonText = dataLines[0].slice(dataLines[0].indexOf(':') + 1).trim();
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      return frame;
    }

    if (payload.type === 'content_block_delta' && typeof payload.index === 'number' && isRecord(payload.delta)) {
      return this.handleDelta(frame, eventLines, payload as { type: string; index: number; delta: Record<string, unknown> });
    }

    if (payload.type === 'content_block_stop' && typeof payload.index === 'number') {
      return this.handleStop(eventLines, payload as { type: string; index: number });
    }

    return frame;
  }

  private handleDelta(
    original: string,
    eventLines: string[],
    payload: { type: string; index: number; delta: Record<string, unknown> },
  ): string {
    const { index, delta } = payload;

    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      const combined = (this.textPending.get(index) ?? '') + delta.text;
      if (combined.length <= TAIL_HOLDBACK) {
        this.textPending.set(index, combined);
        return '';
      }
      const safeLength = combined.length - TAIL_HOLDBACK;
      this.textPending.set(index, combined.slice(safeLength));
      const emitted = rehydrateText(combined.slice(0, safeLength), this.renameMap);
      return buildDeltaEventText({ index, kind: 'text_delta', text: emitted });
    }

    if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
      this.jsonBuffer.set(index, (this.jsonBuffer.get(index) ?? '') + delta.partial_json);
      return '';
    }

    return original;
  }

  private handleStop(eventLines: string[], payload: { type: string; index: number }): string {
    const { index } = payload;
    const stopFrame = `${eventLines.join('\n')}\ndata: ${JSON.stringify(payload)}`;

    const parts: string[] = [];

    const textLeftover = this.textPending.get(index);
    this.textPending.delete(index);
    if (textLeftover) {
      parts.push(buildDeltaEventText({ index, kind: 'text_delta', text: rehydrateText(textLeftover, this.renameMap) }));
    }

    const jsonFull = this.jsonBuffer.get(index);
    this.jsonBuffer.delete(index);
    if (jsonFull) {
      parts.push(buildDeltaEventText({ index, kind: 'input_json_delta', text: rehydrateText(jsonFull, this.renameMap) }));
    }

    parts.push(stopFrame);
    return parts.join('\n\n');
  }

  /** Safety net: emit anything still buffered if the stream ends without
   * proper stop events, so rehydrated content is never silently dropped. */
  flushRemaining(): string {
    const parts: string[] = [];
    for (const [index, text] of this.textPending) {
      parts.push(buildDeltaEventText({ index, kind: 'text_delta', text: rehydrateText(text, this.renameMap) }));
    }
    for (const [index, text] of this.jsonBuffer) {
      parts.push(buildDeltaEventText({ index, kind: 'input_json_delta', text: rehydrateText(text, this.renameMap) }));
    }
    this.textPending.clear();
    this.jsonBuffer.clear();
    return parts.length > 0 ? parts.join('\n\n') + '\n\n' : '';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export async function* rehydrateSseStream(
  upstream: AsyncIterable<Uint8Array>,
  renameMap: RenameMap,
): AsyncGenerator<Uint8Array> {
  const rehydrator = new SseRehydrator(renameMap);
  const decoder = new TextDecoder('utf-8');
  const encoder = new TextEncoder();
  let buffer = '';

  try {
    for await (const chunk of upstream) {
      buffer += decoder.decode(chunk, { stream: true });
      let sepIndex: number;
      while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);
        const out = rehydrator.processFrame(frame);
        if (out.length > 0) yield encoder.encode(out + '\n\n');
      }
    }
  } catch (err) {
    logger.error('rehydrate.stream_error', { error: String(err) });
    throw err;
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    const out = rehydrator.processFrame(buffer);
    if (out.length > 0) yield encoder.encode(out + '\n\n');
  }

  const trailing = rehydrator.flushRemaining();
  if (trailing.length > 0) yield encoder.encode(trailing);
}
