(function () {
  'use strict';

  const enabledToggle = document.getElementById('toggle-enabled');
  const siteToggles = Array.from(document.querySelectorAll('[data-site]'));
  const countText = document.getElementById('count-text');
  const siteStatus = document.getElementById('site-status');
  const settingsLink = document.getElementById('settings-link');

  function getActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0] || null));
    });
  }

  function getTabState(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { type: 'WARDEN_GET_STATE' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve(null); // no content script on this page -- unsupported site
          return;
        }
        resolve(response);
      });
    });
  }

  function renderCount(state) {
    if (!state || !state.supported) {
      countText.textContent = 'Not available on this page';
      return;
    }
    const n = state.count || 0;
    countText.textContent = `${n} item${n === 1 ? '' : 's'} protected this session`;
  }

  function renderSiteStatus(state) {
    if (!state || !state.supported) {
      siteStatus.textContent = 'Warden works on chatgpt.com, claude.ai, and gemini.google.com.';
      return;
    }
    if (!state.enabled) {
      siteStatus.textContent = 'Warden is turned off.';
    } else if (!state.siteEnabled) {
      siteStatus.textContent = `Protection is off for ${state.siteName}.`;
    } else {
      siteStatus.textContent = `Active on ${state.siteName}.`;
    }
  }

  async function refreshFromActiveTab() {
    const tab = await getActiveTab();
    const state = tab ? await getTabState(tab.id) : null;
    renderCount(state);
    renderSiteStatus(state);
  }

  async function init() {
    const settings = await WardenSettings.loadSettings();

    enabledToggle.checked = !!settings.enabled;
    siteToggles.forEach((toggle) => {
      const site = toggle.dataset.site;
      toggle.checked = !!settings.sites[site];
    });

    await refreshFromActiveTab();

    enabledToggle.addEventListener('change', async () => {
      await WardenSettings.saveSettings({ enabled: enabledToggle.checked });
      refreshFromActiveTab();
    });

    siteToggles.forEach((toggle) => {
      toggle.addEventListener('change', async () => {
        const current = await WardenSettings.loadSettings();
        const sites = Object.assign({}, current.sites, { [toggle.dataset.site]: toggle.checked });
        await WardenSettings.saveSettings({ sites });
        refreshFromActiveTab();
      });
    });

    settingsLink.addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }

  init();
})();
