/**
 * Shared, non-sensitive settings storage (chrome.storage.local).
 *
 * Only extension configuration lives here (on/off toggles, custom regex
 * patterns) -- never detected/tokenized message content, which stays
 * in-memory only (see tokenizer.js).
 */
(function (root) {
  'use strict';

  const DEFAULT_SETTINGS = {
    enabled: true,
    sites: { chatgpt: true, claude: true, gemini: true },
    customPatterns: [],
  };

  function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => resolve(stored));
    });
  }

  function saveSettings(partial) {
    return new Promise((resolve) => {
      chrome.storage.local.set(partial, resolve);
    });
  }

  const api = { DEFAULT_SETTINGS, loadSettings, saveSettings };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WardenSettings = api;
  }
})(typeof self !== 'undefined' ? self : this);
