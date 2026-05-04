/**
 * InstarVision — Core Interceptor (MAIN world)
 * 
 * Overrides fetch, XMLHttpRequest, and navigator.sendBeacon
 * to block Instagram story "seen" telemetry requests.
 * 
 * Runs in document_start before IG bundles load,
 * ensuring we capture the original references.
 */
(function () {
  'use strict';

  const EXTENSION_TAG = '[InstarVision]';

  // ─── Default block patterns ────────────────────────────────────────
  // These can be updated dynamically via bridge.js / chrome.storage
  let blockRules = [
    // Primary: Story Seen Mutation (THE target)
    { type: 'friendly_name', pattern: /PolarisStoriesV3SeenMutation/i },
    { type: 'body', pattern: /viewSeenAt/i },
    { type: 'body', pattern: /reelSeen/i },

    // Secondary: Telemetry & logging endpoints
    { type: 'url', pattern: /\/logging_client_events\b/i },
    { type: 'url', pattern: /\/video\/unified_cvc\//i },
    { type: 'body', pattern: /story_view/i },
    { type: 'body', pattern: /PolarisStories.*Seen.*Mutation/i },

    // Beacon-style batch telemetry
    { type: 'url', pattern: /\/ajax\/bz\b/i },
  ];

  // Global state
  let enabled = false;
  let blockedCount = 0;
  const blockedLog = [];

  // ─── Pattern matching engine ───────────────────────────────────────

  /**
   * Stringify body for inspection (handles FormData, URLSearchParams, etc.)
   */
  function bodyToString(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    if (body instanceof URLSearchParams) return body.toString();
    if (body instanceof ArrayBuffer) {
      try { return new TextDecoder().decode(body); } catch { return ''; }
    }
    if (body instanceof Uint8Array) {
      try { return new TextDecoder().decode(body); } catch { return ''; }
    }
    // FormData — iterate entries
    if (typeof FormData !== 'undefined' && body instanceof FormData) {
      const parts = [];
      body.forEach((v, k) => parts.push(`${k}=${v}`));
      return parts.join('&');
    }
    try { return JSON.stringify(body); } catch { return ''; }
  }

  /**
   * Extract X-Fb-Friendly-Name from fetch init headers
   */
  function getFriendlyName(init) {
    if (!init || !init.headers) return '';
    // Headers object
    if (typeof Headers !== 'undefined' && init.headers instanceof Headers) {
      return init.headers.get('X-Fb-Friendly-Name') || '';
    }
    // Plain object
    if (typeof init.headers === 'object' && !Array.isArray(init.headers)) {
      return init.headers['X-Fb-Friendly-Name'] || init.headers['x-fb-friendly-name'] || '';
    }
    // Array of [key, value] pairs
    if (Array.isArray(init.headers)) {
      const entry = init.headers.find(([k]) =>
        k.toLowerCase() === 'x-fb-friendly-name'
      );
      return entry ? entry[1] : '';
    }
    return '';
  }

  /**
   * Determine if a request should be blocked
   * @returns {string|false} - matched rule description or false
   */
  function shouldBlock(url, init) {
    if (!enabled) return false;

    const urlStr = (typeof url === 'string' ? url : url?.url) || '';
    const bodyStr = bodyToString(init?.body);
    const friendlyName = getFriendlyName(init);

    for (const rule of blockRules) {
      const regex = rule.pattern instanceof RegExp
        ? rule.pattern
        : new RegExp(rule.pattern, 'i');

      switch (rule.type) {
        case 'friendly_name':
          if (friendlyName && regex.test(friendlyName)) {
            return `friendly_name: ${friendlyName}`;
          }
          break;
        case 'url':
          if (regex.test(urlStr)) {
            return `url: ${urlStr.substring(0, 80)}`;
          }
          break;
        case 'body':
          if (regex.test(bodyStr)) {
            return `body match: ${regex.source}`;
          }
          break;
      }
    }
    return false;
  }

  /**
   * Log a blocked request and notify bridge
   */
  function logBlock(method, matchInfo) {
    blockedCount++;
    const entry = {
      time: Date.now(),
      method,
      match: matchInfo,
    };
    blockedLog.push(entry);
    // Keep only last 50 entries
    if (blockedLog.length > 50) blockedLog.shift();

    console.debug(`${EXTENSION_TAG} 🛡️ BLOCKED [${method}] ${matchInfo}`);

    // Notify bridge (isolated world) via CustomEvent
    try {
      window.dispatchEvent(new CustomEvent('__instar_blocked', {
        detail: { count: blockedCount, entry },
      }));
    } catch { /* swallow */ }
  }

  // ─── 1. Override fetch ─────────────────────────────────────────────
  const origFetch = window.fetch;

  window.fetch = function (input, init) {
    const matchInfo = shouldBlock(input, init);
    if (matchInfo) {
      logBlock('fetch', matchInfo);
      // Return a convincing fake 200 response
      return Promise.resolve(new Response(
        JSON.stringify({ status: 'ok', data: {} }),
        {
          status: 200,
          statusText: 'OK',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        }
      ));
    }
    return origFetch.apply(this, arguments);
  };

  // Preserve prototype chain
  Object.defineProperty(window.fetch, 'name', { value: 'fetch' });

  // ─── 2. Override XMLHttpRequest ────────────────────────────────────
  const OrigXHR = window.XMLHttpRequest;
  const origOpen = OrigXHR.prototype.open;
  const origSend = OrigXHR.prototype.send;
  const origSetRequestHeader = OrigXHR.prototype.setRequestHeader;

  OrigXHR.prototype.open = function (method, url, ...rest) {
    this.__iv_url = url;
    this.__iv_method = method;
    this.__iv_headers = {};
    return origOpen.apply(this, [method, url, ...rest]);
  };

  OrigXHR.prototype.setRequestHeader = function (name, value) {
    if (this.__iv_headers) {
      this.__iv_headers[name] = value;
    }
    return origSetRequestHeader.apply(this, arguments);
  };

  OrigXHR.prototype.send = function (body) {
    const fakeInit = {
      body,
      headers: this.__iv_headers || {},
    };
    const matchInfo = shouldBlock(this.__iv_url, fakeInit);

    if (matchInfo) {
      logBlock('XHR', matchInfo);

      // Simulate a successful XHR lifecycle
      const self = this;
      const fakeResponseText = '{"status":"ok"}';

      Object.defineProperty(self, 'readyState', { writable: true, value: 4 });
      Object.defineProperty(self, 'status', { writable: true, value: 200 });
      Object.defineProperty(self, 'statusText', { writable: true, value: 'OK' });
      Object.defineProperty(self, 'responseText', { writable: true, value: fakeResponseText });
      Object.defineProperty(self, 'response', { writable: true, value: fakeResponseText });
      Object.defineProperty(self, 'responseURL', { writable: true, value: self.__iv_url || '' });

      // Fire events async to mimic real network behavior
      setTimeout(() => {
        try { self.onreadystatechange?.call(self, new Event('readystatechange')); } catch { }
        try { self.onload?.call(self, new ProgressEvent('load')); } catch { }
        try { self.dispatchEvent(new Event('readystatechange')); } catch { }
        try { self.dispatchEvent(new ProgressEvent('load')); } catch { }
        try { self.dispatchEvent(new ProgressEvent('loadend')); } catch { }
      }, 0);

      return; // Don't actually send
    }

    return origSend.apply(this, arguments);
  };

  // ─── 3. Override navigator.sendBeacon ──────────────────────────────
  const origBeacon = navigator.sendBeacon?.bind(navigator);

  if (origBeacon) {
    navigator.sendBeacon = function (url, data) {
      const fakeInit = { body: data };
      const matchInfo = shouldBlock(url, fakeInit);

      if (matchInfo) {
        logBlock('beacon', matchInfo);
        return true; // Tell caller it "succeeded"
      }
      return origBeacon(url, data);
    };
  }

  // ─── 4. Listen for config updates from bridge ─────────────────────
  window.addEventListener('__instar_config', (e) => {
    try {
      const config = e.detail;
      if (config.enabled !== undefined) {
        enabled = config.enabled;
        console.debug(`${EXTENSION_TAG} Stealth mode: ${enabled ? 'ON 🟢' : 'OFF 🔴'}`);
      }
      if (config.rules && Array.isArray(config.rules)) {
        blockRules = config.rules.map((r) => ({
          type: r.type,
          pattern: new RegExp(r.pattern, r.flags || 'i'),
        }));
        console.debug(`${EXTENSION_TAG} Loaded ${blockRules.length} block rules`);
      }
    } catch (err) {
      console.warn(`${EXTENSION_TAG} Config parse error:`, err);
    }
  });

  // ─── 5. Expose query API for popup / devtools ─────────────────────
  window.addEventListener('__instar_query', () => {
    window.dispatchEvent(new CustomEvent('__instar_status', {
      detail: {
        enabled,
        blockedCount,
        recentLog: blockedLog.slice(-10),
        rulesCount: blockRules.length,
      },
    }));
  });

  // ─── Boot message ─────────────────────────────────────────────────
  console.debug(
    `${EXTENSION_TAG} 🚀 Interceptor loaded — ${blockRules.length} rules active`
  );
})();
