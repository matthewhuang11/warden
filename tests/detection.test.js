const { detect, luhnCheck } = require('../src/detection');

describe('detect: email', () => {
  test('finds a standard email address', () => {
    const matches = detect('Reach me at jane.doe+work@example.co.uk please.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'EMAIL', value: 'jane.doe+work@example.co.uk' });
  });
});

describe('detect: phone', () => {
  test.each([
    ['212-555-1234'],
    ['212.555.1234'],
    ['(212) 555-1234'],
    ['+44 7911123456'],
  ])('matches %s', (phone) => {
    const matches = detect(`Call ${phone} tomorrow.`);
    const phoneMatches = matches.filter((m) => m.type === 'PHONE');
    expect(phoneMatches).toHaveLength(1);
    expect(phoneMatches[0].value).toBe(phone);
  });
});

describe('detect: ssn', () => {
  test('finds a standard SSN', () => {
    const matches = detect('SSN: 078-05-1120 on file.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'SSN', value: '078-05-1120' });
  });
});

describe('detect: ip address', () => {
  test('finds a valid IPv4 address', () => {
    const matches = detect('The server lives at 192.168.1.1 internally.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'IP', value: '192.168.1.1' });
  });

  test('does not treat an out-of-range octet as an IP', () => {
    const matches = detect('Version 999.999.999.999 is not real.');
    expect(matches.filter((m) => m.type === 'IP')).toHaveLength(0);
  });
});

describe('detect: credit card', () => {
  test('finds a Luhn-valid Visa test number', () => {
    const matches = detect('Card on file: 4111111111111111.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'CARD', value: '4111111111111111' });
  });

  test('finds a Luhn-valid Mastercard test number with separators', () => {
    const matches = detect('Card: 5555-5555-5555-4444 exp 10/28');
    expect(matches.filter((m) => m.type === 'CARD')).toHaveLength(1);
  });

  test('finds a Luhn-valid Amex test number', () => {
    const matches = detect('Amex 378282246310005 on the account.');
    expect(matches.filter((m) => m.type === 'CARD')).toHaveLength(1);
  });

  test('ignores a long number that fails the brand/Luhn check', () => {
    const matches = detect('Order id 1234567890123456 was shipped.');
    expect(matches.filter((m) => m.type === 'CARD')).toHaveLength(0);
  });

  test('luhnCheck validates known test numbers', () => {
    expect(luhnCheck('4111111111111111')).toBe(true);
    expect(luhnCheck('1234567890123456')).toBe(false);
  });
});

describe('detect: multiple categories in one message', () => {
  test('finds every category and returns them ordered by position', () => {
    const text = 'Email jane@example.com or call 212-555-1234, SSN 078-05-1120, server 10.0.0.1.';
    const matches = detect(text);
    const types = matches.map((m) => m.type);
    expect(types).toEqual(['EMAIL', 'PHONE', 'SSN', 'IP']);
    matches.forEach((m) => {
      expect(text.slice(m.startIndex, m.endIndex)).toBe(m.value);
    });
  });
});

describe('detect: no sensitive content', () => {
  test('returns an empty array for plain text', () => {
    expect(detect('What is the capital of France?')).toEqual([]);
  });

  test('returns an empty array for empty/invalid input', () => {
    expect(detect('')).toEqual([]);
    expect(detect(undefined)).toEqual([]);
  });
});

describe('detect: custom patterns', () => {
  test('matches a user-supplied pattern alongside built-ins', () => {
    const customPatterns = [{ type: 'EMPLOYEE_ID', pattern: '\\bEMP-\\d{5}\\b' }];
    const matches = detect('My badge is EMP-00231, email jane@example.com', customPatterns);
    expect(matches.map((m) => m.type)).toEqual(['EMPLOYEE_ID', 'EMAIL']);
  });

  test('silently ignores an invalid user-supplied regex', () => {
    const customPatterns = [{ type: 'BROKEN', pattern: '(' }];
    expect(() => detect('hello world', customPatterns)).not.toThrow();
  });
});

describe('detect: overlap resolution', () => {
  test('does not double-count a phone number inside a longer digit run', () => {
    const matches = detect('Reference 212-555-1234 for support.');
    expect(matches).toHaveLength(1);
  });
});
