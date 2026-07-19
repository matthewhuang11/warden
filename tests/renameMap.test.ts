import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenameMap } from '../src/obfuscate/renameMap.js';

describe('RenameMap bounds', () => {
  afterEach(() => vi.useRealTimers());

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

  it('expires mappings after idle time and refreshes them on access', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const map = new RenameMap(10, 1000);
    const synthetic = map.getOrCreate('idleSecret', 'variable');

    vi.advanceTimersByTime(900);
    expect(map.get('idleSecret')).toBe(synthetic);
    vi.advanceTimersByTime(900);
    expect(map.reverseLookup(synthetic)).toBe('idleSecret');
    vi.advanceTimersByTime(1001);
    expect(map.get('idleSecret')).toBeUndefined();
    expect(map.reverseLookup(synthetic)).toBeUndefined();
  });
});
