/**
 * Warden detection engine.
 *
 * Pure, dependency-free regex matching. No DOM access, no network calls.
 * Loaded as a plain script in the browser (exposes `WardenDetection` on
 * `self`/`window`) and as a CommonJS module under Jest.
 */
(function (root) {
  'use strict';

  function luhnCheck(digits) {
    let sum = 0;
    let alternate = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let n = parseInt(digits[i], 10);
      if (alternate) {
        n *= 2;
        if (n > 9) n -= 9;
      }
      sum += n;
      alternate = !alternate;
    }
    return sum % 10 === 0;
  }

  // Brand prefix/length rules used to decide whether a Luhn-valid digit run
  // actually looks like a real card number vs. an arbitrary long number.
  const CARD_BRAND_PATTERNS = [
    /^4\d{12}(\d{3})?(\d{3})?$/, // Visa: 13, 16, or 19 digits
    /^5[1-5]\d{14}$/, // Mastercard (legacy range)
    /^2(2[2-9]\d{12}|[3-6]\d{13}|7[01]\d{12}|720\d{12})$/, // Mastercard (2-series)
    /^3[47]\d{13}$/, // American Express: 15 digits
    /^6(?:011|5\d{2})\d{12}$/, // Discover: 16 digits
  ];

  function isCardNumber(digits) {
    if (digits.length < 13 || digits.length > 19) return false;
    if (!CARD_BRAND_PATTERNS.some((re) => re.test(digits))) return false;
    return luhnCheck(digits);
  }

  const BUILTIN_PATTERNS = [
    {
      type: 'EMAIL',
      regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    },
    {
      type: 'SSN',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    },
    {
      type: 'PHONE',
      regex: /\+\d{1,3}[\s-]?\d{4,14}\b|\(\d{3}\)\s?\d{3}[-.\s]\d{4}\b|\b\d{3}[-.]\d{3}[-.]\d{4}\b/g,
    },
    {
      type: 'IP',
      regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|1?\d{1,2})\b/g,
    },
    {
      type: 'CARD',
      regex: /\b(?:\d[ -]?){13,19}\b/g,
      // Reduces false positives on arbitrary long numbers: require a real
      // card brand prefix/length AND a passing Luhn checksum.
      postValidate: (rawMatch) => {
        const digits = rawMatch.replace(/[ -]/g, '');
        return isCardNumber(digits) ? digits : null;
      },
    },
  ];

  function ensureGlobalFlag(flags) {
    return flags && flags.includes('g') ? flags : (flags || '') + 'g';
  }

  function normalizeCustomPatterns(customPatterns) {
    return customPatterns
      .filter((p) => p && typeof p.type === 'string' && typeof p.pattern === 'string')
      .map((p) => {
        try {
          return { type: p.type, regex: new RegExp(p.pattern, p.flags || '') };
        } catch (err) {
          return null; // invalid user-supplied regex: skip rather than throw
        }
      })
      .filter(Boolean);
  }

  // Greedy leftmost-longest resolution: when two matches overlap, keep the
  // one that starts first, preferring the longer of any tied at the same
  // start.
  function resolveOverlaps(matches) {
    const sorted = matches.slice().sort((a, b) => {
      if (a.startIndex !== b.startIndex) return a.startIndex - b.startIndex;
      return (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex);
    });
    const result = [];
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
   * @param {string} text
   * @param {Array<{type: string, pattern: string, flags?: string}>} [customPatterns]
   * @returns {Array<{type: string, value: string, startIndex: number, endIndex: number}>}
   */
  function detect(text, customPatterns) {
    if (typeof text !== 'string' || text.length === 0) return [];

    const patterns = BUILTIN_PATTERNS.concat(normalizeCustomPatterns(customPatterns || []));
    const rawMatches = [];

    for (const pattern of patterns) {
      const regex = new RegExp(pattern.regex.source, ensureGlobalFlag(pattern.regex.flags));
      for (const m of text.matchAll(regex)) {
        const rawValue = m[0];
        if (pattern.postValidate && pattern.postValidate(rawValue) === null) continue;
        rawMatches.push({
          type: pattern.type,
          value: rawValue,
          startIndex: m.index,
          endIndex: m.index + rawValue.length,
        });
      }
    }

    return resolveOverlaps(rawMatches);
  }

  const api = { detect, luhnCheck, BUILTIN_PATTERNS };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WardenDetection = api;
  }
})(typeof self !== 'undefined' ? self : this);
