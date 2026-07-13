/**
 * Warden content script.
 *
 * Wires the anonymization engine + DOM adapters + floating overlay together
 * against the live page. This is the only file that touches chrome.* APIs
 * or the DOM directly -- the engine it depends on is independently
 * unit-tested and has zero network calls anywhere in its code path.
 */
import { getAdapterForHost } from './domAdapters';
import { mountOverlay, type OverlayHandle } from './uiOverlay';
import { anonymize } from '../engine/anonymizer';
import { SyntheticMapper } from '../engine/syntheticMapper';
import { rehydrateDom } from '../engine/rehydrator';
import { loadSettings } from '../background/settingsStore';
import type { SiteAdapter, WardenMessage } from '../types';

function waitForElement(
  getter: () => HTMLElement | null,
  timeout = 10000,
  interval = 400
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const el = getter();
      if (el) return resolve(el);
      if (Date.now() - start >= timeout) return resolve(null);
      setTimeout(tick, interval);
    };
    tick();
  });
}

function getText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  return el.innerText ?? el.textContent ?? '';
}

function setText(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  // Contenteditable editors (ProseMirror-style) generally only stay in sync
  // with their own internal model when the change comes through a real
  // input event. execCommand is deprecated but is still the most reliable
  // cross-framework way to trigger that; direct textContent assignment is
  // the fallback if it's unavailable.
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    el.textContent = text;
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
    );
  }
}

async function init(adapter: SiteAdapter): Promise<void> {
  const inputEl = await waitForElement(() => adapter.getInputElement());
  if (!inputEl) {
    console.warn(`[Warden] Could not find the message box on ${adapter.name}. Disabling for this page.`);
    return;
  }

  const sendBtn = adapter.getSendButton();
  if (!sendBtn) {
    console.warn(`[Warden] Could not find the send button on ${adapter.name}; falling back to Enter-key send only.`);
  }

  const mapper = new SyntheticMapper();
  let bypassNext = false;
  let sessionEnabled = true;

  const overlayContainer = document.createElement('div');
  overlayContainer.id = 'warden-overlay-root';
  inputEl.parentElement?.insertBefore(overlayContainer, inputEl);

  const overlay: OverlayHandle = mountOverlay(overlayContainer, { count: 0, enabled: true }, (enabled) => {
    sessionEnabled = enabled;
  });

  function triggerSend(): void {
    bypassNext = true;
    if (sendBtn && !(sendBtn as HTMLButtonElement).disabled) {
      sendBtn.click();
      return;
    }
    inputEl?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  }

  function handleSubmitAttempt(event: Event): void {
    if (bypassNext) {
      bypassNext = false;
      return;
    }
    if (!sessionEnabled || !inputEl) return;

    const text = getText(inputEl);
    if (!text || !text.trim()) return;

    const result = anonymize(text, mapper);
    if (result.redactionCount === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    setText(inputEl, result.sanitizedText);
    overlay.setCount(mapper.size);
    chrome.runtime.sendMessage<WardenMessage>({ type: 'WARDEN_REDACTION_MADE', payload: { count: mapper.size } });

    requestAnimationFrame(() => triggerSend());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    handleSubmitAttempt(event);
  }

  sendBtn?.addEventListener('click', handleSubmitAttempt, true);
  inputEl.addEventListener('keydown', handleKeydown, true);

  // Observe streaming responses and swap synthetic tokens back to real values.
  let revealPending = false;
  const observer = new MutationObserver(() => {
    if (mapper.size === 0 || revealPending) return;
    revealPending = true;
    setTimeout(() => {
      revealPending = false;
      rehydrateDom(document.body, mapper);
    }, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });

  // These are SPAs: starting a new conversation changes the URL without a
  // full page reload, so the content script never re-injects. Treat that as
  // "navigated away from the conversation" and clear the in-memory session.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      mapper.clear();
      overlay.setCount(0);
    }
  }, 750);

  chrome.runtime.onMessage.addListener((message: WardenMessage, _sender, sendResponse) => {
    if (message.type === 'WARDEN_GET_STATE') {
      sendResponse({
        type: 'WARDEN_STATE_RESPONSE',
        payload: {
          supported: true,
          enabled: sessionEnabled,
          siteEnabled: true,
          redactionCount: mapper.size,
          mappings: mapper.getRecords(),
        },
      });
    } else if (message.type === 'WARDEN_CLEAR_SESSION') {
      mapper.clear();
      overlay.setCount(0);
      sendResponse({ ok: true });
    }
  });
}

async function main(): Promise<void> {
  const settings = await loadSettings();
  const adapter = getAdapterForHost(location.hostname);
  if (!adapter) return;

  const siteEnabled = adapter.key === 'chatgpt' ? settings.sites.chatgpt : settings.sites.claude;

  if (!settings.enabled || !siteEnabled) {
    // Still answer the popup so it can render accurate on/off state.
    chrome.runtime.onMessage.addListener((message: WardenMessage, _sender, sendResponse) => {
      if (message.type === 'WARDEN_GET_STATE') {
        sendResponse({
          type: 'WARDEN_STATE_RESPONSE',
          payload: { supported: true, enabled: settings.enabled, siteEnabled, redactionCount: 0, mappings: [] },
        });
      }
    });
    return;
  }

  await init(adapter);
}

main();
