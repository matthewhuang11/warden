import { anonymize } from '../src/engine/anonymizer';
import { SyntheticMapper } from '../src/engine/syntheticMapper';

describe('anonymize: PII via regex', () => {
  test('redacts an email address', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('Reach me at jane@example.com.', mapper);
    expect(result.sanitizedText).toBe('Reach me at redacted.contact1@example.com.');
    expect(result.redactionCount).toBe(1);
  });

  test('redacts a dollar amount while preserving magnitude', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('The offer was $450,000.', mapper);
    expect(result.sanitizedText).not.toContain('450,000');
    expect(result.sanitizedText).toMatch(/\$\d{1,3}(,\d{3})*/);
  });
});

describe('anonymize: heuristic person/organization detection', () => {
  test('redacts a two-word capitalized name as PERSON', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('John Smith should get the offer.', mapper);
    expect(result.sanitizedText).toBe('Candidate_Alpha should get the offer.');
  });

  test('redacts a known single-word company as ORGANIZATION', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('We use Stripe for payments.', mapper);
    expect(result.sanitizedText).toBe('We use Company_1 for payments.');
  });

  test('redacts a company with a recognized suffix as ORGANIZATION', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('Acme Corp signed the deal.', mapper);
    expect(result.sanitizedText).toBe('Company_1 signed the deal.');
  });

  test('does not redact a leading sentence stopword as part of a name', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('Dear John Smith, thanks for applying.', mapper);
    expect(result.sanitizedText).toBe('Dear Candidate_Alpha, thanks for applying.');
  });

  test('ignores an ambiguous single capitalized word', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('Monday will be busy.', mapper);
    expect(result.sanitizedText).toBe('Monday will be busy.');
    expect(result.redactionCount).toBe(0);
  });

  test('ignores an all-caps acronym', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('Please check the API docs.', mapper);
    expect(result.sanitizedText).toBe('Please check the API docs.');
  });
});

describe('anonymize: combined categories in one message', () => {
  test('redacts every category and repeats map to the same token', () => {
    const mapper = new SyntheticMapper();
    const text = 'John Smith (jane@example.com) at Stripe wants $450,000 for the John Smith deal.';
    const result = anonymize(text, mapper);

    expect(result.sanitizedText).not.toContain('John Smith');
    expect(result.sanitizedText).not.toContain('jane@example.com');
    expect(result.sanitizedText).not.toContain('Stripe');
    expect(result.sanitizedText).not.toContain('450,000');

    const personTokenCount = (result.sanitizedText.match(/Candidate_Alpha/g) || []).length;
    expect(personTokenCount).toBe(2); // both "John Smith" mentions map to the same token
  });
});

describe('anonymize: idempotency against its own synthetic tokens', () => {
  test('re-running anonymize on already-sanitized text is a no-op', () => {
    const mapper = new SyntheticMapper();
    const original = 'Contact Mark Davis at mark.davis@stripe.com about the $450,000 offer.';
    const first = anonymize(original, mapper);
    expect(first.redactionCount).toBeGreaterThan(0);

    const second = anonymize(first.sanitizedText, mapper);
    expect(second.sanitizedText).toBe(first.sanitizedText);
    expect(second.redactionCount).toBe(0);
  });

  test('a synthetic email token is not re-detected as a fresh EMAIL match', () => {
    const mapper = new SyntheticMapper();
    const token = mapper.getOrCreate('jane@example.com', 'EMAIL');
    const result = anonymize(`Reach out to ${token} please.`, mapper);
    expect(result.redactionCount).toBe(0);
    expect(result.sanitizedText).toBe(`Reach out to ${token} please.`);
  });

  test('a synthetic dollar amount is not re-detected as a fresh MONEY match', () => {
    const mapper = new SyntheticMapper();
    const token = mapper.getOrCreate('$450,000', 'MONEY');
    const result = anonymize(`The offer is ${token} total.`, mapper);
    expect(result.redactionCount).toBe(0);
    expect(result.sanitizedText).toBe(`The offer is ${token} total.`);
  });

  test('a genuinely new entity alongside an old token is still redacted', () => {
    const mapper = new SyntheticMapper();
    const first = anonymize('Contact jane@example.com about it.', mapper);
    const second = anonymize(`${first.sanitizedText} Also loop in john@example.com.`, mapper);
    expect(second.redactionCount).toBe(1);
    expect(second.sanitizedText).not.toContain('john@example.com');
  });
});

describe('anonymize: no sensitive content', () => {
  test('returns the original text unchanged', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('What is the capital of France?', mapper);
    expect(result.sanitizedText).toBe('What is the capital of France?');
    expect(result.redactionCount).toBe(0);
  });

  test('handles empty input', () => {
    const mapper = new SyntheticMapper();
    const result = anonymize('', mapper);
    expect(result.sanitizedText).toBe('');
    expect(result.redactionCount).toBe(0);
  });
});
