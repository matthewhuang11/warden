import { describe, expect, it } from 'vitest';
import { RenameMap } from '../src/obfuscate/renameMap.js';
import { rehydrateText } from '../src/rehydrate/rehydrateText.js';

describe('rehydrateText', () => {
  it('rehydrates adjacent variable and type aliases in a type annotation', () => {
    const map = new RenameMap();
    expect(map.getOrCreate('RiskDecision', 'type')).toBe('type_1');
    expect(map.getOrCreate('limitingFactor', 'variable')).toBe('var_1');

    expect(rehydrateText("let var_1: type_1 = 'liquidity';", map)).toBe(
      "let limitingFactor: RiskDecision = 'liquidity';",
    );
  });

  it('still collapses an expanded shorthand property after rehydration', () => {
    const map = new RenameMap();
    expect(map.getOrCreate('approvedLimit', 'variable')).toBe('var_1');

    expect(rehydrateText('return { approvedLimit: var_1 };', map)).toBe('return { approvedLimit };');
  });
});
