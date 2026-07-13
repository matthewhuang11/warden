import type { SiteAdapter } from '../../types';
import { findFirst } from './findFirst';

const INPUT_SELECTORS = [
  'div[contenteditable="true"].ProseMirror',
  'div[aria-label="Write your prompt to Claude"]',
  'div[contenteditable="true"]',
];

const SEND_BUTTON_SELECTORS = [
  'button[aria-label="Send message"]',
  'button[aria-label*="Send" i]',
];

export const claudeAdapter: SiteAdapter = {
  key: 'claude',
  name: 'Claude',
  matchesHost(hostname) {
    return hostname === 'claude.ai' || hostname.endsWith('.claude.ai');
  },
  getInputElement() {
    return findFirst(INPUT_SELECTORS);
  },
  getSendButton() {
    return findFirst(SEND_BUTTON_SELECTORS);
  },
};
