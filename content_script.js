// content_script.js — Reel Intel
// Injected into instagram.com pages. Handles frame extraction and DOM scraping.

const FRAME_QUALITY   = 0.72;
const MAX_FRAME_WIDTH = 512;
const SEEK_TIMEOUT_MS = 4000;
const MIN_TS_GAP      = 0.8;   // seconds between sampled timestamps

let sampledTimestamps = [];

// ── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.action) {

    case 'PING':
      sendResponse({ ok: true });
      return false;

    case 'RESET_SAMPLING':
      sampledTimestamps = [];
      sendResponse({ ok: true });
      return false;

    case 'EXTRACT_METADATA':
      extractMetadata()
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message }));
      return true;

    case 'EXTRACT_FRAMES':
      extractFrames(msg.count || 8)
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message, frames: [] }));
      return true;

    case 'EXTRACT_DENSE_FRAMES':
      extractDenseFrames()
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message, frames: [] }));
      return true;

    case 'GET_VIDEO_SRC':
      sendResponse(getVideoSrc());
      return false;

    case 'FETCH_VIDEO_BLOB':
      fetchVideoBlob(msg.src)
        .then(sendResponse)
        .catch(e => sendResponse({ error: e.message }));
      return true;

    default:
      return false;
  }
});

// ── Metadata ────────────────────────────────────────────────────────────────
async function extractMetadata() {
  const meta = {
    url:          window.location.href,
    urlType:      getUrlType(window.location.href),
    locationTag:  null,
    locationId:   null,
    locationHref: null,
    caption:      null,
    comments:     [],
    videoDuration: null,
    videoSrc:     null,
  };

  // ── Location tag (link to /explore/locations/) ──
  const locLink = document.querySelector('a[href*="/explore/locations/"]');
  if (locLink) {
    meta.locationTag  = locLink.textContent?.trim() || null;
    meta.locationHref = locLink.href;
    const m = locLink.href.match(/\/explore\/locations\/(\d+)\//);
    if (m) meta.locationId = m[1];
  }

  // ── Caption ──
  meta.caption = extractCaption();

  // ── Comments ──
  meta.comments = extractComments(meta.caption);

  // ── Video ──
  const video = findBestVideo();
  if (video) {
    meta.videoDuration = isFinite(video.duration) ? video.duration : null;
    const src = video.src || video.currentSrc || null;
    // blob: URLs can't be forwarded to the service worker
    meta.videoSrc = src && !src.startsWith('blob:') ? src : null;
  }

  return meta;
}

function getUrlType(url) {
  if (/\/reel\/|\/reels\//.test(url)) return 'reel';
  if (/\/p\//.test(url))             return 'post';
  if (/\/stories\//.test(url))       return 'story';
  return 'unknown';
}

function extractCaption() {
  // Instagram's DOM changes frequently; try multiple selectors in priority order.
  // Modal posts (/p/) have a different structure from fullscreen Reels.
  const selectors = [
    // Modal post overlay — caption is in the comments section, first li
    'article ul li:first-child span[dir="auto"]',
    // Modal post — direct h1
    'article h1',
    'h1[dir="auto"]',
    // Reel fullscreen caption
    'div[data-testid="post-comment-root"] span[dir="auto"]',
    // Modal: description block
    'div[role="dialog"] h1',
    'div[role="dialog"] span[dir="auto"]',
    // Generic article caption
    'article div[dir="auto"] span[dir="auto"]',
    // Wide fallback — any dir=auto span (last resort)
    'span[dir="auto"]',
  ];

  // Collect all candidates, then pick the longest one that looks like a caption
  // (not just a username or a short label)
  const candidates = [];
  for (const sel of selectors) {
    try {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const text = el.textContent?.trim();
        if (text && text.length > 15) candidates.push(text);
      }
    } catch (_) {}
  }

  if (!candidates.length) return null;

  // Prefer the longest candidate — captions are typically longer than usernames
  candidates.sort((a, b) => b.length - a.length);
  return candidates[0];
}

function extractComments(captionText) {
  const comments = [];
  const seen = new Set();

  const candidates = document.querySelectorAll(
    'ul li span[dir="auto"], div[role="button"] span[dir="auto"]'
  );

  for (const el of candidates) {
    const text = el.textContent?.trim();
    if (!text || text.length < 3)  continue;
    if (text === captionText)      continue;
    if (seen.has(text))            continue;
    seen.add(text);
    comments.push(text);
    if (comments.length >= 30) break;
  }

  return comments;
}

// ── Video finding ───────────────────────────────────────────────────────────
function findBestVideo() {
  const videos = Array.from(document.querySelectorAll('video'));
  if (!videos.length) return null;

  return videos.reduce((best, v) => {
    const rect     = v.getBoundingClientRect();
    const area     = rect.width * rect.height;
    const hasData  = v.readyState >= 1 && isFinite(v.duration);

    if (!best) return v;
    const br      = best.getBoundingClientRect();
    const bestArea = br.width * br.height;
    const bestData = best.readyState >= 1 && isFinite(best.duration);

    if (hasData && (!bestData || area > bestArea)) return v;
    if (!bestData && area > bestArea) return v;
    return best;
  }, null);
}

function getVideoSrc() {
  const v = findBestVideo();
  if (!v) return { src: null };
  const src = v.src || v.currentSrc || null;
  return { src: src && !src.startsWith('blob:') ? src : null };
}

// ── Frame extraction ────────────────────────────────────────────────────────
async function extractFrames(count) {
  const video = findBestVideo();
  if (!video) {
    return { frames: [], error: 'No video element found on this page.' };
  }

  const duration = video.duration;
  if (!isFinite(duration) || duration < 0.5) {
    return { frames: [], error: 'Video not ready — try again in a moment.' };
  }

  const timestamps = pickNewTimestamps(count, duration);
  sampledTimestamps.push(...timestamps);

  const savedTime  = video.currentTime;
  const wasPaused  = video.paused;
  if (!wasPaused) video.pause();

  const frames = await captureAtTimestamps(video, timestamps);

  try {
    video.currentTime = savedTime;
    if (!wasPaused) video.play().catch(() => {});
  } catch (_) {}

  return { frames, duration, sampledCount: sampledTimestamps.length };
}

async function extractDenseFrames() {
  const video = findBestVideo();
  if (!video) return { frames: [], error: 'No video element found.' };

  const duration = video.duration;
  if (!isFinite(duration)) return { frames: [], error: 'Duration unknown.' };

  // One frame every ~1–2 s, capped at 60 frames
  const interval  = Math.max(1, duration / 60);
  const timestamps = [];
  for (let t = 0.5; t < duration; t += interval) {
    timestamps.push(Math.min(t, duration - 0.1));
  }

  const savedTime = video.currentTime;
  const wasPaused = video.paused;
  if (!wasPaused) video.pause();

  const frames = await captureAtTimestamps(video, timestamps);

  try {
    video.currentTime = savedTime;
    if (!wasPaused) video.play().catch(() => {});
  } catch (_) {}

  return { frames, duration };
}

async function captureAtTimestamps(video, timestamps) {
  const frames = [];
  for (const ts of timestamps) {
    try {
      const data = await seekAndCapture(video, ts);
      if (data) frames.push({ timestamp: ts, data });
    } catch (e) {
      console.warn('[ReelIntel] Frame capture failed at', ts, e);
    }
  }
  return frames;
}

function seekAndCapture(video, timestamp) {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      // Timeout: capture whatever frame is currently visible
      try { resolve(captureCurrentFrame(video)); } catch { resolve(null); }
    }, SEEK_TIMEOUT_MS);

    const onSeeked = () => {
      clearTimeout(timer);
      try { resolve(captureCurrentFrame(video)); } catch { resolve(null); }
    };

    video.addEventListener('seeked', onSeeked, { once: true });
    try {
      video.currentTime = timestamp;
    } catch (e) {
      clearTimeout(timer);
      video.removeEventListener('seeked', onSeeked);
      resolve(null);
    }
  });
}

function captureCurrentFrame(video) {
  const vw    = video.videoWidth  || 640;
  const vh    = video.videoHeight || 640;
  const ratio = vw / vh;
  const w     = Math.min(vw, MAX_FRAME_WIDTH);
  const h     = Math.round(w / ratio);

  const canvas = document.createElement('canvas');
  canvas.width  = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', FRAME_QUALITY);
}

function pickNewTimestamps(count, duration) {
  const picked      = [];
  const maxAttempts = count * 20;
  let   attempts    = 0;

  while (picked.length < count && attempts < maxAttempts) {
    const t = 0.1 + Math.random() * (duration - 0.2);
    const tooClose =
      sampledTimestamps.some(s => Math.abs(s - t) < MIN_TS_GAP) ||
      picked.some(s => Math.abs(s - t) < MIN_TS_GAP);
    if (!tooClose) picked.push(t);
    attempts++;
  }

  return picked.sort((a, b) => a - b);
}

// ── Audio blob fetch ────────────────────────────────────────────────────────
// Fetches the video in the context of the Instagram page (respects CORS/cookies).
async function fetchVideoBlob(src) {
  if (!src) return { error: 'No source URL provided' };

  const resp = await fetch(src, { mode: 'cors', credentials: 'include' });
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);

  const blob = await resp.blob();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve({ data: reader.result, type: blob.type, size: blob.size });
    reader.onerror = () => reject(new Error('FileReader error'));
    reader.readAsDataURL(blob);
  });
}
