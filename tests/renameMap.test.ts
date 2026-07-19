import { describe, expect, it } from 'vitest';
import { RenameMap } from '../src/obfuscate/renameMap.js';

describe('RenameMap bounds', () => {
  it('evicts the oldest mapping when its configured capacity is reached', () => {
    const map = new RenameMap(2);
    const first = map.getOrCreate('firstSecret', 'variable');
    const second = map.getOrCreate('secondSecret', 'variable');
    const third = map.getOrCreate('thirdSecret', 'variable');

    expect(map.size).toBe(2);
    expect(map.get('firstSecret')).toBeUndefined();
    expect(map.reverseLookup(first)).toBeUndefined();
    expect(map.get('secondSecret')).toBe(second);
    expect(map.reverseLookup(third)).toBe('thirdSecret');
  });
});
