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

/**
 * Waits for the adapter's own hydration signal (if it has one) before we do
 * anything else. This is what prevents us from reading/writing a pre-
 * hydration DOM snapshot and racing React's own reconciliation of that
 * subtree -- adapters without an isHydrated() check are treated as always
 * ready, so this is a no-op for sites that don't need it.
 */
function waitForHydration(adapter: SiteAdapter, timeout = 8000, interval = 250): Promise<void> {
  return new Promise((resolve) => {
    if (!adapter.isHydrated) return resolve();
    const start = Date.now();
    const tick = () => {
      if (adapter.isHydrated!()) return resolve();
      if (Date.now() - start >= timeout) return resolve(); // proceed anyway; downstream lookups fail gracefully
      setTimeout(tick, interval);
    };
    tick();
  });
}

function getText(el: HTMLElement): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  // `||` (not `??`) deliberately: innerText can come back as a legitimate
  // empty string before layout has settled, and we still want the
  // textContent fallback in that case rather than silently returning ''.
  return el.innerText || el.textContent || '';
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

/**
 * Prefers the adapter's own extraction (e.g. chatgptAdapter's ProseMirror-
 * aware read) over the generic fallback. `context` is logged alongside the
 * extracted text so it's unambiguous which call site fired -- in particular,
 * the 'typing' context (from the debug-only input listener) never runs
 * anonymize(), so seeing it without a matching '[Warden] Anonymization
 * result' line afterwards is expected, not a bug.
 */
function readPromptText(adapter: SiteAdapter, el: HTMLElement, context: 'typing' | 'submit' | 'paste'): string {
  const text = adapter.getPromptText ? adapter.getPromptText(el) : getText(el);
  console.log(`[Warden] Extracted prompt text (${context}):`, text);
  return text;
}

function writePromptText(adapter: SiteAdapter, el: HTMLElement, text: string): void {
  if (adapter.setPromptText) {
    adapter.setPromptText(el, text);
  } else {
    setText(el, text);
  }
}

/**
 * Inserts sanitized text at the current cursor/selection rather than
 * replacing the whole field -- used for paste, where the browser has
 * already positioned the selection at the paste target and a full-field
 * replacement would clobber anything typed before/after it.
 */
function insertAtCursor(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const nextValue = el.value.slice(0, start) + text + el.value.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(el, nextValue);
    const cursor = start + text.length;
    el.setSelectionRange(cursor, cursor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, text);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
      range.collapse(false);
    } else {
      el.textContent = (el.textContent ?? '') + text;
    }
    el.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
    );
  }
}

async function init(adapter: SiteAdapter): Promise<void> {
  // Gate on the site's own hydration signal first (see waitForHydration) --
  // only once that's satisfied do we start reading/writing the DOM at all.
  await waitForHydration(adapter);

  const inputEl = await waitForElement(() => adapter.getInputElement());
  if (!inputEl) {
    console.warn(`[Warden] Could not find the message box on ${adapter.name}. Disabling for this page.`);
    return;
  }
  // Rebind as a fresh, non-nullable const so closures defined below (which
  // TS can't narrow `inputEl` through) get a properly-typed reference.
  const input: HTMLElement = inputEl;

  if (!adapter.getSendButton()) {
    console.warn(`[Warden] Could not find the send button on ${adapter.name}; falling back to Enter-key send only.`);
  }

  const mapper = new SyntheticMapper();
  let bypassNext = false;
  let sessionEnabled = true;

  // Mounted directly on <body> as an absolutely (fixed) positioned overlay
  // -- never inserted into the platform's own form/composer tree, so we can
  // never collide with React reconciling that subtree (the root cause of
  // hydration error #418 here).
  const overlayContainer = document.createElement('div');
  overlayContainer.id = 'warden-overlay-root';
  overlayContainer.style.position = 'fixed';
  overlayContainer.style.zIndex = '2147483647';
  document.body.appendChild(overlayContainer);

  const overlay: OverlayHandle = mountOverlay(overlayContainer, { count: 0, enabled: true }, (enabled) => {
    sessionEnabled = enabled;
  });

  function repositionOverlay(): void {
    const rect = input.getBoundingClientRect();
    const height = overlayContainer.offsetHeight || 32;
    overlayContainer.style.left = `${Math.max(rect.left, 8)}px`;
    overlayContainer.style.top = `${Math.max(rect.top - height - 8, 8)}px`;
  }

  requestAnimationFrame(repositionOverlay);
  window.addEventListener('resize', repositionOverlay);
  window.addEventListener('scroll', repositionOverlay, true);

  function triggerSend(): void {
    bypassNext = true;
    // Re-queried fresh rather than using a cached reference: ChatGPT swaps
    // this button's DOM node (e.g. toggling send/stop icons), and clicking a
    // stale detached node silently does nothing while still consuming
    // bypassNext -- that was causing the auto-resend to fail open, forcing a
    // manual retry that re-ran anonymize() over already-sanitized text.
    const currentSendBtn = adapter.getSendButton();
    if (currentSendBtn && currentSendBtn.isConnected && !(currentSendBtn as HTMLButtonElement).disabled) {
      currentSendBtn.click();
      return;
    }
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
  }

  function handleSubmitAttempt(event: Event): void {
    if (bypassNext) {
      bypassNext = false;
      return;
    }
    if (!sessionEnabled) return;

    const text = readPromptText(adapter, input, 'submit');
    if (!text || !text.trim()) {
      console.warn('[Warden] Submit aborted: extracted text was empty -- see chatgptAdapter.getPromptText / claudeAdapter selectors.');
      return;
    }

    const result = anonymize(text, mapper);
    console.log('[Warden] Anonymization result:', result);
    if (result.redactionCount === 0) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    writePromptText(adapter, input, result.sanitizedText);
    overlay.setCount(mapper.size);
    chrome.runtime.sendMessage<WardenMessage>({ type: 'WARDEN_REDACTION_MADE', payload: { count: mapper.size } });

    requestAnimationFrame(() => triggerSend());
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    handleSubmitAttempt(event);
  }

  /**
   * Pasted text bypasses the normal typed-then-submit flow entirely, so it
   * needs its own interception -- sanitize before the browser (or the
   * editor's own paste handling) ever inserts the clipboard content into
   * the DOM.
   *
   * ProseMirror-style editors register their own paste handler directly on
   * the contenteditable node itself (at EditorView construction, i.e. well
   * before our deliberately-delayed init() runs) and commonly call
   * stopImmediatePropagation() there to own the paste transaction. A
   * listener attached to that same node -- which is what we had before --
   * loses that race and never fires. Registering on `document` in the
   * capture phase instead guarantees we see the event while it's still
   * travelling *down* to the target, strictly before it ever reaches that
   * node-level listener.
   */
  function handlePaste(event: ClipboardEvent): void {
    if (!sessionEnabled) return;

    // Re-queried fresh (not the closed-over `input`) for the same reason
    // triggerSend() re-queries the send button: don't trust a DOM reference
    // captured once at init() to still be the live node.
    const currentInput = adapter.getInputElement();
    if (!currentInput) return;

    const target = event.target;
    const activeElement = document.activeElement;
    const pasteIsInsideInput =
      target instanceof Node &&
      (target === currentInput || currentInput.contains(target) || activeElement === currentInput || currentInput.contains(activeElement));
    if (!pasteIsInsideInput) return;

    const pastedText = event.clipboardData?.getData('text/plain') ?? '';
    console.log('[Warden] Extracted prompt text (paste):', pastedText);
    if (!pastedText) return;

    const result = anonymize(pastedText, mapper);
    console.log('[Warden] Anonymization result:', result);
    if (result.redactionCount === 0) return; // nothing sensitive -- let the paste proceed untouched

    event.preventDefault();
    event.stopPropagation();

    console.log('[Warden Paste Interceptor] Sanitized:', result);
    insertAtCursor(currentInput, result.sanitizedText);
    overlay.setCount(mapper.size);
    chrome.runtime.sendMessage<WardenMessage>({ type: 'WARDEN_REDACTION_MADE', payload: { count: mapper.size } });
  }

  /**
   * Debug visibility into extraction as the user types. This never runs
   * anonymize() -- it's purely a read, so seeing this log stream with no
   * "Anonymization result" following it is expected. Detection only runs on
   * an actual submit (Enter/click) or paste.
   */
  function handleInput(): void {
    readPromptText(adapter, input, 'typing');
  }

  // Delegated rather than attached to a single captured button reference --
  // re-resolves the current send button on every click, so it keeps working
  // even if the platform swaps out that DOM node (see triggerSend() above).
  document.addEventListener(
    'click',
    (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const currentSendBtn = adapter.getSendButton();
      if (currentSendBtn && (target === currentSendBtn || currentSendBtn.contains(target))) {
        handleSubmitAttempt(event);
      }
    },
    true
  );
  input.addEventListener('keydown', handleKeydown, true);
  // Global + capture, not attached to `input` -- see handlePaste's doc
  // comment for why the editor's own node-level paste handler would
  // otherwise win the race and block us from ever seeing the event.
  document.addEventListener('paste', handlePaste, true);
  input.addEventListener('input', handleInput);

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
    repositionOverlay();
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

/**
 * Defers all setup until the page has fully loaded (not just document_idle,
 * which can still race a React app's own client-side hydration), then waits
 * out one more idle/500ms window as a safety margin before we ever touch
 * the DOM. This -- combined with waitForHydration() and mounting the
 * overlay outside the page's own component tree -- is what fixes the
 * hydration mismatch (#418) we were causing on chatgpt.com.
 */
function bootWhenIdle(): void {
  const run = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => setTimeout(main, 500), { timeout: 2000 });
    } else {
      setTimeout(main, 500);
    }
  };

  if (document.readyState === 'complete') {
    run();
  } else {
    window.addEventListener('load', run, { once: true });
  }
}

bootWhenIdle();
