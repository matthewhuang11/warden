import { readFileSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

interface FixtureManifest {
  tuning: string[];
  heldOut: string[];
}

const manifest = JSON.parse(readFileSync('examples/fixture-manifest.json', 'utf8')) as FixtureManifest;
const fixturePaths = [...manifest.tuning, ...manifest.heldOut];

describe('stealth fixture corpus', () => {
  it('keeps tuning and held-out membership complete, disjoint, and cross-domain', async () => {
    expect(manifest.tuning).toHaveLength(6);
    expect(manifest.heldOut).toHaveLength(2);
    expect(new Set(fixturePaths).size).toBe(fixturePaths.length);
    expect(manifest.tuning.some((path) => path.includes('/fintech/'))).toBe(true);
    expect(manifest.tuning.some((path) => path.includes('/healthtech/'))).toBe(true);
    expect(manifest.heldOut.some((path) => path.includes('/fintech/'))).toBe(true);
    expect(manifest.heldOut.some((path) => path.includes('/healthtech/'))).toBe(true);

    const corpusFiles = (await readdir('examples/fixtures', { recursive: true }))
      .filter((path) => path.endsWith('.ts'))
      .map((path) => `examples/fixtures/${path}`)
      .sort();
    expect([...fixturePaths].sort()).toEqual(corpusFiles);
  });

  it.each(fixturePaths)('parses, obfuscates, and exactly rehydrates %s', async (fixturePath) => {
    const source = await readFile(fixturePath, 'utf8');
    const map = new RenameMap(1_000, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(result.dialect).not.toBeNull();
    expect(result.renamed).toBe(true);
    expect(result.renamedCount).toBeGreaterThan(0);
    expect(result.output).not.toBe(source);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it.each([0, 1, 2])('does not exhaust stealth variable vocabulary for the corpus in theme %i', async (theme) => {
    for (const fixturePath of fixturePaths) {
      const source = await readFile(fixturePath, 'utf8');
      const map = new RenameMap(1_000, 60_000, 'stealth', theme);
      await obfuscateCode(source, map);
      expect(map.usedStealthFallback, fixturePath).toBe(false);
    }
  });
});
