/**
 * Per-site DOM configuration.
 *
 * Selectors are best-effort against each platform's current markup. These
 * SPAs restructure their DOM without notice, so every lookup tries a list of
 * candidate selectors in order and the caller is expected to fail gracefully
 * (disable itself on that page) rather than throw if none match -- see
 * findFirst() below and its usage in content-script.js.
 */
(function (root) {
  'use strict';

  const SITES = {
    'chatgpt.com': {
      key: 'chatgpt',
      name: 'ChatGPT',
      inputSelectors: [
        '#prompt-textarea',
        'div[contenteditable="true"]#prompt-textarea',
        'form div[contenteditable="true"]',
        'form textarea',
      ],
      sendButtonSelectors: [
        'button[data-testid="send-button"]',
        'button[aria-label="Send prompt"]',
        'button[aria-label*="Send" i]',
      ],
      responseContainerSelectors: [
        'div[data-message-author-role="assistant"]:last-of-type',
        'main [data-testid^="conversation-turn"]:last-of-type',
        'main',
      ],
    },
    'claude.ai': {
      key: 'claude',
      name: 'Claude',
      inputSelectors: [
        'div[contenteditable="true"].ProseMirror',
        'div[aria-label="Write your prompt to Claude"]',
        'div[contenteditable="true"]',
      ],
      sendButtonSelectors: [
        'button[aria-label="Send message"]',
        'button[aria-label*="Send" i]',
      ],
      responseContainerSelectors: [
        'div[data-testid="chat-messages"]',
        'main',
      ],
    },
    'gemini.google.com': {
      key: 'gemini',
      name: 'Gemini',
      inputSelectors: [
        'rich-textarea div[contenteditable="true"]',
        'div.ql-editor[contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      sendButtonSelectors: [
        'button[aria-label="Send message"]',
        'button.send-button[aria-label*="Send" i]',
        'button[aria-label*="Send" i]',
      ],
      responseContainerSelectors: [
        'div.conversation-container:last-of-type',
        'main',
      ],
    },
  };

  function getSiteConfig(hostname) {
    if (!hostname) return null;
    const key = Object.keys(SITES).find(
      (domain) => hostname === domain || hostname.endsWith('.' + domain)
    );
    return key ? SITES[key] : null;
  }

  /** Tries each selector in order against `scope` (defaults to document), returns the first element found or null. */
  function findFirst(selectors, scope) {
    const target = scope || (typeof document !== 'undefined' ? document : null);
    if (!target) return null;
    for (const selector of selectors) {
      try {
        const el = target.querySelector(selector);
        if (el) return el;
      } catch (err) {
        // Selector unsupported/invalid in this context -- try the next one.
      }
    }
    return null;
  }

  const api = { SITES, getSiteConfig, findFirst };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WardenSites = api;
  }
})(typeof self !== 'undefined' ? self : this);
