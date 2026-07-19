import { describe, expect, it } from 'vitest';
import { config } from '../../src/config.js';
import { obfuscateCode } from '../../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../../src/obfuscate/renameMap.js';
import { rehydrateText } from '../../src/rehydrate/rehydrateText.js';
import { transformRequestBody } from '../../src/obfuscate/transformRequestBody.js';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function hardSource(seed: number): string {
  const pick = random(seed);
  const suffix = `${seed}_${Math.floor(pick() * 0xffff).toString(16)}`;
  const outerName = `processConfidentialRenewalBatch_${suffix}`;
  const cacheName = `nestedEligibilityCache_${suffix}`;
  const className = `RenewalDecisionEngine_${suffix}`;
  const resultName = `projectedRenewalResult_${suffix}`;
  const innerName = `innerProjectedValue_${suffix}`;
  const shadowedName = `shadowedRiskValue_${suffix}`;
  const comment = 'Internal strategy for confidential enterprise renewal decisions';
  const message = 'Strategic account pricing guidance must remain private';
  const source = [
    `// ${comment}`,
    `export function ${outerName}(input: number) {`,
    `  const ${cacheName} = new Map<string, number>();`,
    `  class ${className} {`,
    '    execute(value: number) {',
    `      const ${shadowedName} = value + ${Math.floor(pick() * 20)};`,
    `      return { ${shadowedName}, ${cacheName} };`,
    '    }',
    '  }',
    `  const ${resultName} = (() => {`,
    `    const ${innerName} = input * ${Math.floor(pick() * 5) + 1};`,
    `    return { ${innerName} };`,
    '  })();',
    `  const engine = new ${className}();`,
    `  ${cacheName}.set('renewal', ${resultName}.${innerName});`,
    `  return { ...engine.execute(${resultName}.${innerName}), message: '${message}' };`,
    '}',
  ].join('\n');
  return source
    .split('\n')
    .map((line, index) => `${String(seed + index).padStart(4, ' ')}\t${line}`)
    .join('\n');
}

function deepBody(seed: number): unknown {
  const depth = 20 + (seed % 80);
  let value: unknown = { type: 'text', text: `seed-${seed}` };
  for (let index = 0; index < depth; index++) value = [value, { nested: value }];
  return { messages: [{ content: [{ type: 'tool_result', content: [value] }] }] };
}

describe('hard seeded corpus', () => {
  it('round-trips nested scopes, classes, shorthand objects, and line prefixes', async () => {
    const originalRedactComments = config.redactComments;
    const originalRedactStrings = config.redactStrings;
    config.redactComments = false;
    config.redactStrings = false;

    try {
      for (let seed = 1; seed <= 50; seed++) {
        const source = hardSource(seed);
        const map = new RenameMap();
        const result = await obfuscateCode(source, map);
        expect(result.dialect, `seed ${seed}`).not.toBeNull();
        expect(result.renamed, `seed ${seed}`).toBe(true);
        expect(rehydrateText(result.output, map), `seed ${seed}`).toBe(source);
      }
    } finally {
      config.redactComments = originalRedactComments;
      config.redactStrings = originalRedactStrings;
    }
  });

  it('handles deeply nested malformed-shaped content without throwing', async () => {
    for (let seed = 1; seed <= 50; seed++) {
      await expect(transformRequestBody(deepBody(seed), new RenameMap()), `seed ${seed}`).resolves.toBeDefined();
    }
  });
});
