/**
 * Warden tokenizer.
 *
 * Owns the in-memory, tab-scoped map of placeholder token -> real value.
 * Nothing here ever touches disk/localStorage — callers are responsible for
 * calling clear() on tab close / navigation away from the conversation.
 */
(function (root) {
  'use strict';

  function createSession() {
    const counters = Object.create(null);
    const tokenMap = new Map(); // token -> original value

    function resetCounters() {
      for (const key of Object.keys(counters)) delete counters[key];
    }

    function nextToken(type) {
      counters[type] = (counters[type] || 0) + 1;
      return `[${type}_${counters[type]}]`;
    }

    /**
     * Replaces each detected span with a placeholder token and records the
     * mapping for later reveal(). Numbering restarts at 1 per type for each
     * call (i.e. per message), per spec.
     *
     * @param {string} text
     * @param {Array<{type: string, value: string, startIndex: number, endIndex: number}>} matches
     * @returns {string} the tokenized text
     */
    function tokenize(text, matches) {
      if (typeof text !== 'string' || !matches || matches.length === 0) return text;

      resetCounters();

      const assigned = matches
        .slice()
        .sort((a, b) => a.startIndex - b.startIndex)
        .map((m) => ({ ...m, token: nextToken(m.type) }));

      let result = text;
      assigned
        .slice()
        .sort((a, b) => b.startIndex - a.startIndex) // right-to-left so earlier indices stay valid
        .forEach((m) => {
          tokenMap.set(m.token, m.value);
          result = result.slice(0, m.startIndex) + m.token + result.slice(m.endIndex);
        });

      return result;
    }

    /**
     * Replaces any known placeholder tokens found in `text` with their real
     * values. Exact-string match only; reformatted/pluralized tokens in the
     * AI's response are a known, accepted v1 limitation.
     */
    function reveal(text) {
      if (typeof text !== 'string' || tokenMap.size === 0) return text;
      let result = text;
      for (const [token, value] of tokenMap.entries()) {
        if (result.includes(token)) {
          result = result.split(token).join(value);
        }
      }
      return result;
    }

    function clear() {
      tokenMap.clear();
      resetCounters();
    }

    return {
      tokenize,
      reveal,
      clear,
      get size() {
        return tokenMap.size;
      },
      get tokens() {
        return Array.from(tokenMap.keys());
      },
    };
  }

  const api = { createSession };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WardenTokenizer = api;
  }
})(typeof self !== 'undefined' ? self : this);
