'use strict';
// sidebar.js — Reel Intel persistent sidebar

// ── Constants ─────────────────────────────────────────────────────────────────
const MAX_ROUNDS        = 3;
const FRAMES_PER_ROUND  = 8;
const HISTORY_KEY       = 'reel_intel_history';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  // Tab tracking
  currentTab:        null,
  currentUrl:        null,
  currentContentId:  null,
  currentHistoryId:  null,

  // Analysis
  analysisRunning:   false,
  stopRequested:     false,
  frames:            [],
  metadata:          null,
  analysisResult:    null,
  transcript:        null,
  transcriptRunning: false,
  round:             0,

  // Settings
  confidenceThreshold: 80,

  // History UI
  history:           [],
  expandedIds:       new Set(),
  searchQuery:       '',
};

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadHistory();
  renderHistoryList();
  bindUI();
  bindTabListeners();

  // Load confidence threshold
  const keys = await bg({ action: 'GET_KEYS' });
  state.confidenceThreshold = keys.confidenceThreshold ?? 80;
  if (keys.activeModel) showModelBadge(keys.activeModel);

  // Seed from current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) await handleTabChange(tab);

  // Refresh relative timestamps every minute
  setInterval(refreshTimestamps, 60_000);
}

// ── Tab listeners (persistent — sidebar stays open) ───────────────────────────
function bindTabListeners() {
  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await handleTabChange(tab);
    } catch (_) {}
  });

  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!state.currentTab || tabId !== state.currentTab.id) return;
    // React on URL change (SPA navigation) or page ready
    if (changeInfo.url || changeInfo.status === 'complete') {
      await handleTabChange(tab);
    }
  });

  // React to settings changes while sidebar is open
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    if (changes.confidenceThreshold) {
      state.confidenceThreshold = changes.confidenceThreshold.newValue ?? 80;
    }
    if (changes.geminiKey || changes.claudeKey) {
      bg({ action: 'GET_KEYS' }).then(keys => {
        if (keys.activeModel) showModelBadge(keys.activeModel);
        // If we're on Instagram but were blocked by missing key, retry
        if (keys.hasAiKey && state.currentContentId && !state.analysisResult) {
          startAnalysis();
        }
      }).catch(() => {});
    }
  });
}

// ── Tab change handler ────────────────────────────────────────────────────────
async function handleTabChange(tab) {
  if (!tab) return;
  state.currentTab = tab;

  const url = tab.url || tab.pendingUrl || '';

  // De-duplicate: same URL, no change needed
  if (url === state.currentUrl && !state.analysisRunning) return;
  state.currentUrl = url;

  if (!url.includes('instagram.com')) {
    showOffsiteNotice('Navigate to an Instagram Reel, post, or story to analyze it.');
    return;
  }

  const contentId = extractContentId(url);

  // On the home/reels feed (no specific content ID) — allow analysis of
  // whatever video is currently visible; preserve result on tab switch-back.
  if (!contentId) {
    showAnalysisSection();
    hide('cached-banner');
    hide('nokey-notice');

    // Returning to feed while analysis is still running — re-show loading UI
    if (state.currentContentId === null && state.analysisRunning) {
      showLocLoading('Analyzing video...', 'Please wait...');
      return;
    }
    // Returning to feed with a completed result — restore it
    if (state.currentContentId === null && state.analysisResult) {
      showLocationResult(state.analysisResult);
      return;
    }

    // Fresh feed visit (or came from a specific reel page)
    state.currentContentId = null;
    state.analysisResult   = null;
    state.frames           = [];
    state.transcript       = null;

    const keys = await bg({ action: 'GET_KEYS' });
    if (!keys.hasAiKey) { showNoKeyNotice(); return; }
    showAnalyzePrompt();
    return;
  }

  // Same content — restore UI instead of silently returning
  if (contentId === state.currentContentId) {
    showAnalysisSection();
    if (state.analysisRunning) {
      showLocLoading('Analyzing video...', 'Please wait...');
      return;
    }
    if (state.analysisResult) {
      showLocationResult(state.analysisResult);
      return;
    }
  }

  state.currentContentId = contentId;

  // Check API key
  const keys = await bg({ action: 'GET_KEYS' });
  if (!keys.hasAiKey) {
    showNoKeyNotice();
    return;
  }

  // Check history cache
  const cached = state.history.find(h => h.contentId === contentId);
  if (cached) {
    state.currentHistoryId = cached.id;
    showCachedResult(cached);
    return;
  }

  // New content — show Analyze prompt, wait for user
  state.currentHistoryId = null;
  state.analysisResult   = null;
  state.frames           = [];
  state.transcript       = null;
  showAnalysisSection();
  hide('cached-banner');
  hide('nokey-notice');
  showAnalyzePrompt();
}

function extractContentId(url) {
  // Reels: /reel/ID/ or /reels/ID/
  const reelMatch = url.match(/\/reels?\/([^/?#]+)/);
  if (reelMatch) return reelMatch[1];
  // Posts: /p/ID/
  const postMatch = url.match(/\/p\/([^/?#]+)/);
  if (postMatch) return postMatch[1];
  // Stories: /stories/username/ID/
  const storyMatch = url.match(/\/stories\/([^/?#]+)\/([^/?#]+)/);
  if (storyMatch) return `${storyMatch[1]}_${storyMatch[2]}`;
  return null;
}

// ── Analysis flow ─────────────────────────────────────────────────────────────
async function startAnalysis() {
  if (state.analysisRunning) return;
  state.analysisRunning   = true;
  state.stopRequested     = false;
  state.frames            = [];
  state.round             = 0;
  state.analysisResult    = null;
  state.transcript        = null;
  state.transcriptRunning = false;

  showLocLoading('Analyzing video...', 'Reading signals');

  try {
    await cs({ action: 'RESET_SAMPLING' });
    setLoadSub('Extracting page signals...');
    state.metadata = await cs({ action: 'EXTRACT_METADATA' });

    renderSignals(buildInitialSignals(state.metadata));
    await runAnalysisLoop();
    maybeStartAudio();

  } catch (e) {
    showLocError(e.message || String(e));
  } finally {
    state.analysisRunning = false;
  }
}

async function runAnalysisLoop() {
  while (state.round < MAX_ROUNDS) {
    if (state.stopRequested) break;

    state.round++;
    setLoadTitle(`Analyzing... (pass ${state.round}/${MAX_ROUNDS})`);
    setLoadSub('Sampling video frames');

    const frameResult = await cs({ action: 'EXTRACT_FRAMES', count: FRAMES_PER_ROUND });
    if (state.stopRequested) break;

    if (frameResult.error && state.frames.length === 0) throw new Error(frameResult.error);
    if (frameResult.frames?.length) state.frames.push(...frameResult.frames);

    setLoadSub(`Sending ${state.frames.length} frames to AI...`);

    const result = await bg({
      action:         'ANALYZE_LOCATION',
      frames:         state.frames,
      metadata:       state.metadata,
      isDeepAnalysis: false,
    });

    state.analysisResult = result;
    if (state.stopRequested) break;

    if ((result.confidence ?? 0) >= state.confidenceThreshold || state.round >= MAX_ROUNDS) break;
    setLoadTitle(`Low confidence (${result.confidence}%) — sampling more frames`);
  }

  if (state.analysisResult) {
    showLocationResult(state.analysisResult);
    saveAnalysisToHistory(state.analysisResult);
  } else {
    showAnalyzePrompt(); // stopped before any result
  }
}

async function runDeepAnalysis() {
  if (state.analysisRunning) return;
  state.analysisRunning = true;
  showDeepRunning();

  try {
    state.frames = [];
    const denseResult = await cs({ action: 'EXTRACT_DENSE_FRAMES' });
    if (denseResult.frames?.length) state.frames = denseResult.frames;

    if (!state.transcript) {
      const audio = await tryAudioTranscription();
      if (audio) state.transcript = audio;
    }

    const result = await bg({
      action:         'ANALYZE_LOCATION',
      frames:         state.frames,
      metadata:       buildMetaWithTranscript(),
      isDeepAnalysis: true,
    });

    state.analysisResult = result;
    showLocationResult(result);
    saveAnalysisToHistory(result);

  } catch (e) {
    showLocError('Deep analysis failed: ' + (e.message || String(e)));
  } finally {
    state.analysisRunning = false;
  }
}

// ── Audio (background, non-blocking) ─────────────────────────────────────────
function maybeStartAudio() {
  if (state.transcriptRunning || state.transcript) return;
  state.transcriptRunning = true;

  tryAudioTranscription()
    .then(transcript => {
      state.transcriptRunning = false;
      if (!transcript) return;
      state.transcript = transcript;
      updateAudioSignalRow(transcript);

      const conf = state.analysisResult?.confidence ?? 0;
      if (conf < state.confidenceThreshold) {
        bg({ action: 'ANALYZE_LOCATION', frames: state.frames, metadata: buildMetaWithTranscript() })
          .then(result => {
            if ((result.confidence ?? 0) > conf) {
              state.analysisResult = result;
              showLocationResult(result);
              saveAnalysisToHistory(result);
            }
          }).catch(() => {});
      }
    })
    .catch(() => { state.transcriptRunning = false; });
}

async function tryAudioTranscription() {
  const keys = await bg({ action: 'GET_KEYS' });
  if (!keys.hasOpenaiKey) return null;

  const { src } = await cs({ action: 'GET_VIDEO_SRC' });
  if (src) {
    const result = await bg({ action: 'TRANSCRIBE_AUDIO', videoSrc: src });
    if (result.transcript) return result.transcript;
    if (!result.skipped) return null;
  }

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

// ── History management ────────────────────────────────────────────────────────
async function loadHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  state.history = data[HISTORY_KEY] || [];
}

async function saveHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: state.history });
}

function saveAnalysisToHistory(result) {
  if (!result || !state.currentUrl) return;

  const id = state.currentContentId || Date.now().toString();

  // Update existing entry if re-analyzing the same content
  const existingIdx = state.history.findIndex(h => h.contentId === state.currentContentId);

  const item = {
    id,
    contentId:          state.currentContentId,
    url:                state.currentUrl,
    placeName:          result.placeName,
    placeDetail:        result.placeDetail,
    placeType:          result.placeType,
    confidence:         result.confidence ?? 0,
    withholdingLocation: result.withholdingLocation,
    result,
    qaHistory:          existingIdx >= 0 ? state.history[existingIdx].qaHistory : [],
    timestamp:          new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    state.history[existingIdx] = item;
  } else {
    state.history.unshift(item);
  }

  state.currentHistoryId = id;
  saveHistory();
  renderHistoryList();
}

function addQAToHistory(question, answer) {
  if (!state.currentHistoryId) return;
  const item = state.history.find(h => h.id === state.currentHistoryId);
  if (!item) return;
  item.qaHistory = item.qaHistory || [];
  item.qaHistory.push({ question, answer, timestamp: new Date().toISOString() });
  saveHistory();
  // Re-render only if this item is expanded
  if (state.expandedIds.has(item.id)) renderHistoryList();
}

function deleteHistoryItem(id) {
  state.history = state.history.filter(h => h.id !== id);
  state.expandedIds.delete(id);
  // If deleting the currently shown item, revert to analyze prompt
  if (state.currentHistoryId === id) {
    state.currentHistoryId = null;
    state.analysisResult   = null;
    hide('cached-banner');
    showAnalyzePrompt();
  }
  saveHistory();
  renderHistoryList();
}

// ── UI: Analysis section visibility ──────────────────────────────────────────
function showAnalysisSection() {
  show('analysis-section');
  hide('offsite-notice');
  hide('nokey-notice');
}

function showOffsiteNotice(text) {
  hide('analysis-section');
  show('offsite-notice');
  el('offsite-text').textContent = text;
  // Reset analysis state for this tab
  state.currentContentId = null;
  state.analysisResult   = null;
  state.frames           = [];
}

function showNoKeyNotice() {
  showAnalysisSection();
  show('nokey-notice');
  hide('cached-banner');
  hide('loc-loading'); hide('loc-result'); hide('loc-deep'); hide('loc-error');
  hide('pane-location'); hide('pane-ask');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  hide('mode-tabs-container');
}

function showCachedResult(item) {
  showAnalysisSection();
  hide('nokey-notice');
  show('cached-banner');

  const time = relativeTime(item.timestamp);
  el('cached-banner-text').textContent = `Showing cached result from ${time}.`;

  // Restore analysis state from cache
  state.analysisResult = item.result;
  state.metadata       = { url: item.url };
  state.frames         = [];

  // Show location tab
  switchTab('location');
  showLocationResult(item.result);
}

function showModelBadge(model) {
  const badge = el('model-badge');
  badge.textContent = model === 'gemini' ? 'Gemini' : 'Claude';
  badge.classList.remove('hidden');
}

// ── UI: Location tab ──────────────────────────────────────────────────────────
function showAnalyzePrompt() {
  show('loc-idle'); hide('loc-loading'); hide('loc-result'); hide('loc-deep'); hide('loc-error');
  show('pane-location'); hide('pane-ask');
  document.querySelector('[data-tab="location"]')?.classList.add('active');
  document.querySelector('[data-tab="ask"]')?.classList.remove('active');
}

function showLocLoading(title, sub) {
  hide('loc-idle'); show('loc-loading'); hide('loc-result'); hide('loc-deep'); hide('loc-error');
  setLoadTitle(title); setLoadSub(sub);
  show('pane-location'); hide('pane-ask');
  document.querySelector('[data-tab="location"]')?.classList.add('active');
  document.querySelector('[data-tab="ask"]')?.classList.remove('active');
}

function showDeepRunning() {
  hide('loc-idle'); hide('loc-loading'); hide('loc-result'); show('loc-deep'); hide('loc-error');
}

function showLocError(message) {
  hide('loc-idle'); hide('loc-loading'); hide('loc-result'); hide('loc-deep'); show('loc-error');
  el('error-msg').textContent = message;
}

function showLocationResult(result) {
  hide('loc-loading'); hide('loc-deep'); hide('loc-error'); show('loc-result');
  showAnalysisSection();

  const confidence  = result.confidence ?? 0;
  const isLow       = confidence < state.confidenceThreshold;
  const withholding = result.withholdingLocation;

  // Warning banner
  const banner = el('warn-banner');
  if (withholding) {
    const phrase = result.withholdingPattern ? ` ("${result.withholdingPattern}")` : '';
    banner.textContent = `⚠ Creator is withholding the location${phrase} — visual best guess only.`;
    banner.classList.remove('hidden');
  } else if (isLow && result.placeName) {
    banner.textContent = '⚠ Low signal quality — best guess from visual frames.';
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }

  // Signal rows
  renderSignals(buildResultSignals(result));

  // Result card
  if (result.placeName) {
    show('result-card');
    el('result-name').textContent = (isLow ? 'Possibly: ' : '') + result.placeName;
    el('result-sub').textContent  = [result.placeDetail, result.placeType].filter(Boolean).join(' · ');
    el('conf-pct').textContent    = `${confidence}%`;

    const fill = el('conf-fill');
    fill.style.width      = `${confidence}%`;
    fill.style.background = confidence >= state.confidenceThreshold ? '#1D9E75' : '#EF9F27';

    const reasoningEl = el('result-reasoning');
    if (result.reasoning) {
      reasoningEl.textContent = result.reasoning;
      reasoningEl.classList.remove('hidden');
    } else {
      reasoningEl.classList.add('hidden');
    }
  } else {
    hide('result-card');
  }

  // Buttons
  el('btn-maps').disabled = !result.placeName;
  if (isLow || withholding) show('btn-deep'); else hide('btn-deep');
}

// ── Signal rows ────────────────────────────────────────────────────────────────
function buildInitialSignals(metadata) {
  return [
    sig('loc-tag',  'Location tag',   metadata?.locationTag),
    sig('caption',  'Caption',        metadata?.caption ? truncate(metadata.caption, 45) : null),
    sig('audio',    'Audio',          null, 'scanning'),
    sig('comments', 'Comments',       metadata?.comments?.length ? `${metadata.comments.length} visible` : null),
  ];
}

function buildResultSignals(result) {
  const s = result.signals || {};
  return [
    sig('loc-tag',  'Location tag',   s.locationTag || state.metadata?.locationTag),
    sig('caption',  'Caption',        s.caption || (state.metadata?.caption ? truncate(state.metadata.caption, 45) : null)),
    sig('audio',    'Audio',          s.audio || state.transcript, state.transcriptRunning ? 'scanning' : null),
    sig('comments', 'Comments',       s.comments),
    sig('visual',   'Visual frames',  s.visual),
  ].filter(s => s.value || s.state);
}

function sig(id, label, value, dotState = null) {
  return { id, label, value: value || null, state: dotState };
}

function renderSignals(signals) {
  const container = el('signal-rows');
  container.innerHTML = '';
  const rows = signals.length ? signals : [
    sig('loc-tag', 'Location tag', null),
    sig('caption', 'Caption', null),
    sig('audio', 'Audio', null, 'scanning'),
    sig('comments', 'Comments', null),
  ];
  for (const s of rows) {
    let dotClass = 'dot-none', valText = '—', valClass = 'signal-value sv-none';
    if (s.state === 'scanning') { dotClass = 'dot-scanning'; valText = 'scanning...'; valClass = 'signal-value sv-scanning'; }
    else if (s.value)           { dotClass = 'dot-found';    valText = s.value;       valClass = 'signal-value'; }
    const row = document.createElement('div');
    row.className = 'signal-row';
    row.id = `sigrow-${s.id}`;
    row.innerHTML = `<div class="dot ${dotClass}"></div><div class="signal-label">${esc(s.label)}</div><div class="${valClass}">${esc(String(valText))}</div>`;
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
    val.textContent = truncate(transcript, 50);
  } else {
    dot.className = 'dot dot-none';
    val.className = 'signal-value sv-none';
    val.textContent = '—';
  }
}

// ── UI: Ask anything ──────────────────────────────────────────────────────────
async function submitQuestion(question) {
  if (!question.trim()) return;

  hide('ask-idle');
  hide('ask-answer-wrap');
  hide('ask-products');
  show('ask-loading');
  el('btn-send').disabled = true;

  try {
    if (!state.frames.length) {
      const fr = await cs({ action: 'EXTRACT_FRAMES', count: FRAMES_PER_ROUND });
      state.frames = fr.frames || [];
    }
    if (!state.metadata) state.metadata = await cs({ action: 'EXTRACT_METADATA' });

    const result = await bg({
      action:     'ASK_ANYTHING',
      question,
      frames:     state.frames,
      metadata:   state.metadata,
      transcript: state.transcript,
    });

    renderAnswer(result.answer);
    addQAToHistory(question, result.answer.replace(/<products>[\s\S]*?<\/products>/g, '').trim());

  } catch (e) {
    renderAnswer(`Error: ${e.message || String(e)}`);
  } finally {
    hide('ask-loading');
    el('btn-send').disabled = false;
  }
}

function renderAnswer(rawAnswer) {
  show('ask-answer-wrap');
  const productMatch = rawAnswer.match(/<products>([\s\S]*?)<\/products>/);
  const displayText  = rawAnswer.replace(/<products>[\s\S]*?<\/products>/g, '').trim();
  el('ask-answer').textContent = displayText;

  if (productMatch) {
    try {
      renderProducts(JSON.parse(productMatch[1].trim()));
    } catch (_) { hide('ask-products'); }
  } else {
    hide('ask-products');
  }
}

function renderProducts(products) {
  const container = el('ask-products');
  container.classList.remove('hidden');
  container.innerHTML = '';
  for (const p of products) {
    const row       = document.createElement('div');
    row.className   = 'product-row';
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(p.searchQuery || p.name)}`;
    row.innerHTML   = `
      <div class="product-thumb">🛍</div>
      <div class="product-info">
        <div class="product-name">${esc(p.name || '')}</div>
        <div class="product-meta">${esc([p.brand, p.price].filter(Boolean).join(' · '))}</div>
      </div>
      <a class="product-link" href="${esc(searchUrl)}" target="_blank" rel="noopener">Shop ↗</a>`;
    container.appendChild(row);
  }
}

// ── History rendering ─────────────────────────────────────────────────────────
function getFilteredHistory() {
  if (!state.searchQuery.trim()) return state.history;
  const q = state.searchQuery.toLowerCase();
  return state.history.filter(item =>
    item.placeName?.toLowerCase().includes(q) ||
    item.placeDetail?.toLowerCase().includes(q) ||
    item.placeType?.toLowerCase().includes(q) ||
    item.url?.toLowerCase().includes(q)
  );
}

function renderHistoryList() {
  const filtered = getFilteredHistory();
  const container = el('history-list');

  // Update count
  el('history-count').textContent = state.history.length
    ? `${state.history.length} item${state.history.length !== 1 ? 's' : ''}`
    : '';

  if (!filtered.length) {
    container.innerHTML = `<div class="history-empty">${
      state.history.length === 0
        ? 'No history yet.<br>Analyze a Reel to get started.'
        : `No results for "<strong>${esc(state.searchQuery)}</strong>"`
    }</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => renderHistoryItemHTML(item)).join('');
}

function renderHistoryItemHTML(item) {
  const expanded = state.expandedIds.has(item.id);
  const icon     = placeTypeIcon(item.placeType);
  const conf     = item.confidence || 0;
  const confClass = conf >= 80 ? 'conf-high' : conf >= 50 ? 'conf-mid' : 'conf-low';
  const name     = item.placeName || 'Unknown location';
  const sub      = item.placeDetail || shortenUrl(item.url);

  return `
    <div class="history-item${expanded ? ' expanded' : ''}" data-id="${esc(item.id)}">
      <div class="hi-header">
        <div class="hi-icon">${icon}</div>
        <div class="hi-info">
          <div class="hi-name">${esc(name)}</div>
          <div class="hi-sub">${esc(sub || '')}</div>
        </div>
        <div class="hi-meta">
          <span class="hi-conf ${confClass}">${conf}%</span>
          <span class="hi-time" data-ts="${esc(item.timestamp)}">${relativeTime(item.timestamp)}</span>
        </div>
        <div class="hi-chevron">${expanded ? '▲' : '▼'}</div>
        <button class="hi-delete" data-id="${esc(item.id)}" title="Remove">✕</button>
      </div>
      ${expanded ? renderHistoryBodyHTML(item) : ''}
    </div>`;
}

function renderHistoryBodyHTML(item) {
  const conf      = item.confidence || 0;
  const fillColor = conf >= 80 ? '#1D9E75' : '#EF9F27';
  const result    = item.result || {};

  let signalSummary = '';
  const s = result.signals || {};
  const found = [s.locationTag, s.caption, s.audio, s.comments, s.visual].filter(Boolean);
  if (found.length) {
    signalSummary = `<div class="hi-reasoning">${esc(found.slice(0, 2).join(' · '))}</div>`;
  }

  let qaHtml = '';
  if (item.qaHistory?.length) {
    qaHtml = `
      <div class="hi-section-title">Q &amp; A</div>
      ${item.qaHistory.map(qa => `
        <div class="hi-qa-item">
          <div class="hi-qa-q">${esc(qa.question)}</div>
          <div class="hi-qa-a">${esc(truncate(qa.answer, 160))}</div>
        </div>`).join('')}`;
  }

  return `
    <div class="hi-body">
      <div class="hi-conf-bar-wrap">
        <div class="hi-conf-labels"><span>Confidence</span><span>${conf}%</span></div>
        <div class="hi-conf-bar"><div class="hi-conf-fill" style="width:${conf}%;background:${fillColor}"></div></div>
      </div>
      ${result.reasoning ? `<div class="hi-reasoning">${esc(result.reasoning)}</div>` : signalSummary}
      ${qaHtml}
      <div class="hi-actions">
        <button class="hi-maps-btn" data-id="${esc(item.id)}">Open in Maps</button>
      </div>
    </div>`;
}

function refreshTimestamps() {
  document.querySelectorAll('.hi-time[data-ts]').forEach(el => {
    el.textContent = relativeTime(el.dataset.ts);
  });
}

// ── Event binding ─────────────────────────────────────────────────────────────
function bindUI() {
  // Header
  on('btn-settings',        'click', () => chrome.runtime.openOptionsPage());
  on('btn-settings-notice', 'click', () => chrome.runtime.openOptionsPage());
  on('btn-refresh',         'click', () => { if (!state.analysisRunning) forceReanalyze(); });
  on('btn-reanalyze',       'click', () => { if (!state.analysisRunning) forceReanalyze(); });

  // Analyze / Stop
  on('btn-analyze', 'click', () => startAnalysis());
  on('btn-stop',    'click', () => {
    if (!state.analysisRunning) return;
    state.stopRequested = true;
    setLoadTitle('Stopping...');
    setLoadSub('Finishing current request');
    el('btn-stop').disabled = true;
  });

  // Tabs
  document.querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => switchTab(tab.dataset.tab))
  );

  // Location actions
  on('btn-maps',    'click', handleOpenMaps);
  on('btn-similar', 'click', handleSimilarPlaces);
  on('btn-deep',    'click', () => { if (!state.analysisRunning) runDeepAnalysis(); });
  on('btn-retry',   'click', () => startAnalysis());

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
  document.querySelectorAll('.chip').forEach(chip =>
    chip.addEventListener('click', () => {
      el('ask-input').value = chip.dataset.q;
      switchTab('ask');
      submitQuestion(chip.dataset.q);
    })
  );

  // History: expand/collapse + maps + delete (event delegation)
  el('history-list').addEventListener('click', e => {
    // Delete button
    const deleteBtn = e.target.closest('.hi-delete');
    if (deleteBtn) {
      e.stopPropagation();
      deleteHistoryItem(deleteBtn.dataset.id);
      return;
    }
    // "Open in Maps" button inside expanded item
    const mapsBtn = e.target.closest('.hi-maps-btn');
    if (mapsBtn) {
      e.stopPropagation();
      openMapsForHistoryItem(mapsBtn.dataset.id);
      return;
    }
    // Click on header → expand/collapse
    const header = e.target.closest('.hi-header');
    if (header) {
      const item = header.closest('.history-item');
      if (item) toggleHistoryExpand(item.dataset.id);
    }
  });

  // Search
  on('history-search', 'input', e => {
    state.searchQuery = e.target.value;
    el('btn-search-clear').classList.toggle('hidden', !state.searchQuery);
    renderHistoryList();
  });
  on('btn-search-clear', 'click', () => {
    el('history-search').value = '';
    state.searchQuery = '';
    el('btn-search-clear').classList.add('hidden');
    renderHistoryList();
  });
}

function forceReanalyze() {
  state.analysisResult   = null;
  state.frames           = [];
  state.transcript       = null;
  state.currentHistoryId = null;
  hide('cached-banner');
  showAnalyzePrompt();
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.tab === name)
  );
  el('pane-location').classList.toggle('hidden', name !== 'location');
  el('pane-ask').classList.toggle('hidden',      name !== 'ask');
}

function toggleHistoryExpand(id) {
  if (state.expandedIds.has(id)) state.expandedIds.delete(id);
  else state.expandedIds.add(id);
  renderHistoryList();
}

// ── Map actions ────────────────────────────────────────────────────────────────
async function handleOpenMaps() {
  const result = state.analysisResult;
  if (!result?.placeName) return;
  openMapsForResult(result);
}

async function handleSimilarPlaces() {
  const result = state.analysisResult;
  if (!result?.placeName) return;
  try {
    const response = await bg({ action: 'GET_SIMILAR_PLACES', placeName: result.placeName, placeType: result.placeType });
    const q = encodeURIComponent(`${result.placeType || 'places'} near ${result.placeName}`);
    chrome.tabs.create({ url: response.fallbackUrl || `https://www.google.com/maps/search/?api=1&query=${q}`, active: false });
  } catch (_) {
    const q = encodeURIComponent(`${result.placeType || 'places'} similar to ${result.placeName}`);
    chrome.tabs.create({ url: `https://www.google.com/maps/search/?api=1&query=${q}`, active: false });
  }
}

async function openMapsForResult(result) {
  try {
    const resolved = await bg({ action: 'RESOLVE_PLACE', placeName: result.placeName, placeDetail: result.placeDetail });
    if (resolved.url) chrome.tabs.create({ url: resolved.url, active: false });
  } catch (_) {
    const q = encodeURIComponent(`${result.placeName}${result.placeDetail ? ', ' + result.placeDetail : ''}`);
    chrome.tabs.create({ url: `https://www.google.com/maps/search/?api=1&query=${q}`, active: false });
  }
}

async function openMapsForHistoryItem(id) {
  const item = state.history.find(h => h.id === id);
  if (!item?.result) return;
  openMapsForResult(item.result);
}

// ── Messaging ─────────────────────────────────────────────────────────────────
function bg(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, response => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else if (response?.error) reject(new Error(response.error));
      else resolve(response);
    });
  });
}

function cs(message) {
  if (!state.currentTab?.id) return Promise.reject(new Error('No active tab'));

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(state.currentTab.id, message, response => {
      if (!chrome.runtime.lastError) {
        if (response?.error) reject(new Error(response.error));
        else resolve(response);
        return;
      }
      // Content script not injected yet — inject then retry
      chrome.scripting.executeScript(
        { target: { tabId: state.currentTab.id }, files: ['content_script.js'] },
        () => {
          if (chrome.runtime.lastError) {
            reject(new Error('Could not inject: ' + chrome.runtime.lastError.message));
            return;
          }
          setTimeout(() => {
            chrome.tabs.sendMessage(state.currentTab.id, message, r => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else if (r?.error) reject(new Error(r.error));
              else resolve(r);
            });
          }, 600);
        }
      );
    });
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────────
function el(id)          { return document.getElementById(id); }
function on(id, ev, fn)  { el(id)?.addEventListener(ev, fn); }
function show(id)        { el(id)?.classList.remove('hidden'); }
function hide(id)        { el(id)?.classList.add('hidden'); }
function setLoadTitle(t) { const e = el('load-title'); if (e) e.textContent = t; }
function setLoadSub(t)   { const e = el('load-sub');   if (e) e.textContent = t; }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, n) {
  return str && str.length > n ? str.slice(0, n) + '…' : (str || '');
}

function shortenUrl(url) {
  if (!url) return '';
  try {
    const m = url.match(/instagram\.com(\/[^?#]*)/);
    return m ? 'instagram.com' + m[1].replace(/\/$/, '') : url;
  } catch (_) { return url; }
}

function relativeTime(isoString) {
  if (!isoString) return '';
  const diff  = Date.now() - new Date(isoString).getTime();
  const secs  = Math.floor(diff / 1000);
  if (secs < 60)   return 'just now';
  const mins  = Math.floor(secs / 60);
  if (mins < 60)   return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24)  return `${hours}h ago`;
  const days  = Math.floor(hours / 24);
  if (days < 7)    return `${days}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function placeTypeIcon(placeType) {
  if (!placeType) return '📍';
  const t = placeType.toLowerCase();
  if (t.match(/restaurant|café|cafe|food|dining|eatery/))          return '🍽';
  if (t.match(/bar|pub|brewery|cocktail/))                         return '🍻';
  if (t.match(/waterfall|falls/))                                  return '💧';
  if (t.match(/beach|coast|shore|bay/))                            return '🏖';
  if (t.match(/mountain|trail|trek|hill|peak|valley/))             return '⛰';
  if (t.match(/temple|monument|heritage|fort|palace|church|mosque/)) return '🏛';
  if (t.match(/park|garden|forest|nature|wildlife|reserve/))       return '🌿';
  if (t.match(/lake|river|dam/))                                   return '🏞';
  if (t.match(/hotel|resort|stay|hostel/))                         return '🏨';
  if (t.match(/shop|mall|store|market|bazaar/))                    return '🛍';
  if (t.match(/cafe|coffee|bakery|dessert/))                       return '☕';
  if (t.match(/city|urban|town/))                                  return '🏙';
  if (t.match(/airport|station|terminal/))                         return '✈';
  return '📍';
}
