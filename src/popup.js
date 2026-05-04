/**
 * InstarVision — Popup Logic
 */

const STORAGE_KEY = 'instarVision';
const api = chrome;

// DOM elements
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const statusDesc = document.getElementById('statusDesc');
const statusCard = document.querySelector('.status-card');
const toggleBtn = document.getElementById('toggleBtn');
const sessionCount = document.getElementById('sessionCount');
const totalCount = document.getElementById('totalCount');
const rulesCount = document.getElementById('rulesCount');
const logList = document.getElementById('logList');
const logEmpty = document.getElementById('logEmpty');
const clearBtn = document.getElementById('clearBtn');

// ─── Render state ────────────────────────────────────────────────────
function render(config) {
  const enabled = config.enabled !== false;

  // Status
  statusDot.className = `status-indicator${enabled ? '' : ' off'}`;
  statusText.textContent = enabled ? 'Active' : 'Disabled';
  statusDesc.textContent = enabled
    ? 'Story seen events are being blocked'
    : 'Stealth mode is OFF — you are visible';
  statusCard.className = `card status-card${enabled ? '' : ' disabled'}`;
  toggleBtn.className = `toggle-btn${enabled ? '' : ' off'}`;

  // Stats
  sessionCount.textContent = formatNumber(config.sessionBlocked || 0);
  totalCount.textContent = formatNumber(config.totalBlocked || 0);
  rulesCount.textContent = config.customRules
    ? config.customRules.length
    : '8';

  // Log
  renderLog(config.recentLog || []);
}

function formatNumber(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function renderLog(entries) {
  if (!entries.length) {
    logEmpty.style.display = 'block';
    // Clear existing entries
    const existing = logList.querySelectorAll('.log-entry');
    existing.forEach(el => el.remove());
    return;
  }

  logEmpty.style.display = 'none';

  // Clear and re-render (show last 10, newest first)
  const existing = logList.querySelectorAll('.log-entry');
  existing.forEach(el => el.remove());

  const recent = entries.slice(-10).reverse();
  recent.forEach(entry => {
    const el = document.createElement('div');
    el.className = 'log-entry';

    const method = (entry.method || 'fetch').toLowerCase();
    const timeStr = formatTime(entry.time);

    const methodSpan = document.createElement('span');
    methodSpan.className = `log-method ${method}`;
    methodSpan.textContent = method;

    const matchSpan = document.createElement('span');
    matchSpan.className = 'log-match';
    matchSpan.textContent = entry.match || 'unknown';

    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = timeStr;

    el.appendChild(methodSpan);
    el.appendChild(matchSpan);
    el.appendChild(timeSpan);

    logList.appendChild(el);
  });
}

function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Event handlers ──────────────────────────────────────────────────
toggleBtn.addEventListener('click', () => {
  api.runtime.sendMessage({ type: 'toggle' }, (response) => {
    if (response) {
      loadState();
    }
  });
});

clearBtn.addEventListener('click', () => {
  api.runtime.sendMessage({ type: 'resetCount' }, () => {
    loadState();
  });
});

// ─── Load state from storage ─────────────────────────────────────────
function loadState() {
  api.storage.local.get(STORAGE_KEY, (result) => {
    const config = result[STORAGE_KEY] || {};
    render(config);
  });
}

// ─── Live updates ────────────────────────────────────────────────────
api.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[STORAGE_KEY]) {
    render(changes[STORAGE_KEY].newValue || {});
  }
});

// ─── Init ────────────────────────────────────────────────────────────
loadState();
