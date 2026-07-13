import { SyntheticMapper } from '../src/engine/syntheticMapper';

describe('SyntheticMapper: person tokens', () => {
  test('mints sequential Candidate_<Greek> tokens', () => {
    const mapper = new SyntheticMapper();
    expect(mapper.getOrCreate('John Smith', 'PERSON')).toBe('Candidate_Alpha');
    expect(mapper.getOrCreate('Jane Doe', 'PERSON')).toBe('Candidate_Beta');
  });

  test('is idempotent for the same real value (case-insensitive)', () => {
    const mapper = new SyntheticMapper();
    const first = mapper.getOrCreate('John Smith', 'PERSON');
    const second = mapper.getOrCreate('john smith', 'PERSON');
    expect(second).toBe(first);
    expect(mapper.size).toBe(1);
  });
});

describe('SyntheticMapper: organization tokens', () => {
  test('mints sequential Company_N tokens', () => {
    const mapper = new SyntheticMapper();
    expect(mapper.getOrCreate('Stripe', 'ORGANIZATION')).toBe('Company_1');
    expect(mapper.getOrCreate('Acme Corp', 'ORGANIZATION')).toBe('Company_2');
  });
});

describe('SyntheticMapper: money tokens', () => {
  test('preserves order of magnitude but changes the value', () => {
    const mapper = new SyntheticMapper();
    const synthetic = mapper.getOrCreate('$450,000', 'MONEY');
    expect(synthetic).not.toBe('$450,000');
    const numeric = parseFloat(synthetic.replace(/[^0-9.]/g, ''));
    expect(numeric).toBeGreaterThanOrEqual(100000);
    expect(numeric).toBeLessThan(1000000);
  });

  test('is deterministic for the same real value', () => {
    const mapperA = new SyntheticMapper();
    const mapperB = new SyntheticMapper();
    expect(mapperA.getOrCreate('$450,000', 'MONEY')).toBe(mapperB.getOrCreate('$450,000', 'MONEY'));
  });
});

describe('SyntheticMapper: email/phone/ssn tokens', () => {
  test('mints obviously-fake, sequential placeholders', () => {
    const mapper = new SyntheticMapper();
    expect(mapper.getOrCreate('jane@acme.com', 'EMAIL')).toBe('redacted.contact1@example.com');
    expect(mapper.getOrCreate('212-555-1234', 'PHONE')).toBe('555-0101');
    expect(mapper.getOrCreate('078-05-1120', 'SSN')).toBe('000-00-0001');
  });
});

describe('SyntheticMapper: reveal / getAllMappings / getRecords', () => {
  test('reveal() reverses a synthetic token back to the real value', () => {
    const mapper = new SyntheticMapper();
    const token = mapper.getOrCreate('John Smith', 'PERSON');
    expect(mapper.reveal(token)).toBe('John Smith');
    expect(mapper.reveal('Candidate_NotReal')).toBeUndefined();
  });

  test('getAllMappings() returns synthetic -> real', () => {
    const mapper = new SyntheticMapper();
    const token = mapper.getOrCreate('John Smith', 'PERSON');
    expect(mapper.getAllMappings()).toEqual({ [token]: 'John Smith' });
  });

  test('getRecords() includes type and a creation timestamp', () => {
    const mapper = new SyntheticMapper();
    mapper.getOrCreate('John Smith', 'PERSON');
    const records = mapper.getRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ real: 'John Smith', synthetic: 'Candidate_Alpha', type: 'PERSON' });
    expect(typeof records[0].createdAt).toBe('number');
  });
});

describe('SyntheticMapper: clear', () => {
  test('wipes the map and resets numbering', () => {
    const mapper = new SyntheticMapper();
    mapper.getOrCreate('John Smith', 'PERSON');
    expect(mapper.size).toBe(1);

    mapper.clear();
    expect(mapper.size).toBe(0);
    expect(mapper.getOrCreate('Jane Doe', 'PERSON')).toBe('Candidate_Alpha');
  });
});
