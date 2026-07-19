import { describe, expect, it } from 'vitest';
import { formatUpstreamUrlForDisplay } from '../src/consoleOutput.js';

describe('formatUpstreamUrlForDisplay', () => {
  it('removes query strings and fragments before display or logging', () => {
    expect(formatUpstreamUrlForDisplay('https://example.test/api?api_key=secret#fragment')).toBe(
      'https://example.test/api',
    );
  });

  it('returns a safe placeholder for invalid URLs', () => {
    expect(formatUpstreamUrlForDisplay('not a URL')).toBe('[invalid upstream URL]');
  });
});
