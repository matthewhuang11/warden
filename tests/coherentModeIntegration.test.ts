import { describe, expect, it, vi } from 'vitest';
import { readConfig } from '../src/config.js';
import { transformRequestBody } from '../src/obfuscate/transformRequestBody.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { CoherentCoverStorySession } from '../src/session.js';
import { rehydrateJsonValue } from '../src/rehydrate/rehydrateJson.js';
import { rehydrateSseStream } from '../src/rehydrate/sseRehydrate.js';

function toolResultRequest(filePath: string, toolUseId: string, source: string) {
  return {
    messages: [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: toolUseId, name: 'Read', input: { file_path: filePath } }],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: toolUseId, content: [{ type: 'text', text: source }] }],
      },
    ],
  };
}

function extractToolResultText(body: unknown): string {
  const messages = (body as { messages: Array<{ content: Array<{ content?: Array<{ text: string }> }> }> }).messages;
  return messages[1].content[0].content![0].text;
}

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function* oneChunk(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function collect(generator: AsyncGenerator<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let output = '';
  for await (const chunk of generator) output += decoder.decode(chunk, { stream: true });
  return output + decoder.decode();
}

describe('coherent mode integration', () => {
  it('is opt-in and defaults to the existing pool mode', () => {
    expect(readConfig({}).coverStoryMode).toBe('pool');
    expect(readConfig({ WARDEN_COVER_STORY_MODE: 'coherent' }).coverStoryMode).toBe('coherent');
    expect(() => readConfig({ WARDEN_COVER_STORY_MODE: 'unknown' })).toThrow(/WARDEN_COVER_STORY_MODE/);
  });

  it('transforms a labeled file coherently and reuses its mapping on the next turn', async () => {
    const source = ['interface WorkRequest { ready: boolean; }', 'export function chooseWork(request: WorkRequest): boolean {', '  return request.ready;', '}'].join('\n');
    const session = new CoherentCoverStorySession();
    const first = await transformRequestBody(toolResultRequest('src/work.ts', 't1', source), new RenameMap(), {
      mode: 'coherent',
      coherentSession: session,
    });
    const firstText = extractToolResultText(first.body);
    expect(first.stats.coherentBlocks).toBe(1);
    expect(first.stats.coherentDomains).toHaveLength(1);
    expect(firstText).not.toContain('WorkRequest');
    expect(session.rehydrateText(firstText)).toBe(source);

    const second = await transformRequestBody(toolResultRequest('src/work.ts', 't2', source), new RenameMap(), {
      mode: 'coherent',
      coherentSession: session,
    });
    const secondText = extractToolResultText(second.body);
    expect(secondText).toBe(firstText);
    expect(session.size).toBe(2);
  });

  it('reserves synthetic names across different files in one session', async () => {
    const session = new CoherentCoverStorySession();
    const first = await session.transform('src/first.ts', 'export function first(value: number): number { return value + 1; }');
    const second = await session.transform('src/second.ts', 'export function second(value: number): number { return value + 2; }');
    const firstOwners = first.plan.reverseIdentifiers;
    const collisions = [...second.plan.reverseIdentifiers.entries()]
      .filter(([synthetic, original]) => firstOwners.has(synthetic) && firstOwners.get(synthetic) !== original)
      .map(([synthetic]) => synthetic);

    expect(collisions).toEqual([]);
    expect(session.rehydrateText(first.output)).toContain('first(value: number)');
    expect(session.rehydrateText(second.output)).toContain('second(value: number)');
  });

  it('rehydrates coherent names inside buffered JSON and SSE', async () => {
    const session = new CoherentCoverStorySession();
    const source = 'export function computeTotal(total: number): number { return total; }';
    const result = await session.transform('src/totals.ts', source);
    const fakeFunction = [...result.plan.reverseIdentifiers.entries()].find(([, original]) => original === 'computeTotal')?.[0];
    expect(fakeFunction).toBeDefined();

    expect(rehydrateJsonValue({ text: `Call ${fakeFunction}` }, new RenameMap(), session)).toEqual({ text: 'Call computeTotal' });

    const raw =
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: `Call ${fakeFunction}` },
      }) + sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
    const output = await collect(rehydrateSseStream(oneChunk(raw), new RenameMap(), session));
    expect(output).toContain('Call computeTotal');
  });

  it('bounds coherent session plans by capacity and idle TTL', async () => {
    const session = new CoherentCoverStorySession(1, 1_000);
    await session.transform('src/first.ts', 'export function first(value: number): number { return value; }');
    await session.transform('src/second.ts', 'export function second(value: number): number { return value; }');
    expect(session.size).toBe(1);

    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const expiring = new CoherentCoverStorySession(10, 1_000);
      await expiring.transform('src/expiring.ts', 'export function expiring(value: number): number { return value; }');
      vi.advanceTimersByTime(1_001);
      expect(expiring.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
