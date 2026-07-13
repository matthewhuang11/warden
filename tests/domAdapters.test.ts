import { chatgptAdapter, claudeAdapter, getAdapterForHost } from '../src/content/domAdapters';
import { findFirst } from '../src/content/domAdapters/findFirst';

describe('site matching', () => {
  test('chatgptAdapter matches chatgpt.com and subdomains', () => {
    expect(chatgptAdapter.matchesHost('chatgpt.com')).toBe(true);
    expect(chatgptAdapter.matchesHost('chat.chatgpt.com')).toBe(true);
    expect(chatgptAdapter.matchesHost('claude.ai')).toBe(false);
  });

  test('claudeAdapter matches claude.ai and subdomains', () => {
    expect(claudeAdapter.matchesHost('claude.ai')).toBe(true);
    expect(claudeAdapter.matchesHost('www.claude.ai')).toBe(true);
    expect(claudeAdapter.matchesHost('chatgpt.com')).toBe(false);
  });
});

describe('getAdapterForHost', () => {
  test('resolves the right adapter per host', () => {
    expect(getAdapterForHost('chatgpt.com')?.key).toBe('chatgpt');
    expect(getAdapterForHost('claude.ai')?.key).toBe('claude');
  });

  test('returns null for an unsupported host', () => {
    expect(getAdapterForHost('gemini.google.com')).toBeNull();
    expect(getAdapterForHost('example.com')).toBeNull();
  });
});

describe('findFirst', () => {
  test('returns the element for the first selector that matches', () => {
    document.body.innerHTML = '<div id="b">hi</div>';
    const el = findFirst(['#a', '#b', '#c']);
    expect(el?.id).toBe('b');
  });

  test('returns null when nothing matches', () => {
    document.body.innerHTML = '<div id="z"></div>';
    expect(findFirst(['#a', '#b'])).toBeNull();
  });

  test('skips a selector that throws and keeps trying', () => {
    document.body.innerHTML = '<div id="c"></div>';
    // ":::" is not a valid CSS selector and should be skipped without throwing.
    expect(findFirst([':::', '#c'])?.id).toBe('c');
  });
});
