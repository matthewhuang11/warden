import { describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { obfuscateCode } from '../../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../../src/obfuscate/renameMap.js';
import { transformRequestBody } from '../../src/obfuscate/transformRequestBody.js';
import { rehydrateText } from '../../src/rehydrate/rehydrateText.js';
import { rehydrateSseStream } from '../../src/rehydrate/sseRehydrate.js';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const baseSeed = Number.parseInt(process.env.WARDEN_FUZZ_SEED ?? '0', 10) || 0;

function generatedSource(seed: number): { source: string; originalNames: string[] } {
  const pick = random(seed);
  const suffix = Math.floor(pick() * 0xffff).toString(16);
  const originalNames = [
    `calculateRenewalOffer${suffix}`,
    `accountRiskMultiplier${suffix}`,
    `renewalEligibilityCache${suffix}`,
    `confidentialPricingMessage${suffix}`,
    `renewalResult${suffix}`,
  ];
  const [functionName, multiplierName, cacheName, messageName, resultName] = originalNames;
  const source = [
    `function ${functionName}(input) {`,
    `  const ${multiplierName} = input + ${Math.floor(pick() * 20) + 1};`,
    `  let ${cacheName} = ${multiplierName} * 2;`,
    `  const ${messageName} = ${cacheName} + 1;`,
    `  return ${messageName};`,
    '}',
    `const ${resultName} = ${functionName}(${Math.floor(pick() * 100)});`,
    `console.log(${resultName});`,
  ].join('\n');
  return { source, originalNames };
}

async function* chunkify(text: string, sizes: number[]): AsyncGenerator<Uint8Array> {
  let offset = 0;
  let index = 0;
  while (offset < text.length) {
    const size = sizes[index % sizes.length];
    yield new TextEncoder().encode(text.slice(offset, offset + size));
    offset += size;
    index++;
  }
}

async function collect(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}

function extractTextDeltas(sse: string): string {
  return [...sse.matchAll(/^data: (.+)$/gm)]
    .map((match) => JSON.parse(match[1]) as { delta?: { type?: string; text?: string } })
    .filter((payload) => payload.delta?.type === 'text_delta')
    .map((payload) => payload.delta?.text ?? '')
    .join('');
}

describe('seeded robustness corpus', () => {
  it('renames and rehydrates multiple declarations across varied generated programs', async () => {
    const originalRedactComments = config.redactComments;
    const originalRedactStrings = config.redactStrings;
    config.redactComments = false;
    config.redactStrings = false;

    try {
      for (let index = 1; index <= 40; index++) {
        const seed = baseSeed + index;
        const { source, originalNames } = generatedSource(seed);
        const renameMap = new RenameMap();
        const result = await obfuscateCode(source, renameMap);

        expect(result.renamed, `seed ${seed}`).toBe(true);
        expect(result.renamedCount, `seed ${seed}`).toBeGreaterThanOrEqual(5);
        for (const name of originalNames) expect(result.output, `seed ${seed}`).not.toContain(name);
        expect(rehydrateText(result.output, renameMap), `seed ${seed}`).toBe(source);
      }
    } finally {
      config.redactComments = originalRedactComments;
      config.redactStrings = originalRedactStrings;
    }
  });

  it('never throws on varied malformed or unexpected request bodies', async () => {
    const cases: unknown[] = [
      null,
      0,
      'plain text',
      { messages: null },
      { messages: 'not an array' },
      { messages: [null, false, 42, 'text', {}] },
    ];
    for (let index = 1; index <= 40; index++) {
      const seed = baseSeed + index;
      const pick = random(seed);
      cases.push({
        messages: [
          {
            content: [
              { type: 'tool_result', tool_use_id: pick() > 0.5 ? 42 : 'missing', content: [null, { text: 42 }] },
              { type: 'tool_use', name: pick() > 0.5 ? 123 : 'Edit', input: pick() > 0.5 ? 'bad' : null },
            ],
          },
        ],
      });
    }

    for (const [index, body] of cases.entries()) {
      await expect(transformRequestBody(body, new RenameMap()), `case ${index}`).resolves.toBeDefined();
    }
  });

  it('rehydrates tokens across arbitrary SSE byte boundaries', async () => {
    for (let index = 1; index <= 30; index++) {
      const seed = baseSeed + index;
      const pick = random(seed);
      // Keep this case focused on SSE boundaries; expiry has its own tests.
      const renameMap = new RenameMap(10_000, Number.MAX_SAFE_INTEGER);
      renameMap.getOrCreate('calculateRenewalOffer', 'function');
      expect(renameMap.reverseLookup('func_1'), `seed ${seed}`).toBe('calculateRenewalOffer');
      const raw =
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `calling func_1 with seed ${seed}` },
        })}\n\n` +
        `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`;
      const sizes = [
        Math.floor(pick() * 7) + 1,
        Math.floor(pick() * 11) + 1,
        Math.floor(pick() * 17) + 1,
      ];

      const output = await collect(rehydrateSseStream(chunkify(raw, sizes), renameMap));
      expect(extractTextDeltas(output), `seed ${seed}`).toContain(`calling calculateRenewalOffer with seed ${seed}`);
    }
  });
});
