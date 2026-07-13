import { scanRegexEntities } from '../src/engine/regexScanner';

describe('scanRegexEntities: email', () => {
  test('finds a standard email address', () => {
    const matches = scanRegexEntities('Reach me at jane.doe@example.com please.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'EMAIL', value: 'jane.doe@example.com' });
  });
});

describe('scanRegexEntities: phone', () => {
  test.each(['212-555-1234', '212.555.1234', '(212) 555-1234'])('matches %s', (phone) => {
    const matches = scanRegexEntities(`Call ${phone} tomorrow.`);
    const phoneMatches = matches.filter((m) => m.type === 'PHONE');
    expect(phoneMatches).toHaveLength(1);
    expect(phoneMatches[0].value).toBe(phone);
  });
});

describe('scanRegexEntities: ssn', () => {
  test('finds a standard SSN', () => {
    const matches = scanRegexEntities('SSN on file: 078-05-1120.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'SSN', value: '078-05-1120' });
  });
});

describe('scanRegexEntities: money', () => {
  test('finds a comma-grouped dollar amount', () => {
    const matches = scanRegexEntities('The offer is $450,000 base salary.');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ type: 'MONEY', value: '$450,000' });
  });

  test('finds a dollar amount with cents', () => {
    const matches = scanRegexEntities('Invoice total: $1,250.50 due.');
    expect(matches.filter((m) => m.type === 'MONEY')).toHaveLength(1);
    expect(matches.find((m) => m.type === 'MONEY')?.value).toBe('$1,250.50');
  });

  test('ignores a bare number with no comma grouping or dollar sign', () => {
    const matches = scanRegexEntities('There are 450000 rows in the table.');
    expect(matches.filter((m) => m.type === 'MONEY')).toHaveLength(0);
  });
});

describe('scanRegexEntities: no matches', () => {
  test('returns an empty array for plain text', () => {
    expect(scanRegexEntities('What is the capital of France?')).toEqual([]);
  });

  test('returns an empty array for empty input', () => {
    expect(scanRegexEntities('')).toEqual([]);
  });
});

describe('scanRegexEntities: indices are accurate', () => {
  test('startIndex/endIndex slice back to the matched value', () => {
    const text = 'Email jane@example.com or call 212-555-1234, offer is $450,000.';
    const matches = scanRegexEntities(text);
    matches.forEach((m) => {
      expect(text.slice(m.startIndex, m.endIndex)).toBe(m.value);
    });
  });
});
