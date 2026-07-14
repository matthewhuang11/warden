import type { WardenSettings } from '../types';

/**
 * Shared, non-sensitive settings storage (chrome.storage.local). Only
 * on/off toggles live here -- detected entities and their real values never
 * leave the content script's in-memory SyntheticMapper.
 */
export const DEFAULT_SETTINGS: WardenSettings = {
  enabled: true,
  sites: { chatgpt: true, claude: true },
};

export function loadSettings(): Promise<WardenSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(DEFAULT_SETTINGS, (stored) => resolve(stored as WardenSettings));
  });
}

export function saveSettings(partial: Partial<WardenSettings>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(partial, () => resolve());
  });
}
