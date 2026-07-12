/**
 * Warden content script.
 *
 * Wires detection.js + tokenizer.js + banner.js + sites.js together against
 * the live page. This is the only file that touches chrome.* APIs or the
 * DOM directly -- everything it depends on is independently unit-tested.
 *
 * No network calls anywhere in this file. Settings live in chrome.storage
 * (local, non-sensitive); detected/tokenized values never leave the
 * in-memory session map created below.
 */
(function () {
  'use strict';

  function waitForElement(selectors, { timeout = 10000, interval = 400 } = {}) {
    return new Promise((resolve) => {
      const start = Date.now();
      const tick = () => {
        const el = WardenSites.findFirst(selectors);
        if (el) return resolve(el);
        if (Date.now() - start >= timeout) return resolve(null);
        setTimeout(tick, interval);
      };
      tick();
    });
  }

  function getText(el) {
    if (!el) return '';
    if (el.tagName === 'TEXTAREA') return el.value;
    return el.innerText !== undefined ? el.innerText : el.textContent || '';
  }

  function setText(el, text) {
    if (!el) return;
    if (el.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    // Contenteditable editors (ProseMirror/Quill-style) generally only stay
    // in sync with their own internal model when the change comes through a
    // real input event. execCommand is deprecated but is still the most
    // reliable cross-framework way to trigger that; direct textContent
    // assignment is the fallback if it's unavailable.
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = false;
    try {
      inserted = document.execCommand('insertText', false, text);
    } catch (err) {
      inserted = false;
    }

    if (!inserted) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    }
  }

  function revealTokensInDom(session) {
    if (session.size === 0) return;
    const tokens = session.tokens;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const original = node.nodeValue;
      if (!original) continue;
      if (!tokens.some((t) => original.includes(t))) continue;
      const revealed = session.reveal(original);
      if (revealed !== original) node.nodeValue = revealed;
    }
  }

  async function init(siteConfig, settings) {
    const inputEl = await waitForElement(siteConfig.inputSelectors);
    if (!inputEl) {
      console.warn(`[Warden] Could not find the message box on ${siteConfig.name}. Disabling for this page.`);
      return null;
    }
    const sendBtn = WardenSites.findFirst(siteConfig.sendButtonSelectors);
    if (!sendBtn) {
      console.warn(`[Warden] Could not find the send button on ${siteConfig.name}; will fall back to Enter-key send only.`);
    }

    const session = WardenTokenizer.createSession();
    let protectedCount = 0;
    let bypassNext = false;

    function triggerSend() {
      bypassNext = true;
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return;
      }
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    }

    function handleSubmitAttempt(event) {
      if (bypassNext) {
        bypassNext = false;
        return;
      }

      const text = getText(inputEl);
      if (!text || !text.trim()) return;

      const matches = WardenDetection.detect(text, settings.customPatterns);
      if (matches.length === 0) return;

      event.preventDefault();
      event.stopImmediatePropagation();

      WardenBanner.showBanner({
        anchorEl: inputEl,
        types: matches.map((m) => m.type),
        onSendAsIs: () => {
          triggerSend();
        },
        onCleanUp: () => {
          const tokenized = session.tokenize(text, matches);
          setText(inputEl, tokenized);
          protectedCount += matches.length;
          requestAnimationFrame(() => triggerSend());
        },
      });
    }

    function handleKeydown(event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
      handleSubmitAttempt(event);
    }

    if (sendBtn) sendBtn.addEventListener('click', handleSubmitAttempt, true);
    inputEl.addEventListener('keydown', handleKeydown, true);

    let revealPending = false;
    const observer = new MutationObserver(() => {
      if (session.size === 0 || revealPending) return;
      revealPending = true;
      setTimeout(() => {
        revealPending = false;
        revealTokensInDom(session);
      }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    // These are SPAs: sending a new chat / switching conversations changes
    // the URL without a page reload, so the content script never
    // re-injects. Treat that as "navigated away from the conversation" per
    // spec and clear the in-memory session.
    let lastHref = location.href;
    setInterval(() => {
      if (location.href !== lastHref) {
        lastHref = location.href;
        session.clear();
        protectedCount = 0;
      }
    }, 750);

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message && message.type === 'WARDEN_GET_STATE') {
        sendResponse({
          supported: true,
          enabled: true,
          siteEnabled: true,
          siteName: siteConfig.name,
          count: protectedCount,
        });
      }
    });

    return { session };
  }

  async function main() {
    const settings = await WardenSettings.loadSettings();
    const siteConfig = WardenSites.getSiteConfig(location.hostname);

    const shouldRun = !!siteConfig && settings.enabled && !!settings.sites[siteConfig.key];

    if (!shouldRun) {
      // Still answer the popup so it can render accurate on/off state.
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message && message.type === 'WARDEN_GET_STATE') {
          sendResponse({
            supported: !!siteConfig,
            enabled: settings.enabled,
            siteEnabled: siteConfig ? !!settings.sites[siteConfig.key] : false,
            siteName: siteConfig ? siteConfig.name : null,
            count: 0,
          });
        }
      });
      return;
    }

    init(siteConfig, settings);
  }

  main();
})();
