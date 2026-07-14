import { anonymize } from '../src/engine/anonymizer';
import { rehydrate, rehydrateDom } from '../src/engine/rehydrator';
import { SyntheticMapper } from '../src/engine/syntheticMapper';

describe('rehydrate: pure string swap', () => {
  test('restores a real value referenced in a response string', () => {
    const mapper = new SyntheticMapper();
    const { sanitizedText } = anonymize('Should we hire John Smith?', mapper);
    expect(sanitizedText).toBe('Should we hire Candidate_Alpha?');

    const response = 'Yes, Candidate_Alpha looks like a strong hire.';
    expect(rehydrate(response, mapper)).toBe('Yes, John Smith looks like a strong hire.');
  });

  test('restores multiple distinct tokens in the same response', () => {
    const mapper = new SyntheticMapper();
    anonymize('John Smith works at Stripe.', mapper);
    const response = 'Candidate_Alpha at Company_1 has 5 years of experience.';
    expect(rehydrate(response, mapper)).toBe('John Smith at Stripe has 5 years of experience.');
  });

  test('leaves text with no known tokens unchanged', () => {
    const mapper = new SyntheticMapper();
    expect(rehydrate('Nothing to reveal here.', mapper)).toBe('Nothing to reveal here.');
  });

  test('is a no-op on an empty mapper', () => {
    const mapper = new SyntheticMapper();
    expect(rehydrate('Candidate_Alpha should get an offer.', mapper)).toBe('Candidate_Alpha should get an offer.');
  });
});

describe('rehydrateDom: DOM text-node walking', () => {
  test('rehydrates a synthetic token found inside a text node', () => {
    const mapper = new SyntheticMapper();
    anonymize('John Smith is the candidate.', mapper);

    const container = document.createElement('div');
    container.innerHTML = '<p>We recommend hiring <strong>Candidate_Alpha</strong> immediately.</p>';
    document.body.appendChild(container);

    rehydrateDom(container, mapper);

    expect(container.textContent).toBe('We recommend hiring John Smith immediately.');
    document.body.removeChild(container);
  });

  test('does nothing when there are no known tokens', () => {
    const mapper = new SyntheticMapper();
    const container = document.createElement('div');
    container.innerHTML = '<p>Plain response text.</p>';

    rehydrateDom(container, mapper);

    expect(container.textContent).toBe('Plain response text.');
  });
});
