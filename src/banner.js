/**
 * Warden inline warning banner.
 *
 * Pure DOM component: builds and inserts a dismissible banner just above the
 * given anchor element (the platform's input box). No chrome.* APIs here so
 * it stays easy to reason about independent of extension plumbing.
 */
(function (root) {
  'use strict';

  const BANNER_ID = 'warden-banner';

  const CATEGORY_LABELS = {
    EMAIL: 'an email address',
    PHONE: 'a phone number',
    SSN: 'an SSN',
    CARD: 'a credit card number',
    IP: 'an IP address',
  };

  function formatCategoryList(types) {
    const names = types.map((t) => CATEGORY_LABELS[t] || `a ${t.toLowerCase()}`);
    const unique = Array.from(new Set(names));
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return unique.join(' and ');
    return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
  }

  function removeBanner(scope) {
    const container = scope || document;
    const existing = container.querySelector(`#${BANNER_ID}`);
    if (existing) existing.remove();
  }

  /**
   * @param {Object} opts
   * @param {Element} opts.anchorEl - element the banner is inserted above
   * @param {string[]} opts.types - detected category types, e.g. ['EMAIL', 'PHONE']
   * @param {() => void} [opts.onSendAsIs]
   * @param {() => void} [opts.onCleanUp]
   * @param {() => void} [opts.onDismiss]
   */
  function showBanner(opts) {
    const { anchorEl, types, onSendAsIs, onCleanUp, onDismiss } = opts;
    if (!anchorEl || !anchorEl.parentNode) return null;

    removeBanner(anchorEl.parentNode);

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.setAttribute('role', 'alert');

    const icon = document.createElement('span');
    icon.className = 'warden-banner-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '\u{1F6E1}️';

    const text = document.createElement('span');
    text.className = 'warden-banner-text';
    text.textContent = `This message includes ${formatCategoryList(types)}. Send as-is, or clean it up first?`;

    const actions = document.createElement('div');
    actions.className = 'warden-banner-actions';

    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.className = 'warden-btn warden-btn-secondary';
    sendBtn.textContent = 'Send as-is';
    sendBtn.addEventListener('click', () => {
      removeBanner(anchorEl.parentNode);
      if (onSendAsIs) onSendAsIs();
    });

    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'warden-btn warden-btn-primary';
    cleanBtn.textContent = 'Clean up & send';
    cleanBtn.addEventListener('click', () => {
      removeBanner(anchorEl.parentNode);
      if (onCleanUp) onCleanUp();
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'warden-banner-dismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', () => {
      removeBanner(anchorEl.parentNode);
      if (onDismiss) onDismiss();
    });

    actions.appendChild(sendBtn);
    actions.appendChild(cleanBtn);

    banner.appendChild(icon);
    banner.appendChild(text);
    banner.appendChild(actions);
    banner.appendChild(dismissBtn);

    anchorEl.parentNode.insertBefore(banner, anchorEl);
    return banner;
  }

  const api = { showBanner, removeBanner, formatCategoryList, BANNER_ID };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.WardenBanner = api;
  }
})(typeof self !== 'undefined' ? self : this);
