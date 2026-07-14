import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from '../background/settingsStore';
import type { MappingRecord, SiteKey, WardenMessage, WardenSettings } from '../types';

interface TabState {
  supported: boolean;
  enabled: boolean;
  siteEnabled: boolean;
  redactionCount: number;
  mappings: MappingRecord[];
}

function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] ?? null));
  });
}

function getTabState(tabId: number): Promise<TabState | null> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage<WardenMessage, WardenMessage>(tabId, { type: 'WARDEN_GET_STATE' }, (response) => {
      if (chrome.runtime.lastError || !response || response.type !== 'WARDEN_STATE_RESPONSE') {
        resolve(null);
        return;
      }
      resolve(response.payload);
    });
  });
}

function clearTabSession(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { type: 'WARDEN_CLEAR_SESSION' }, () => resolve());
  });
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={`relative h-5 w-9 rounded-full transition-colors ${checked ? 'bg-warden-accent' : 'bg-warden-border'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : ''
        }`}
      />
    </button>
  );
}

function SiteRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

export function Popup() {
  const [settings, setSettings] = useState<WardenSettings | null>(null);
  const [tabId, setTabId] = useState<number | null>(null);
  const [tabState, setTabState] = useState<TabState | null>(null);
  const [loading, setLoading] = useState(true);

  async function refreshTabState() {
    const tab = await getActiveTab();
    if (tab?.id !== undefined) {
      setTabId(tab.id);
      setTabState(await getTabState(tab.id));
    } else {
      setTabId(null);
      setTabState(null);
    }
  }

  useEffect(() => {
    (async () => {
      setSettings(await loadSettings());
      await refreshTabState();
      setLoading(false);
    })();
  }, []);

  async function toggleEnabled() {
    if (!settings) return;
    const next = { ...settings, enabled: !settings.enabled };
    setSettings(next);
    await saveSettings({ enabled: next.enabled });
    refreshTabState();
  }

  async function toggleSite(site: SiteKey) {
    if (!settings) return;
    const nextSites = { ...settings.sites, [site]: !settings.sites[site] };
    const next = { ...settings, sites: nextSites };
    setSettings(next);
    await saveSettings({ sites: nextSites });
    refreshTabState();
  }

  async function handleClear() {
    if (tabId === null) return;
    await clearTabSession(tabId);
    refreshTabState();
  }

  if (loading || !settings) {
    return <div className="w-80 bg-warden-bg p-4 text-sm text-warden-text">Loading...</div>;
  }

  const count = tabState?.redactionCount ?? 0;
  const mappings = tabState?.mappings ?? [];

  return (
    <div className="w-80 bg-warden-bg font-sans text-warden-text">
      <header className="flex items-center gap-2 border-b border-warden-border px-4 py-3">
        <span className="text-xl">🛡️</span>
        <div>
          <h1 className="text-sm font-semibold">Warden</h1>
          <p className="text-[11px] text-warden-muted">Privacy, before you hit send.</p>
        </div>
      </header>

      <section className="flex items-center justify-between border-b border-warden-border px-4 py-3">
        <span className="text-sm">Warden {settings.enabled ? 'Active' : 'Inactive'}</span>
        <Toggle checked={settings.enabled} onChange={toggleEnabled} />
      </section>

      <section className="border-b border-warden-border bg-warden-card px-4 py-3">
        <p className="text-sm">
          <span className="font-semibold">{count}</span> redaction{count === 1 ? '' : 's'} saved this session
        </p>
        {!tabState?.supported && (
          <p className="mt-1 text-[11px] text-warden-muted">Not available on this page.</p>
        )}
      </section>

      <section className="border-b border-warden-border px-4 py-3">
        <h2 className="mb-2 text-[11px] uppercase tracking-wide text-warden-muted">Active on</h2>
        <div className="flex flex-col gap-2">
          <SiteRow label="ChatGPT" checked={settings.sites.chatgpt} onChange={() => toggleSite('chatgpt')} />
          <SiteRow label="Claude" checked={settings.sites.claude} onChange={() => toggleSite('claude')} />
        </div>
      </section>

      <section className="px-4 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-wide text-warden-muted">Ephemeral mappings</h2>
          <button
            type="button"
            onClick={handleClear}
            disabled={mappings.length === 0}
            className="text-[11px] text-red-300 hover:text-red-200 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Clear RAM storage
          </button>
        </div>
        {mappings.length === 0 ? (
          <p className="text-[11px] text-warden-muted">No active mappings this session.</p>
        ) : (
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
            {mappings.map((m) => (
              <li
                key={m.synthetic}
                className="flex items-center gap-1 rounded bg-warden-card px-2 py-1 text-[11px]"
              >
                <span className="truncate">{m.real}</span>
                <span className="text-warden-muted">➔</span>
                <span className="truncate text-warden-accentLight">{m.synthetic}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
