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
};
