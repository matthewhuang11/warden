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
