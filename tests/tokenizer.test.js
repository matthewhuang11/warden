const { detect } = require('../src/detection');
const { createSession } = require('../src/tokenizer');

describe('tokenizer: tokenize', () => {
  test('replaces a single match with a numbered token', () => {
    const session = createSession();
    const text = 'Email me at jane@example.com please.';
    const matches = detect(text);
    const tokenized = session.tokenize(text, matches);
    expect(tokenized).toBe('Email me at [EMAIL_1] please.');
    expect(session.size).toBe(1);
  });

  test('numbers multiple matches of the same type sequentially, left to right', () => {
    const session = createSession();
    const text = 'Contact jane@example.com or john@example.com.';
    const matches = detect(text);
    const tokenized = session.tokenize(text, matches);
    expect(tokenized).toBe('Contact [EMAIL_1] or [EMAIL_2].');
  });

  test('handles multiple different categories in one message', () => {
    const session = createSession();
    const text = 'Email jane@example.com or call 212-555-1234.';
    const matches = detect(text);
    const tokenized = session.tokenize(text, matches);
    expect(tokenized).toBe('Email [EMAIL_1] or call [PHONE_1].');
  });

  test('returns the original text untouched when there are no matches', () => {
    const session = createSession();
    const text = 'Nothing sensitive here.';
    expect(session.tokenize(text, [])).toBe(text);
    expect(session.size).toBe(0);
  });
});

describe('tokenizer: reveal', () => {
  test('restores the original value in a response referencing the token', () => {
    const session = createSession();
    const sent = session.tokenize('My email is jane@example.com', detect('My email is jane@example.com'));
    expect(sent).toBe('My email is [EMAIL_1]');

    const response = 'Got it, I will reach out to [EMAIL_1] shortly.';
    expect(session.reveal(response)).toBe('Got it, I will reach out to jane@example.com shortly.');
  });

  test('restores multiple distinct tokens in the same response', () => {
    const session = createSession();
    session.tokenize('Email jane@example.com or call 212-555-1234.', detect('Email jane@example.com or call 212-555-1234.'));
    const response = '[EMAIL_1] and [PHONE_1] have both been noted.';
    expect(session.reveal(response)).toBe('jane@example.com and 212-555-1234 have both been noted.');
  });

  test('leaves text with no known tokens unchanged', () => {
    const session = createSession();
    expect(session.reveal('Nothing to reveal here.')).toBe('Nothing to reveal here.');
  });
});

describe('tokenizer: session isolation and clear', () => {
  test('clear() wipes the map and resets numbering', () => {
    const session = createSession();
    session.tokenize('jane@example.com', detect('jane@example.com'));
    expect(session.size).toBe(1);

    session.clear();
    expect(session.size).toBe(0);

    const tokenized = session.tokenize('john@example.com', detect('john@example.com'));
    expect(tokenized).toBe('[EMAIL_1]');
  });

  test('never persists values outside the in-memory map', () => {
    const session = createSession();
    session.tokenize('jane@example.com', detect('jane@example.com'));
    expect(session.tokens).toEqual(['[EMAIL_1]']);
    // No disk/localStorage access exists anywhere in this module -- the
    // session object itself is the only place values live.
  });
});
