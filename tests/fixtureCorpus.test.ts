import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

const FIXTURE_PATHS = [
  'examples/fintech/credit-line-policy.ts',
  'examples/fintech/settlement-reserve.ts',
  'examples/fintech/treasury-sweep.ts',
  'examples/healthtech/adherence-outreach.ts',
  'examples/healthtech/care-gap-priority.ts',
  'examples/healthtech/prior-authorization.ts',
] as const;

describe('stealth fixture corpus', () => {
  it.each(FIXTURE_PATHS)('parses, obfuscates, and exactly rehydrates %s', async (fixturePath) => {
    const source = await readFile(fixturePath, 'utf8');
    const map = new RenameMap(1_000, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(result.dialect).not.toBeNull();
    expect(result.renamed).toBe(true);
    expect(result.renamedCount).toBeGreaterThan(0);
    expect(result.output).not.toBe(source);
    expect(rehydrateText(result.output, map)).toBe(source);
  });
});
