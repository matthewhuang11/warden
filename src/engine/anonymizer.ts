import type { AnonymizeResult, EntityMatch, EntityType } from '../types';
import { scanRegexEntities } from './regexScanner';
import { SyntheticMapper } from './syntheticMapper';

const SENTENCE_STOPWORDS = new Set([
  'I', 'The', 'A', 'An', 'This', 'That', 'These', 'Those', 'My', 'Our', 'Your', 'His', 'Her', 'Its', 'Their',
  'Please', 'Hi', 'Hello', 'Hey', 'Dear', 'Thanks', 'Thank', 'Regards', 'Sincerely', 'Best',
  'Yes', 'No', 'Ok', 'Okay', 'So', 'But', 'And', 'Or', 'If', 'When', 'While', 'Because', 'However', 'Therefore',
  'Also', 'Just', 'Now', 'Today', 'Tomorrow', 'Yesterday',
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
]);

const ORG_SUFFIXES = new Set([
  'Inc', 'LLC', 'Corp', 'Corporation', 'Ltd', 'Co', 'Company', 'Group',
  'Technologies', 'Labs', 'Systems', 'Partners', 'Holdings', 'Ventures',
]);

// Small built-in gazetteer of well-known single-word company names. This is a
// practical MVP shortcut, not true NER -- extend as needed.
const KNOWN_ORGANIZATIONS = new Set([
  'Stripe', 'Google', 'Microsoft', 'Apple', 'Amazon', 'Meta', 'OpenAI', 'Anthropic', 'Salesforce',
  'Netflix', 'Airbnb', 'Uber', 'Lyft', 'Shopify', 'Square', 'PayPal', 'Visa', 'Mastercard', 'Oracle',
  'IBM', 'Intel', 'Nvidia', 'Adobe', 'Slack', 'Zoom', 'Dropbox', 'Twilio', 'Snowflake', 'Palantir',
]);

const CAPITALIZED_PHRASE_REGEX = /\b[A-Z][a-zA-Z'&-]*(?:\s+[A-Z][a-zA-Z'&-]*){0,3}\b/g;

function isLikelyOrganization(words: string[]): boolean {
  const last = words[words.length - 1].replace(/\.$/, '');
  if (ORG_SUFFIXES.has(last)) return true;
  if (words.length === 1 && KNOWN_ORGANIZATIONS.has(words[0])) return true;
  return false;
}

function isAllCapsAcronym(phrase: string): boolean {
  return /^[A-Z]{2,}$/.test(phrase);
}

/** Drops leading stopwords ("Dear John Smith" -> "John Smith") and reports the adjusted offset. */
function stripLeadingStopwords(phrase: string, startIndex: number): { phrase: string; startIndex: number } | null {
  let words = phrase.split(/\s+/);
  let offset = 0;
  while (words.length > 1 && SENTENCE_STOPWORDS.has(words[0])) {
    offset += words[0].length + 1; // word + the following space
    words = words.slice(1);
  }
  if (words.length === 0) return null;
  return { phrase: words.join(' '), startIndex: startIndex + offset };
}

function overlapsExisting(start: number, end: number, existing: EntityMatch[]): boolean {
  return existing.some((m) => start < m.endIndex && end > m.startIndex);
}

/**
 * Heuristic capitalized-phrase scan for likely person/organization names.
 * This is deliberately simple (title-case run detection + a stopword list +
 * a small org gazetteer/suffix list) rather than true NER, per the v1 MVP
 * scope -- expect some false positives/negatives.
 */
function scanCapitalizedEntities(text: string, existing: EntityMatch[]): EntityMatch[] {
  const matches: EntityMatch[] = [];

  for (const m of text.matchAll(CAPITALIZED_PHRASE_REGEX)) {
    const rawStart = m.index ?? 0;
    const stripped = stripLeadingStopwords(m[0], rawStart);
    if (!stripped) continue;

    const { phrase, startIndex } = stripped;
    const endIndex = startIndex + phrase.length;

    if (overlapsExisting(startIndex, endIndex, existing)) continue;
    if (isAllCapsAcronym(phrase)) continue;

    const words = phrase.split(/\s+/);
    // A single capitalized word is too ambiguous (often just sentence-initial
    // capitalization) unless it's a recognized organization name.
    if (words.length === 1 && !KNOWN_ORGANIZATIONS.has(words[0])) continue;

    const type: EntityType = isLikelyOrganization(words) ? 'ORGANIZATION' : 'PERSON';
    matches.push({ type, value: phrase, startIndex, endIndex });
  }

  return matches;
}

/** Leftmost-longest overlap resolution, shared across all detection modules. */
function resolveOverlaps(matches: EntityMatch[]): EntityMatch[] {
  const sorted = matches.slice().sort((a, b) => {
    if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
    return b.endIndex - b.startIndex - (a.endIndex - a.startIndex);
  });
  const result: EntityMatch[] = [];
  let lastEnd = -1;
  for (const m of sorted) {
    if (m.startIndex >= lastEnd) {
      result.push(m);
      lastEnd = m.endIndex;
    }
  }
  return result;
}

/**
 * Core orchestrator: scans `text` for sensitive entities (regex-based PII
 * plus heuristic name/org detection) and replaces each with a synthetic
 * token from `mapper`. Runs entirely in-memory -- no network calls.
 */
export function anonymize(text: string, mapper: SyntheticMapper): AnonymizeResult {
  if (!text) {
    return { sanitizedText: text, mappings: mapper.getAllMappings(), redactionCount: 0 };
  }

  const regexMatches = scanRegexEntities(text);
  const heuristicMatches = scanCapitalizedEntities(text, regexMatches);
  const resolved = resolveOverlaps([...regexMatches, ...heuristicMatches]);

  // Idempotency guard: a synthetic token we minted earlier this session (a
  // fake email, a shifted dollar amount, ...) can be syntactically
  // indistinguishable from real PII to the regex scanner. Without this, a
  // second anonymize() pass over already-sanitized text (e.g. from a
  // duplicate submit) would re-detect and re-tokenize its own output,
  // cascading with every re-run.
  const allMatches = resolved.filter((match) => mapper.reveal(match.value) === undefined);

  let sanitizedText = text;
  const rightToLeft = allMatches.slice().sort((a, b) => b.startIndex - a.startIndex);
  for (const match of rightToLeft) {
    const token = mapper.getOrCreate(match.value, match.type);
    sanitizedText = sanitizedText.slice(0, match.startIndex) + token + sanitizedText.slice(match.endIndex);
  }

  return {
    sanitizedText,
    mappings: mapper.getAllMappings(),
    redactionCount: allMatches.length,
  };
}
