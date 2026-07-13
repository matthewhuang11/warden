import type { EntityMatch, EntityType } from '../types';

const PATTERNS: Array<{ type: EntityType; regex: RegExp }> = [
  { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { type: 'SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    type: 'PHONE',
    regex: /\+\d{1,3}[\s-]?\d{4,14}\b|\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b|\b\d{3}[-.]\d{3}[-.]\d{4}\b/g,
  },
  // Exact dollar amounts, e.g. $450,000 or $450,000.00 -- requires the comma grouping
  // (bare numbers like "450000" are too ambiguous to flag as MONEY on their own).
  { type: 'MONEY', regex: /\$\d{1,3}(?:,\d{3})+(?:\.\d{2})?\b|\$\d+\.\d{2}\b/g },
];

/** Pure regex-based PII scan: emails, phone numbers, SSNs, and exact dollar amounts. */
export function scanRegexEntities(text: string): EntityMatch[] {
  if (!text) return [];
  const matches: EntityMatch[] = [];

  for (const { type, regex } of PATTERNS) {
    const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');
    for (const m of text.matchAll(re)) {
      const value = m[0];
      const startIndex = m.index ?? 0;
      matches.push({ type, value, startIndex, endIndex: startIndex + value.length });
    }
  }

  return matches;
}
