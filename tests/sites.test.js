const { getSiteConfig, findFirst } = require('../src/sites');

describe('getSiteConfig', () => {
  test('matches the three supported hosts', () => {
    expect(getSiteConfig('chatgpt.com').key).toBe('chatgpt');
    expect(getSiteConfig('claude.ai').key).toBe('claude');
    expect(getSiteConfig('gemini.google.com').key).toBe('gemini');
  });

  test('matches a subdomain of a supported host', () => {
    expect(getSiteConfig('chat.chatgpt.com').key).toBe('chatgpt');
  });

  test('returns null for an unsupported host', () => {
    expect(getSiteConfig('example.com')).toBeNull();
    expect(getSiteConfig('')).toBeNull();
    expect(getSiteConfig(undefined)).toBeNull();
  });
});

describe('findFirst', () => {
  function fakeScope(matchingSelector) {
    return {
      querySelector(selector) {
        if (selector === 'throws') throw new Error('invalid selector');
        return selector === matchingSelector ? { tag: selector } : null;
      },
    };
  }

  test('returns the element for the first selector that matches', () => {
    const scope = fakeScope('#b');
    const el = findFirst(['#a', '#b', '#c'], scope);
    expect(el).toEqual({ tag: '#b' });
  });

  test('skips selectors that throw and keeps trying', () => {
    const scope = fakeScope('#c');
    const el = findFirst(['throws', '#c'], scope);
    expect(el).toEqual({ tag: '#c' });
  });

  test('returns null when nothing matches', () => {
    const scope = fakeScope('#nope');
    expect(findFirst(['#a', '#b'], scope)).toBeNull();
  });
});
