import { describe, expect, it } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

describe('stealth aliases', () => {
  it('uses plausible aliases without compact placeholder signatures', async () => {
    const source = [
      'function calculateRenewalOffer(record) {',
      '  const accountRiskMultiplier = record.multiplier;',
      '  const renewalResult = accountRiskMultiplier * 2;',
      '  return renewalResult;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth');
    const result = await obfuscateCode(source, map);

    expect(result.renamed).toBe(true);
    expect(result.output).not.toMatch(/\b(?:func|var|class|str)_\d+\b/);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('avoids aliases already present in the source', async () => {
    const source = [
      'function calculateRenewalOffer(record) {',
      '  const resolveRecord = record.value;',
      '  return resolveRecord;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth');
    const result = await obfuscateCode(source, map);

    expect(result.output).not.toContain('resolveRecord(record)');
    expect(result.output).not.toMatch(/internal enterprise pricing details/);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('emits hashed audit events for each protected category', async () => {
    const source = [
      '// confidential renewal pricing note',
      'function calculateRenewalOffer(record) {',
      '  const pricingMessage = "Internal enterprise renewal multiplier for strategic accounts";',
      '  return record.value;',
      '}',
    ].join('\n');
    const result = await obfuscateCode(source, new RenameMap(100, 60_000, 'stealth'));

    expect(result.auditEvents.map((event) => event.category)).toEqual(['identifier', 'identifier', 'comment', 'string']);
    expect(result.auditEvents.every((event) => /^[a-f0-9]{64}$/.test(event.valueHash))).toBe(true);
    expect(result.auditEvents.every((event) => !event.valueHash.includes('pricing'))).toBe(true);
  });
});
