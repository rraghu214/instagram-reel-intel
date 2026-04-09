// panel.js — Reel Intel popup orchestrator

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  tab:              null,
  metadata:         null,
  frames:           [],
  analysisResult:   null,
  transcript:       null,
  transcriptRunning: false,
  round:            0,
  analysisRunning:  false,
};

let CONFIDENCE_THRESHOLD = 80;
const MAX_ROUNDS         = 3;
const FRAMES_PER_ROUND   = 8;

// ── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindUI();

  const tab = await getActiveTab();
  state.tab = tab;

  if (!tab?.url?.includes('instagram.com')) {
    showScreen('offsite');
    return;
  }

  const keys = await bg({ action: 'GET_KEYS' });
  CONFIDENCE_THRESHOLD = keys.confidenceThreshold ?? 80;

  if (!keys.hasAiKey) {
    showScreen('nokey');
    return;
  }

  showScreen('main');
  await startAnalysis();
}

// ── Analysis flow ─────────────────────────────────────────────────────────────
async function startAnalysis() {
  if (state.analysisRunning) return;
  state.analysisRunning  = true;
  state.frames           = [];
  state.round            = 0;
  state.analysisResult   = null;
  state.transcript       = null;
  state.transcriptRunning = false;

  showLocLoading('Analyzing video...', 'Reading signals');

  try {
    await cs({ action: 'RESET_SAMPLING' });

    setLoadSub('Extracting page signals...');
    state.metadata = await cs({ action: 'EXTRACT_METADATA' });

    // Show initial signal state immediately from DOM data
    renderSignals(buildInitialSignals(state.metadata));

    await runAnalysisLoop();

    // Non-blocking audio transcription after first result is shown
    maybeStartAudio();

  } catch (e) {
    showLocError(e.message || String(e));
  } finally {
    state.analysisRunning = false;
  }
}

async function runAnalysisLoop() {
  while (state.round < MAX_ROUNDS) {
    state.round++;
    setLoadTitle(`Analyzing... (pass ${state.round}/${MAX_ROUNDS})`);
    setLoadSub('Sampling video frames');

    const frameResult = await cs({ action: 'EXTRACT_FRAMES', count: FRAMES_PER_ROUND });

    if (frameResult.error && state.frames.length === 0) {
      throw new Error(frameResult.error);
    }

    if (frameResult.frames?.length) {
      state.frames.push(...frameResult.frames);
    }

    setLoadSub(`Sending ${state.frames.length} frames to Claude...`);
    const result = await bg({
      action:         'ANALYZE_LOCATION',
      frames:         state.frames,
      metadata:       state.metadata,
      isDeepAnalysis: false,
    });

    state.analysisResult = result;

    const confidence = result.confidence ?? 0;
    if (confidence >= CONFIDENCE_THRESHOLD || state.round >= MAX_ROUNDS) break;

    setLoadTitle(`Low confidence (${confidence}%) — sampling more frames`);
  }

  showLocationResult(state.analysisResult);
}

async function runDeepAnalysis() {
  state.analysisRunning = true;
  showDeepRunning();

  try {
    // Dense frame pass — reset and re-sample
    state.frames = [];
    const denseResult = await cs({ action: 'EXTRACT_DENSE_FRAMES' });
    if (denseResult.frames?.length) {
      state.frames = denseResult.frames;
    }

    // Audio transcription (if not already done)
    if (!state.transcript) {
      const audioResult = await tryAudioTranscription();
      if (audioResult) state.transcript = audioResult;
    }

    const meta = buildMetaWithTranscript();
    const result = await bg({
      action:         'ANALYZE_LOCATION',
      frames:         state.frames,
      metadata:       meta,
      isDeepAnalysis: true,
    });

    state.analysisResult = result;
    showLocationResult(result);

  } catch (e) {
    showLocError('Deep analysis failed: ' + (e.message || String(e)));
  } finally {
    state.analysisRunning = false;
  }
}

// ── Audio transcription (background, non-blocking) ────────────────────────────
function maybeStartAudio() {
  if (state.transcriptRunning || state.transcript) return;
  state.transcriptRunning = true;

  tryAudioTranscription()
    .then(transcript => {
      state.transcriptRunning = false;
      if (!transcript) return;

      state.transcript = transcript;
      updateAudioSignalRow(transcript);

      // If confidence was below threshold, silently re-analyze with audio
      const conf = state.analysisResult?.confidence ?? 0;
      if (conf < CONFIDENCE_THRESHOLD) {
        const meta = buildMetaWithTranscript();
        bg({ action: 'ANALYZE_LOCATION', frames: state.frames, metadata: meta })
          .then(result => {
            if ((result.confidence ?? 0) > (state.analysisResult?.confidence ?? 0)) {
              state.analysisResult = result;
              showLocationResult(result);
            }
          })
          .catch(() => {});
      }
    })
    .catch(() => { state.transcriptRunning = false; });
}

async function tryAudioTranscription() {
  const keys = await bg({ action: 'GET_KEYS' });
  if (!keys.hasOpenaiKey) return null;

  // Try service worker fetch first (simpler path)
  const { src } = await cs({ action: 'GET_VIDEO_SRC' });
  if (src) {
    const result = await bg({ action: 'TRANSCRIBE_AUDIO', videoSrc: src });
    if (result.transcript) return result.transcript;
    if (!result.skipped) return null; // real error
  }

  // Fallback: have the content script fetch the blob (runs in Instagram page context)
  if (src) {
    try {
      const blobResult = await cs({ action: 'FETCH_VIDEO_BLOB', src });
      if (blobResult?.data) {
        const result = await bg({ action: 'TRANSCRIBE_AUDIO', blobData: blobResult.data });
        if (result.transcript) return result.transcript;
      }
    } catch (_) {}
  }

  return null;
}

function buildMetaWithTranscript() {
  return { ...state.metadata, transcript: state.transcript };
}

// ── UI: Location tab ──────────────────────────────────────────────────────────
function showLocLoading(title, sub) {
  show('loc-loading');
  hide('loc-result');
  hide('loc-deep');
  hide('loc-error');
  setLoadTitle(title);
  setLoadSub(sub);
}

function showDeepRunning() {
  hide('loc-loading');
  hide('loc-result');
  show('loc-deep');
  hide('loc-error');
}

function showLocError(message) {
  hide('loc-loading');
  hide('loc-result');
  hide('loc-deep');
  show('loc-error');
  el('error-msg').textContent = message;
}

function showLocationResult(result) {
  hide('loc-loading');
  hide('loc-deep');
  hide('loc-error');
  show('loc-result');

  const confidence   = result.confidence ?? 0;
  const isLow        = confidence < CONFIDENCE_THRESHOLD;
  const withholding  = result.withholdingLocation;

  // ── Banner ──
  const banner = el('warn-banner');
  if (withholding) {
    const phrase = result.withholdingPattern ? ` ("${result.withholdingPattern}")` : '';
    banner.textContent = `⚠ Creator appears to be withholding the location${phrase} — this is a visual best guess only.`;
    banner.classList.remove('hidden');
  } else if (isLow && result.placeName) {
    banner.textContent = '⚠ Low signal quality — this is a best guess based on visual frames.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // ── Signal rows ──
  renderSignals(buildResultSignals(result));

  // ── Result card ──
  if (result.placeName) {
    el('result-card').classList.remove('hidden');
    el('result-name').textContent = (isLow ? 'Possibly: ' : '') + result.placeName;
    el('result-sub').textContent  = [result.placeDetail, result.placeType].filter(Boolean).join(' · ');
    el('conf-pct').textContent    = `${confidence}%`;

    const fill = el('conf-fill');
    fill.style.width      = `${confidence}%`;
    fill.style.background = confidence >= CONFIDENCE_THRESHOLD ? '#1D9E75' : '#EF9F27';
  } else {
    el('result-card').classList.add('hidden');
  }

  // ── Buttons ──
  el('btn-maps').disabled = !result.placeName;

  if (isLow || withholding) {
    el('btn-deep').classList.remove('hidden');
  } else {
    el('btn-deep').classList.add('hidden');
  }
}

// ── Signal rows ───────────────────────────────────────────────────────────────
function buildInitialSignals(metadata) {
  return [
    sig('loc-tag',  'Location tag',   metadata?.locationTag),
    sig('caption',  'Caption',        metadata?.caption ? truncate(metadata.caption, 40) : null),
    sig('audio',    'Audio',          null, 'scanning'),
    sig('comments', 'Comments',       metadata?.comments?.length ? `${metadata.comments.length} visible` : null),
  ];
}

function buildResultSignals(result) {
  const s = result.signals || {};
  return [
    sig('loc-tag',  'Location tag',   s.locationTag || state.metadata?.locationTag),
    sig('caption',  'Caption',        s.caption     || (state.metadata?.caption ? truncate(state.metadata.caption, 40) : null)),
    sig('audio',    'Audio',          s.audio       || state.transcript,
        state.transcriptRunning ? 'scanning' : null),
    sig('comments', 'Comments',       s.comments),
    sig('visual',   'Visual frames',  s.visual),
  ].filter(s => s.value || s.state); // hide empty rows in result view (except audio)
}

function sig(id, label, value, state = null) {
  return { id, label, value: value || null, state };
}

function renderSignals(signals) {
  const container = el('signal-rows');
  container.innerHTML = '';

  // Always include these rows (even if empty) in the loading phase
  const rows = signals.length ? signals : [
    sig('loc-tag', 'Location tag', null),
    sig('caption', 'Caption', null),
    sig('audio', 'Audio', null, 'scanning'),
    sig('comments', 'Comments', null),
  ];

  for (const s of rows) {
    const row = document.createElement('div');
    row.className = 'signal-row';
    row.id = `sigrow-${s.id}`;

    let dotClass  = 'dot-none';
    let valText   = '—';
    let valClass  = 'signal-value sv-none';

    if (s.state === 'scanning') {
      dotClass = 'dot-scanning';
      valText  = 'scanning...';
      valClass = 'signal-value sv-scanning';
    } else if (s.value) {
      dotClass = 'dot-found';
      valText  = s.value;
      valClass = 'signal-value';
    }

    row.innerHTML = `
      <div class="dot ${dotClass}"></div>
      <div class="signal-label">${esc(s.label)}</div>
      <div class="${valClass}">${esc(String(valText))}</div>
    `;
    container.appendChild(row);
  }
}

function updateAudioSignalRow(transcript) {
  const row = el('sigrow-audio');
  if (!row) return;
  const dot = row.querySelector('.dot');
  const val = row.querySelector('[class*="signal-value"]');
  if (transcript) {
    dot.className = 'dot dot-found';
    val.className = 'signal-value';
    val.textContent = truncate(transcript, 45);
  } else {
    dot.className = 'dot dot-none';
    val.className = 'signal-value sv-none';
    val.textContent = '—';
  }
}

// ── UI: Ask anything pane ─────────────────────────────────────────────────────
async function submitQuestion(question) {
  if (!question.trim()) return;

  hide('ask-idle');
  hide('ask-answer-wrap');
  hide('ask-products');
  show('ask-loading');
  el('btn-send').disabled = true;

  try {
    // Ensure we have frames (re-extract if panel was just opened on Ask tab)
    if (!state.frames.length) {
      showLocLoading('Extracting frames...', 'One moment');
      const fr = await cs({ action: 'EXTRACT_FRAMES', count: FRAMES_PER_ROUND });
      state.frames = fr.frames || [];
    }

    if (!state.metadata) {
      state.metadata = await cs({ action: 'EXTRACT_METADATA' });
    }

    const result = await bg({
      action:     'ASK_ANYTHING',
      question,
      frames:     state.frames,
      metadata:   state.metadata,
      transcript: state.transcript,
    });

    renderAnswer(result.answer);

  } catch (e) {
    renderAnswer(`Error: ${e.message || String(e)}`);
  } finally {
    hide('ask-loading');
    el('btn-send').disabled = false;
  }
}

function renderAnswer(rawAnswer) {
  show('ask-answer-wrap');

  // Strip product block from displayed text
  const productMatch = rawAnswer.match(/<products>([\s\S]*?)<\/products>/);
  const displayText  = rawAnswer.replace(/<products>[\s\S]*?<\/products>/g, '').trim();

  el('ask-answer').textContent = displayText;

  if (productMatch) {
    try {
      const products = JSON.parse(productMatch[1].trim());
      renderProducts(products);
    } catch (_) {
      hide('ask-products');
    }
  } else {
    hide('ask-products');
  }
}

function renderProducts(products) {
  const container = el('ask-products');
  container.classList.remove('hidden');
  container.innerHTML = '';

  for (const p of products) {
    const row        = document.createElement('div');
    row.className    = 'product-row';
    const searchUrl  = `https://www.google.com/search?q=${encodeURIComponent(p.searchQuery || p.name)}`;

    row.innerHTML = `
      <div class="product-thumb">🛍</div>
      <div class="product-info">
        <div class="product-name">${esc(p.name || '')}</div>
        <div class="product-meta">${esc([p.brand, p.price].filter(Boolean).join(' · '))}</div>
      </div>
      <a class="product-link" href="${esc(searchUrl)}" target="_blank" rel="noopener">Shop ↗</a>
    `;
    container.appendChild(row);
  }
}

// ── Button / event binding ────────────────────────────────────────────────────
function bindUI() {
  // Setup screen
  on('btn-open-settings', 'click', () => chrome.runtime.openOptionsPage());

  // Main header
  on('btn-settings', 'click', () => chrome.runtime.openOptionsPage());
  on('btn-refresh',  'click', () => { if (!state.analysisRunning) startAnalysis(); });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Location actions
  on('btn-maps',   'click', handleOpenMaps);
  on('btn-similar','click', handleSimilarPlaces);
  on('btn-deep',   'click', () => { if (!state.analysisRunning) runDeepAnalysis(); });
  on('btn-retry',  'click', () => startAnalysis());

  // Ask anything
  on('btn-send', 'click', () => {
    const q = el('ask-input').value.trim();
    if (q) submitQuestion(q);
  });

  on('ask-input', 'keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const q = el('ask-input').value.trim();
      if (q) submitQuestion(q);
    }
  });

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      el('ask-input').value = chip.dataset.q;
      switchTab('ask');
      submitQuestion(chip.dataset.q);
    });
  });
}

async function handleOpenMaps() {
  const result = state.analysisResult;
  if (!result?.placeName) return;

  try {
    const resolved = await bg({
      action:      'RESOLVE_PLACE',
      placeName:   result.placeName,
      placeDetail: result.placeDetail,
    });
    if (resolved.url) chrome.tabs.create({ url: resolved.url });
  } catch (_) {
    const q = encodeURIComponent(`${result.placeName}${result.placeDetail ? ', ' + result.placeDetail : ''}`);
    chrome.tabs.create({ url: `https://www.google.com/maps/search/?api=1&query=${q}` });
  }
}

async function handleSimilarPlaces() {
  const result = state.analysisResult;
  if (!result?.placeName) return;

  try {
    const response = await bg({
      action:    'GET_SIMILAR_PLACES',
      placeName: result.placeName,
      placeType: result.placeType,
    });

    if (response.fallbackUrl) {
      chrome.tabs.create({ url: response.fallbackUrl });
    } else if (response.places?.length) {
      // Open Maps search for similar place type near the identified location
      const q = encodeURIComponent(`${result.placeType || 'places'} near ${result.placeName}`);
      chrome.tabs.create({ url: `https://www.google.com/maps/search/?api=1&query=${q}` });
    }
  } catch (_) {
    const q = encodeURIComponent(`${result.placeType || 'places'} similar to ${result.placeName}`);
    chrome.tabs.create({ url: `https://www.google.com/maps/search/?api=1&query=${q}` });
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  el('pane-location').classList.toggle('hidden', name !== 'location');
  el('pane-ask').classList.toggle('hidden',      name !== 'ask');
}

// ── Screen switching ──────────────────────────────────────────────────────────
function showScreen(name) {
  ['offsite', 'nokey', 'main'].forEach(s => {
    el(`screen-${s}`)?.classList.toggle('hidden', s !== name);
  });
}

// ── DOM helpers ───────────────────────────────────────────────────────────────
function el(id)           { return document.getElementById(id); }
function on(id, ev, fn)   { el(id)?.addEventListener(ev, fn); }
function show(id)         { el(id)?.classList.remove('hidden'); }
function hide(id)         { el(id)?.classList.add('hidden'); }
function setLoadTitle(t)  { const e = el('load-title'); if (e) e.textContent = t; }
function setLoadSub(t)    { const e = el('load-sub');   if (e) e.textContent = t; }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// ── Messaging ─────────────────────────────────────────────────────────────────
function getActiveTab() {
  return new Promise(resolve =>
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => resolve(tabs[0]))
  );
}

function bg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response?.error) {
        reject(new Error(response.error));
      } else {
        resolve(response);
      }
    });
  });
}

function cs(message) {
  if (!state.tab?.id) return Promise.reject(new Error('No active tab'));

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.tab.id, message, response => {
      if (!chrome.runtime.lastError) {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
        return;
      }

      // Content script not injected — try programmatic injection then retry
      chrome.scripting.executeScript(
        { target: { tabId: state.tab.id }, files: ['content_script.js'] },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error('Could not inject into page: ' + chrome.runtime.lastError.message));
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(state.tab.id, message, response2 => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (response2?.error) reject(new Error(response2.error));
              else resolve(response2);
            });
          }, 600);
        }
      );
    });
  });
}
