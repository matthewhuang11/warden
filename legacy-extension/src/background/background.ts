/**
 * Warden background service worker.
 *
 * Owns extension-wide, non-sensitive state only: default settings
 * initialization and the toolbar badge count. It never sees prompt text or
 * detected entity values -- those stay in each tab's content script memory.
 */
import { DEFAULT_SETTINGS } from './settingsStore';
import type { WardenMessage } from '../types';

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: '#3a6ed2' });
  chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => {
    chrome.storage.local.set(stored);
  });
});

chrome.runtime.onMessage.addListener((message: WardenMessage, sender) => {
  if (message.type === 'WARDEN_REDACTION_MADE' && sender.tab?.id !== undefined) {
    const text = message.payload.count > 0 ? String(message.payload.count) : '';
    chrome.action.setBadgeText({ text, tabId: sender.tab.id });
  }
});

// Clear the badge whenever a tab starts navigating so a stale count from the
// previous conversation never lingers on screen.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    chrome.action.setBadgeText({ text: '', tabId });
  }
});
