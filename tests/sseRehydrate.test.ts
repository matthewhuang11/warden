import { describe, it, expect } from 'vitest';
import { rehydrateSseStream } from '../src/rehydrate/sseRehydrate.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* chunkify(text: string, chunkSize: number): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  for (let i = 0; i < bytes.length; i += chunkSize) {
    yield bytes.slice(i, i + chunkSize);
  }
}

async function collectText(gen: AsyncGenerator<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder('utf-8');
  let out = '';
  for await (const chunk of gen) {
    out += decoder.decode(chunk, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function dataPayload(eventBlock: string): Record<string, unknown> | null {
  const dataLine = eventBlock.split('\n').find((l) => l.startsWith('data:'));
  if (!dataLine) return null;
  return JSON.parse(dataLine.slice(dataLine.indexOf(':') + 1).trim());
}

function extractTextDeltas(raw: string, index: number): string {
  let out = '';
  for (const block of raw.split('\n\n').filter(Boolean)) {
    const payload = dataPayload(block) as any;
    if (payload?.type === 'content_block_delta' && payload.index === index && payload.delta?.type === 'text_delta') {
      out += payload.delta.text;
    }
  }
  return out;
}

function extractPartialJson(raw: string, index: number): string {
  let out = '';
  for (const block of raw.split('\n\n').filter(Boolean)) {
    const payload = dataPayload(block) as any;
    if (payload?.type === 'content_block_delta' && payload.index === index && payload.delta?.type === 'input_json_delta') {
      out += payload.delta.partial_json;
    }
  }
  return out;
}

describe('rehydrateSseStream', () => {
  it('rehydrates text_delta content even when a synthetic token is split across raw byte chunks', async () => {
    const renameMap = new RenameMap();
    expect(renameMap.getOrCreate('computeTotal', 'function')).toBe('func_1');

    const raw =
      sseEvent('message_start', { type: 'message_start' }) +
      sseEvent('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }) +
      sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Calling ' } }) +
      sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'func_1' } }) +
      sseEvent('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' now.' } }) +
      sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 }) +
      sseEvent('message_stop', { type: 'message_stop' });

    // Byte-level chunking unrelated to SSE/JSON boundaries, so some raw
    // chunks will land in the middle of the "func_1" token.
    const output = await collectText(rehydrateSseStream(chunkify(raw, 5), renameMap));

    expect(extractTextDeltas(output, 0)).toBe('Calling computeTotal now.');
  });

  it('rehydrates input_json_delta (tool_use arguments) fully at content_block_stop', async () => {
    const renameMap = new RenameMap();
    renameMap.getOrCreate('computeTotal', 'function');
    renameMap.getOrCreate('total', 'variable');

    const fullJson = JSON.stringify({
      file_path: '/tmp/x.ts',
      new_string: 'function func_1(items) {\n  let var_1 = 0;\n  return var_1;\n}',
    });
    const splitPoints = [10, 40, fullJson.indexOf('func_1') + 3, fullJson.length];
    let prev = 0;
    const fragments: string[] = [];
    for (const point of splitPoints) {
      fragments.push(fullJson.slice(prev, point));
      prev = point;
    }

    const raw =
      sseEvent('content_block_start', {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'Edit', input: {} },
      }) +
      fragments
        .map((f) =>
          sseEvent('content_block_delta', {
            type: 'content_block_delta',
            index: 1,
            delta: { type: 'input_json_delta', partial_json: f },
          }),
        )
        .join('') +
      sseEvent('content_block_stop', { type: 'content_block_stop', index: 1 });

    const output = await collectText(rehydrateSseStream(chunkify(raw, 13), renameMap));
    const rehydratedJson = extractPartialJson(output, 1);

    expect(JSON.parse(rehydratedJson)).toEqual({
      file_path: '/tmp/x.ts',
      new_string: 'function computeTotal(items) {\n  let total = 0;\n  return total;\n}',
    });
  });

  it('passes through non-delta events untouched', async () => {
    const renameMap = new RenameMap();
    const raw =
      sseEvent('message_start', { type: 'message_start', message: { id: 'msg_1', usage: { input_tokens: 10 } } }) +
      sseEvent('ping', { type: 'ping' });

    const output = await collectText(rehydrateSseStream(chunkify(raw, 9), renameMap));
    expect(output).toContain('"type":"message_start"');
    expect(output).toContain('"type":"ping"');
  });

  it('flushes remaining buffered text even if the stream ends without a stop event', async () => {
    const renameMap = new RenameMap();
    renameMap.getOrCreate('total', 'variable');
    const raw = sseEvent('content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'var_1' },
    });

    const output = await collectText(rehydrateSseStream(chunkify(raw, 6), renameMap));
    expect(extractTextDeltas(output, 0)).toBe('total');
  });
});
