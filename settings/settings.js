// settings.js — Reel Intel settings page

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadSavedSettings();
  bindEvents();
}

// ── Load ─────────────────────────────────────────────────────────────────────
async function loadSavedSettings() {
  const data = await storageGet(['geminiKey', 'claudeKey', 'openaiKey', 'mapsKey', 'confidenceThreshold']);

  el('gemini-key').value    = data.geminiKey    || '';
  el('claude-key').value    = data.claudeKey    || '';
  el('openai-key').value    = data.openaiKey    || '';
  el('maps-key').value      = data.mapsKey      || '';

  const threshold = data.confidenceThreshold ?? 80;
  el('conf-threshold').value = threshold;
  el('conf-range').value     = threshold;

  // Show saved indicator for existing keys (without revealing the value)
  if (data.geminiKey) setStatus('status-gemini', 'ok', '✓ Key saved');
  if (data.claudeKey) setStatus('status-claude', 'ok', '✓ Key saved');
  if (data.openaiKey) setStatus('status-openai', 'ok', '✓ Key saved');
  if (data.mapsKey)   setStatus('status-maps',   'ok', '✓ Key saved');
}

// ── Save ─────────────────────────────────────────────────────────────────────
async function saveSettings() {
  const data = {
    geminiKey:           el('gemini-key').value.trim(),
    claudeKey:           el('claude-key').value.trim(),
    openaiKey:           el('openai-key').value.trim(),
    mapsKey:             el('maps-key').value.trim(),
    confidenceThreshold: parseInt(el('conf-threshold').value, 10) || 80,
  };

  await storageSet(data);

  const fb = el('save-feedback');
  fb.textContent = 'Saved!';
  fb.className   = 'save-feedback ok';
  setTimeout(() => {
    fb.textContent = '';
    fb.className   = 'save-feedback';
  }, 2500);
}

// ── Test buttons ──────────────────────────────────────────────────────────────
async function testGemini() {
  const key = el('gemini-key').value.trim();
  if (!key) { setStatus('status-gemini', 'err', 'Enter a key first'); return; }

  setStatus('status-gemini', 'testing', 'Testing...');
  setDisabled('test-gemini', true);

  const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
  const payload = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
    generationConfig: { maxOutputTokens: 5 },
  });

  try {
    let successModel = null;
    let lastErr      = null;

    for (const model of models) {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload }
      );

      if (resp.ok) { successModel = model; break; }

      const err = await resp.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${resp.status}`;
      // 404 = model unavailable for this key — try next
      if (resp.status === 404) { lastErr = msg; continue; }
      // Any other error (401, 429, 400) — show immediately
      setStatus('status-gemini', 'err', `✗ Error ${resp.status}: ${msg}`);
      return;
    }

    if (successModel) {
      setStatus('status-gemini', 'ok', `✓ Key is valid — ${successModel} reachable`);
    } else {
      setStatus('status-gemini', 'err', `✗ No Gemini model available: ${lastErr}`);
    }
  } catch (e) {
    setStatus('status-gemini', 'err', `✗ Network error: ${e.message}`);
  } finally {
    setDisabled('test-gemini', false);
  }
}

async function testClaude() {
  const key = el('claude-key').value.trim();
  if (!key) { setStatus('status-claude', 'err', 'Enter a key first'); return; }

  setStatus('status-claude', 'testing', 'Testing...');
  setDisabled('test-claude', true);

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':                          'application/json',
        'x-api-key':                             key,
        'anthropic-version':                     '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages:   [{ role: 'user', content: 'Hi' }],
      }),
    });

    if (resp.ok) {
      setStatus('status-claude', 'ok', '✓ Key is valid — Claude is reachable');
    } else {
      const err = await resp.json().catch(() => ({}));
      setStatus('status-claude', 'err',
        `✗ Error ${resp.status}: ${err.error?.message || 'Invalid key or insufficient permissions'}`
      );
    }
  } catch (e) {
    setStatus('status-claude', 'err', `✗ Network error: ${e.message}`);
  } finally {
    setDisabled('test-claude', false);
  }
}

async function testOpenAI() {
  const key = el('openai-key').value.trim();
  if (!key) { setStatus('status-openai', 'err', 'Enter a key first'); return; }

  setStatus('status-openai', 'testing', 'Testing...');
  setDisabled('test-openai', true);

  try {
    const resp = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (resp.ok) {
      setStatus('status-openai', 'ok', '✓ Key is valid — OpenAI reachable');
    } else {
      setStatus('status-openai', 'err', `✗ Error ${resp.status}: Invalid or expired key`);
    }
  } catch (e) {
    setStatus('status-openai', 'err', `✗ Network error: ${e.message}`);
  } finally {
    setDisabled('test-openai', false);
  }
}

async function testMaps() {
  const key = el('maps-key').value.trim();
  if (!key) { setStatus('status-maps', 'err', 'Enter a key first'); return; }

  setStatus('status-maps', 'testing', 'Testing...');
  setDisabled('test-maps', true);

  try {
    // Test using Places API text search — the same API used by the extension
    const resp = await fetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?query=London&key=${key}`
    );
    const data = await resp.json();

    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
      setStatus('status-maps', 'ok', '✓ Key is valid — Places API active');
    } else if (data.status === 'REQUEST_DENIED') {
      setStatus('status-maps', 'err',
        `✗ Request denied — ensure Places API is enabled for this key at console.cloud.google.com`
      );
    } else {
      setStatus('status-maps', 'err',
        `✗ ${data.status}: ${data.error_message || 'Check API key and enabled APIs'}`
      );
    }
  } catch (e) {
    setStatus('status-maps', 'err', `✗ Network error: ${e.message}`);
  } finally {
    setDisabled('test-maps', false);
  }
}

// ── Bind ──────────────────────────────────────────────────────────────────────
function bindEvents() {
  on('btn-save',    'click', saveSettings);
  on('test-gemini', 'click', testGemini);
  on('test-claude', 'click', testClaude);
  on('test-openai', 'click', testOpenAI);
  on('test-maps',   'click', testMaps);

  // Sync range slider ↔ number input
  on('conf-range', 'input', () => {
    el('conf-threshold').value = el('conf-range').value;
  });
  on('conf-threshold', 'input', () => {
    const v = Math.max(50, Math.min(95, parseInt(el('conf-threshold').value) || 80));
    el('conf-range').value = v;
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }
function on(id, ev, fn) { el(id)?.addEventListener(ev, fn); }

function setStatus(id, type, text) {
  const e = document.getElementById(id);
  if (e) { e.textContent = text; e.className = `field-status ${type}`; }
}

function setDisabled(id, disabled) {
  const e = document.getElementById(id);
  if (e) e.disabled = disabled;
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.sync.get(keys, resolve));
}

function storageSet(data) {
  return new Promise(resolve => chrome.storage.sync.set(data, resolve));
}
