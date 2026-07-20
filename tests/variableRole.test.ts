import { describe, expect, it } from 'vitest';
import { obfuscateCode } from '../src/obfuscate/obfuscateCode.js';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

// Regression coverage for the finding behind the final stealth spec: a
// Math.max(0, x - y) clamp was given a name implying a raw, unclamped
// value, and a subtraction remainder was named as if it were a direct
// value. The fix classifies each variable's computational role from its
// initializer's AST shape and draws its replacement name from a
// role-appropriate pool, so the fake name never implies a different role
// than the one the expression actually has.
describe('semantic-role-aware variable naming', () => {
  it('names a clamped/floored value as bounded, not as a raw unclamped quantity', async () => {
    const source = [
      'function settle(balance, reserved) {',
      '  const availableBalance = Math.max(0, balance - reserved);',
      '  return availableBalance;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(map.get('availableBalance')).toMatch(/bounded|capped|floor|clamp|limit/i);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('names an arithmetic difference/remainder as a computed delta, not a direct value', async () => {
    const source = [
      'function settle(total, reserved) {',
      '  const remainingBalance = total - reserved;',
      '  return remainingBalance;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(map.get('remainingBalance')).toMatch(/shortfall|variance|remaining|overage|difference/i);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('names a boolean gate/condition result as an eligibility check, not a plain value', async () => {
    const source = [
      'function evaluate(score, status) {',
      '  const outcomeFlag = score > 0 && status === "active";',
      '  return outcomeFlag;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(map.get('outcomeFlag')).toMatch(/meets|qualified|passes|bounds|criteria|eligible|check/i);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('names an accumulator as a running/cumulative total, not a raw seed value', async () => {
    const source = [
      'function sumValues(items) {',
      '  let runningSum = 0;',
      '  for (const item of items) {',
      '    runningSum += item.value;',
      '  }',
      '  return runningSum;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(map.get('runningSum')).toMatch(/running|accumulated|cumulative|aggregated|sum/i);
    expect(rehydrateText(result.output, map)).toBe(source);
  });

  it('leaves a direct pass-through value in the plain variable pool, not a role-specific one', async () => {
    const source = [
      'function label(record) {',
      '  const accountLabel = record.name;',
      '  return accountLabel;',
      '}',
    ].join('\n');
    const map = new RenameMap(100, 60_000, 'stealth', 0);
    const result = await obfuscateCode(source, map);

    expect(map.get('accountLabel')).not.toMatch(
      /bounded|capped|floor|clamp|limit|shortfall|variance|remaining|overage|difference|meets|qualified|passes|bounds|criteria|eligible|running|accumulated|cumulative|aggregated/i,
    );
    expect(rehydrateText(result.output, map)).toBe(source);
  });
});
