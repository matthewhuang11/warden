import { readFile } from 'node:fs/promises';
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

  it('keeps private fields and templates stable across turns and files', async () => {
    const source = [
      'class WorkBox {',
      '  #currentValue = 0;',
      '  describe(name: string): string { return `Confidential workflow for ${name}`; }',
      '}',
    ].join('\n');
    const session = new CoherentCoverStorySession();
    const first = await session.transform('src/work.ts', source);
    const second = await session.transform('src/work.ts', source);
    const neighboring = await session.transform('src/other.ts', 'export function other(value: number): number { return value + 1; }');

    expect(second.output).toBe(first.output);
    expect(session.rehydrateText(second.output)).toBe(source);
    expect(session.rehydrateText(neighboring.output)).toContain('other(value: number)');
    expect(first.plan.syntheticNames.size).toBeGreaterThan(first.plan.identifierMappings.length);
  });

  it('aliases business-descriptive file paths only in coherent mode and rehydrates them', async () => {
    const source = 'export function chooseWork(request: WorkRequest): boolean { return request.ready; }';
    const originalPath = '/workspace/healthcare/prior-authorization.ts';
    const session = new CoherentCoverStorySession();
    const coherent = await transformRequestBody(toolResultRequest(originalPath, 'coherent', source), new RenameMap(), {
      mode: 'coherent',
      coherentSession: session,
    });
    const coherentMessages = (coherent.body as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages;
    const coherentTool = coherentMessages[0].content[0];
    expect((coherentTool.input as Record<string, unknown>).file_path).toBe('source.ts');
    expect(JSON.stringify(coherent.body)).not.toContain(originalPath);
    expect(session.rehydrateText('Edit source.ts')).toBe(`Edit ${originalPath}`);
    expect(rehydrateJsonValue({ input: { file_path: 'source.ts' } }, new RenameMap(), session)).toEqual({
      input: { file_path: originalPath },
    });

    const pool = await transformRequestBody(toolResultRequest(originalPath, 'pool', source), new RenameMap(), {
      mode: 'pool',
    });
    const poolMessages = (pool.body as { messages: Array<{ content: Array<Record<string, unknown>> }> }).messages;
    expect((poolMessages[0].content[0].input as Record<string, unknown>).file_path).toBe(originalPath);
  });

  it('keeps multiple aliased paths distinct across model tool calls', async () => {
    const session = new CoherentCoverStorySession();
    const first = session.aliasPath('/workspace/billing/settlement-reserve.ts');
    const second = session.aliasPath('/workspace/healthcare/prior-authorization.ts');
    expect(first).toBe('source.ts');
    expect(second).toBe('source_2.ts');
    expect(session.rehydrateText(`${first} -> ${second}`)).toBe(
      '/workspace/billing/settlement-reserve.ts -> /workspace/healthcare/prior-authorization.ts',
    );
  });

  it('aliases known paths inside Bash and directory-bearing tool inputs', async () => {
    const originalPath = '/workspace/healthcare/prior-authorization.ts';
    const session = new CoherentCoverStorySession();
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: originalPath } },
            {
              type: 'tool_use',
              id: 'bash',
              name: 'Bash',
              input: { command: `grep -n policy ${originalPath}`, cwd: '/workspace/healthcare' },
            },
          ],
        },
      ],
    };
    const result = await transformRequestBody(body, new RenameMap(), {
      mode: 'coherent',
      coherentSession: session,
    });
    const inputs = (result.body as { messages: Array<{ content: Array<{ input: Record<string, unknown> }> }> }).messages[0]
      .content.map((block) => block.input);
    expect(inputs[0].file_path).toBe('source.ts');
    expect(inputs[1].command).toBe('grep -n policy source.ts');
    expect(inputs[1].cwd).toBe('workspace');
  });

  it('aliases a path whose first appearance is in Bash output', async () => {
    const originalPath = 'src/healthcare/prior-authorization.ts';
    const session = new CoherentCoverStorySession();
    const body = {
      messages: [
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'find src -name "*.ts"' } }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'bash', content: `src/healthcare/\n${originalPath}\n` }],
        },
      ],
    };
    const result = await transformRequestBody(body, new RenameMap(), {
      mode: 'coherent',
      coherentSession: session,
    });
    expect(JSON.stringify(result.body)).not.toContain(originalPath);
    expect(JSON.stringify(result.body)).toContain('source.ts');
    expect(session.rehydrateText('source.ts')).toBe(originalPath);
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

  it('keeps comment mappings distinct and rehydratable across files in one session', async () => {
    const session = new CoherentCoverStorySession();
    const firstSource = [
      '// First private note.',
      'export function first(value: number): number { return value + 1; }',
    ].join('\n');
    const secondSource = [
      '// Second private note.',
      'export function second(value: number): number { return value + 2; }',
    ].join('\n');
    const first = await session.transform('src/first.ts', firstSource);
    const second = await session.transform('src/second.ts', secondSource);

    expect(first.plan.commentMappings[0]?.synthetic).toBeDefined();
    expect(second.plan.commentMappings[0]?.synthetic).toBeDefined();
    expect(second.plan.commentMappings[0]?.synthetic).not.toBe(first.plan.commentMappings[0]?.synthetic);
    expect(session.rehydrateText(first.output)).toBe(firstSource);
    expect(session.rehydrateText(second.output)).toBe(secondSource);
  });

  it('uses fresh cover vocabulary instead of numeric suffixes across held-out domains', async () => {
    const session = new CoherentCoverStorySession();
    const firstSource = await readFile('examples/fixtures/held-out/fintech/merchant-payout-schedule.ts', 'utf8');
    const secondSource = await readFile('examples/fixtures/held-out/healthtech/specialty-referral-routing.ts', 'utf8');
    await session.transform('source.ts', firstSource);
    const second = await session.transform('source.ts', secondSource);

    expect(second.output).not.toMatch(/[A-Za-z_$][\w$]*(?:2|_[2-9])\b/);
    expect(session.rehydrateText(second.output)).toBe(secondSource);
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

  it('rehydrates a split path alias in streamed text', async () => {
    const session = new CoherentCoverStorySession();
    const originalPath = '/workspace/healthcare/prior-authorization.ts';
    const alias = session.aliasPath(originalPath);
    const raw =
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: `${'x'.repeat(20)} ${alias.slice(0, -2)}` },
      }) +
      sseEvent('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: alias.slice(-2) },
      }) +
      sseEvent('content_block_stop', { type: 'content_block_stop', index: 0 });
    const output = await collect(rehydrateSseStream(oneChunk(raw), new RenameMap(), session));
    expect(output).toContain(originalPath);
    expect(output).not.toContain(alias);
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
