/**
 * InstarVision — Bridge (ISOLATED world)
 * 
 * Bridges between the MAIN world interceptor and the
 * extension APIs (chrome.storage, chrome.runtime).
 * 
 * Communication:
 *   MAIN → ISOLATED: CustomEvent '__instar_blocked'
 *   ISOLATED → MAIN: CustomEvent '__instar_config'
 */
(function () {
  'use strict';

  const STORAGE_KEY = 'instarVision';
  const DEFAULT_CONFIG = {
    enabled: false,
    totalBlocked: 0,
    sessionBlocked: 0,
    recentLog: [],
    customRules: null, // null = use defaults
  };

  // Use chrome or browser namespace
  const api = typeof chrome !== 'undefined' ? chrome : (typeof browser !== 'undefined' ? browser : null);

  if (!api || !api.storage) {
    console.warn('[InstarVision Bridge] No extension API available');
    return;
  }

  // ─── Load config and push to MAIN world ────────────────────────────
  async function loadAndPush() {
    try {
      const result = await api.storage.local.get(STORAGE_KEY);
      const config = { ...DEFAULT_CONFIG, ...(result[STORAGE_KEY] || {}) };

      // Push enabled state + custom rules to MAIN world
      const detail = { enabled: config.enabled };
      if (config.customRules) {
        detail.rules = config.customRules;
      }

      window.postMessage({ type: '__instar_config', config: detail }, '*');
    } catch (err) {
      console.warn('[InstarVision Bridge] Load error:', err);
    }
  }

  // Push config on load
  loadAndPush();

  // ─── Listen for blocked notifications from MAIN world ─────────────
  window.addEventListener('message', async (e) => {
    if (e.source !== window || !e.data || e.data.type !== '__instar_blocked') return;
    try {
      const { count, entry } = e.data;

      // Update storage
      const result = await api.storage.local.get(STORAGE_KEY);
      const config = { ...DEFAULT_CONFIG, ...(result[STORAGE_KEY] || {}) };

      config.sessionBlocked = count;
      config.totalBlocked = (config.totalBlocked || 0) + 1;

      // Keep last 50 log entries
      if (!Array.isArray(config.recentLog)) config.recentLog = [];
      config.recentLog.push(entry);
      if (config.recentLog.length > 50) {
        config.recentLog = config.recentLog.slice(-50);
      }

      await api.storage.local.set({ [STORAGE_KEY]: config });

      // Notify background to update badge
      try {
        api.runtime.sendMessage({
          type: 'blocked',
          count: config.totalBlocked,
          sessionCount: count,
        });
      } catch { /* background might not be running */ }
    } catch (err) {
      console.warn('[InstarVision Bridge] Block event error:', err);
    }
  });

  // ─── Listen for storage changes (e.g., popup toggled enabled) ─────
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[STORAGE_KEY]) {
      const newVal = changes[STORAGE_KEY].newValue || {};
      const oldVal = changes[STORAGE_KEY].oldValue || {};

      // If enabled state changed, push to MAIN world
      if (newVal.enabled !== oldVal.enabled) {
        window.postMessage({ type: '__instar_config', config: { enabled: newVal.enabled } }, '*');
      }

      // If rules changed, push to MAIN world
      if (JSON.stringify(newVal.customRules) !== JSON.stringify(oldVal.customRules)) {
        if (newVal.customRules) {
          window.postMessage({ type: '__instar_config', config: { rules: newVal.customRules } }, '*');
        }
      }
    }
  });

  console.debug('[InstarVision Bridge] 🌉 Bridge loaded');
})();
