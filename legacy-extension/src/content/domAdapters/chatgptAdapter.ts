import type { SiteAdapter } from '../../types';
import { findFirst } from './findFirst';

const INPUT_SELECTORS = [
  '#prompt-textarea',
  'div[contenteditable="true"]#prompt-textarea',
  'form div[contenteditable="true"]',
  'form textarea',
];

const SEND_BUTTON_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label*="Send" i]',
];

/**
 * Reads the current prompt text. ChatGPT's composer is a ProseMirror
 * contenteditable div, not a <textarea> -- `innerText` is the right read for
 * that, but it can legitimately come back as an empty string (e.g. before
 * layout has settled), so this falls back to `textContent` with `||` rather
 * than `??` (which only catches null/undefined, not '').
 */
export function getPromptText(inputEl: HTMLElement): string {
  if (inputEl instanceof HTMLTextAreaElement) {
    return inputEl.value;
  }
  return inputEl.innerText || inputEl.textContent || '';
}

/**
 * Writes the prompt text back. For the contenteditable case, execCommand is
 * used first since it fires the real `beforeinput`/`input` events ChatGPT's
 * React/ProseMirror state listens for; direct `innerText` assignment plus a
 * manually dispatched InputEvent is the fallback if execCommand is
 * unavailable.
 */
export function setPromptText(inputEl: HTMLElement, newText: string): void {
  if (inputEl instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    setter?.call(inputEl, newText);
    inputEl.dispatchEvent(new InputEvent('input', { bubbles: true }));
    return;
  }

  inputEl.focus();
  const range = document.createRange();
  range.selectNodeContents(inputEl);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);

  let inserted = false;
  try {
    inserted = document.execCommand('insertText', false, newText);
  } catch {
    inserted = false;
  }

  if (!inserted) {
    inputEl.innerText = newText;
    inputEl.dispatchEvent(
      new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: newText })
    );
  }
}

export const chatgptAdapter: SiteAdapter = {
  key: 'chatgpt',
  name: 'ChatGPT',
  matchesHost(hostname) {
    return hostname === 'chatgpt.com' || hostname.endsWith('.chatgpt.com');
  },
  getInputElement() {
    return findFirst(INPUT_SELECTORS);
  },
  getSendButton() {
    return findFirst(SEND_BUTTON_SELECTORS);
  },
  getPromptText,
  setPromptText,
  isHydrated() {
    // ChatGPT's composer renders the input box and its send button together
    // once React has finished hydrating that part of the tree; requiring
    // both (rather than just the input) avoids acting on a pre-hydration
    // DOM snapshot and injecting into it while React is still reconciling,
    // which is what was causing hydration error #418.
    const input = findFirst(INPUT_SELECTORS);
    const sendButton = findFirst(SEND_BUTTON_SELECTORS);
    return !!input && input.isConnected && !!sendButton && sendButton.isConnected;
  },
};
