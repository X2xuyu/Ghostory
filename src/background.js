/**
 * InstarVision — Background Service Worker
 * 
 * Handles badge updates, pattern refresh, and messaging.
 */

const STORAGE_KEY = 'instarVision';

// ─── Badge management ────────────────────────────────────────────────
function updateBadge(count, enabled) {
  const text = count > 0 ? String(count) : '';
  const color = enabled ? '#22c55e' : '#ef4444'; // green / red

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setTitle({
    title: enabled
      ? `InstarVision — ${count} blocked`
      : 'InstarVision — DISABLED',
  });
}

// ─── Message handler ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'blocked') {
    updateBadge(msg.sessionCount, true);
  }

  if (msg.type === 'getStatus') {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      sendResponse(result[STORAGE_KEY] || {});
    });
    return true; // async response
  }

  if (msg.type === 'toggle') {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const config = result[STORAGE_KEY] || {};
      config.enabled = !config.enabled;
      chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
        updateBadge(config.sessionBlocked || 0, config.enabled);
        sendResponse({ enabled: config.enabled });
      });
    });
    return true;
  }

  if (msg.type === 'resetCount') {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const config = result[STORAGE_KEY] || {};
      config.totalBlocked = 0;
      config.sessionBlocked = 0;
      config.recentLog = [];
      chrome.storage.local.set({ [STORAGE_KEY]: config }, () => {
        updateBadge(0, config.enabled !== false);
        sendResponse({ ok: true });
      });
    });
    return true;
  }
});

// ─── Install handler ─────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    chrome.storage.local.set({
      [STORAGE_KEY]: {
        enabled: false,
        totalBlocked: 0,
        sessionBlocked: 0,
        recentLog: [],
        customRules: null,
      },
    });
    updateBadge(0, false);
    console.log('[InstarVision] Extension installed (disabled by default)');
  }
});

// ─── Startup ─────────────────────────────────────────────────────────
chrome.runtime.onStartup?.addListener(() => {
  chrome.storage.local.get(STORAGE_KEY, (result) => {
    const config = result[STORAGE_KEY] || {};
    // Reset session count on browser restart
    config.sessionBlocked = 0;
    chrome.storage.local.set({ [STORAGE_KEY]: config });
    updateBadge(0, config.enabled !== false);
  });
});

console.log('[InstarVision] Background service worker started');
