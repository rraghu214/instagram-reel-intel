// background.js — Reel Intel Service Worker
// Handles all external API calls: Gemini (default), Claude (fallback), Whisper, Google Maps.

const CLAUDE_MODEL  = 'claude-sonnet-4-6';
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
const WHISPER_MODEL = 'whisper-1';

// ── Message router ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    GET_KEYS:           () => getKeyStatus(),
    ANALYZE_LOCATION:   () => analyzeLocation(msg),
    ASK_ANYTHING:       () => askAnything(msg),
    TRANSCRIBE_AUDIO:   () => transcribeAudio(msg),
    GET_SIMILAR_PLACES: () => getSimilarPlaces(msg),
    RESOLVE_PLACE:      () => resolvePlace(msg),
  };

  const fn = handlers[msg.action];
  if (!fn) return false;

  fn()
    .then(sendResponse)
    .catch(err => sendResponse({ error: err.message || String(err) }));

  return true; // async response
});

// ── Key helpers ─────────────────────────────────────────────────────────────
function loadKeys() {
  return new Promise(resolve =>
    chrome.storage.sync.get(['geminiKey', 'claudeKey', 'openaiKey', 'mapsKey', 'confidenceThreshold'], resolve)
  );
}

async function getKeyStatus() {
  const k = await loadKeys();
  return {
    hasGeminiKey: !!k.geminiKey?.trim(),
    hasClaudeKey: !!k.claudeKey?.trim(),
    hasOpenaiKey: !!k.openaiKey?.trim(),
    hasMapsKey:   !!k.mapsKey?.trim(),
    hasAiKey:     !!(k.geminiKey?.trim() || k.claudeKey?.trim()),
    activeModel:  k.geminiKey?.trim() ? 'gemini' : (k.claudeKey?.trim() ? 'claude' : null),
    confidenceThreshold: k.confidenceThreshold ?? 80,
  };
}

// ── Location analysis ────────────────────────────────────────────────────────
async function analyzeLocation({ frames, metadata, isDeepAnalysis }) {
  const keys = await loadKeys();
  if (!keys.geminiKey?.trim() && !keys.claudeKey?.trim()) {
    throw new Error('No AI API key configured. Open Settings to add a Gemini or Claude key.');
  }

  const maxFrames = isDeepAnalysis ? 20 : 8;
  const trimmed   = (frames || []).slice(0, maxFrames);

  const system  = locationSystemPrompt();
  const content = buildLocationContent(trimmed, metadata, isDeepAnalysis);

  const raw = await callAI(keys, system, content, 1024);
  return parseJsonResponse(raw);
}

// ── Ask anything ─────────────────────────────────────────────────────────────
async function askAnything({ question, frames, metadata, transcript }) {
  const keys = await loadKeys();
  if (!keys.geminiKey?.trim() && !keys.claudeKey?.trim()) {
    throw new Error('No AI API key configured. Open Settings to add a Gemini or Claude key.');
  }

  const system  = askAnythingSystemPrompt();
  const content = buildAskContent(question, frames, metadata, transcript);

  const raw = await callAI(keys, system, content, 1500);
  return { answer: raw };
}

// ── Audio transcription ───────────────────────────────────────────────────────
async function transcribeAudio({ videoSrc, blobData }) {
  const keys = await loadKeys();
  if (!keys.openaiKey?.trim()) {
    return { transcript: null, skipped: true, reason: 'No OpenAI key' };
  }

  let blob;

  if (blobData) {
    // Pre-fetched blob forwarded from content script
    blob = dataUrlToBlob(blobData);
  } else if (videoSrc) {
    // Try fetching directly from service worker
    try {
      const resp = await fetch(videoSrc);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      blob = await resp.blob();
    } catch (e) {
      return { transcript: null, skipped: true, reason: `Video fetch failed: ${e.message}` };
    }
  } else {
    return { transcript: null, skipped: true, reason: 'No video source available' };
  }

  // Whisper limit is 25 MB
  if (blob.size > 24 * 1024 * 1024) {
    return { transcript: null, skipped: true, reason: 'Video file too large for transcription (>24 MB)' };
  }

  const form = new FormData();
  form.append('file', blob, 'audio.mp4');
  form.append('model', WHISPER_MODEL);

  const resp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${keys.openaiKey}` },
    body: form,
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => '');
    throw new Error(`Whisper API error ${resp.status}: ${msg.slice(0, 200)}`);
  }

  const data = await resp.json();
  return { transcript: data.text || '' };
}

// ── Similar places ────────────────────────────────────────────────────────────
async function getSimilarPlaces({ placeName, placeType }) {
  const keys = await loadKeys();

  if (!keys.mapsKey?.trim()) {
    const q = encodeURIComponent(`${placeType || 'places'} similar to ${placeName}`);
    return {
      places: [],
      fallbackUrl: `https://www.google.com/maps/search/?api=1&query=${q}`,
    };
  }

  const query = encodeURIComponent(`${placeType || ''} ${placeName}`.trim());
  const url   = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${keys.mapsKey}`;

  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Maps API error: ${resp.status}`);

  const data   = await resp.json();
  const places = (data.results || []).slice(0, 5).map(p => ({
    name:     p.name,
    address:  p.formatted_address,
    rating:   p.rating,
    placeId:  p.place_id,
    mapsUrl:  `https://www.google.com/maps/place/?q=place_id:${p.place_id}`,
  }));

  return { places };
}

async function resolvePlace({ placeName, placeDetail, placeId }) {
  const keys = await loadKeys();

  // If we already have a Maps place ID, return the deep-link directly
  if (placeId) {
    return { url: `https://maps.google.com/maps?q=place_id:${placeId}` };
  }

  // Use Places API text search to get a place ID if Maps key exists
  if (keys.mapsKey?.trim() && placeName) {
    const q    = encodeURIComponent(`${placeName}${placeDetail ? ' ' + placeDetail : ''}`);
    const url  = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${q}&key=${keys.mapsKey}`;
    try {
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const top  = data.results?.[0];
        if (top?.place_id) {
          return { url: `https://www.google.com/maps/place/?q=place_id:${top.place_id}`, resolved: true };
        }
      }
    } catch (_) {}
  }

  // Fallback: search by name
  const q = encodeURIComponent(`${placeName}${placeDetail ? ', ' + placeDetail : ''}`);
  return { url: `https://www.google.com/maps/search/?api=1&query=${q}`, resolved: false };
}

// ── AI router — Gemini first, Claude fallback ─────────────────────────────────
async function callAI(keys, system, content, maxTokens) {
  if (keys.geminiKey?.trim()) {
    try {
      return await callGemini(keys.geminiKey, system, content, maxTokens);
    } catch (e) {
      if (keys.claudeKey?.trim()) {
        console.warn('[ReelIntel] Gemini failed, falling back to Claude:', e.message);
        return await callClaude(keys.claudeKey, system, content, maxTokens);
      }
      throw e;
    }
  }
  return await callClaude(keys.claudeKey, system, content, maxTokens);
}

// ── Gemini API ────────────────────────────────────────────────────────────────
async function callGemini(apiKey, system, userContent, maxTokens = 1024) {
  // Convert shared content format → Gemini parts
  const parts = [];
  for (const item of userContent) {
    if (item.type === 'text') {
      parts.push({ text: item.text });
    } else if (item.type === 'image') {
      parts.push({
        inline_data: {
          mime_type: item.source.media_type,
          data:      item.source.data,
        },
      });
    }
  }

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: { maxOutputTokens: maxTokens },
  };

  // Try models in preference order: 2.5 Flash → 2.0 Flash
  let lastError;
  for (const model of GEMINI_MODELS) {
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    let resp;
    try {
      resp = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      });
    } catch (e) {
      lastError = e;
      continue;
    }

    // 404 = model not available for this key/region — try next model
    // 503 = model overloaded                          — try next model
    // 429 = quota exceeded on this model              — try next model
    if (resp.status === 404 || resp.status === 503 || resp.status === 429) {
      const err = await resp.text().catch(() => '');
      lastError = new Error(`Gemini ${resp.status} on ${model}: ${err.slice(0, 150)}`);
      console.warn('[ReelIntel]', lastError.message, '— trying next model');
      continue;
    }

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      throw new Error(`Gemini API error ${resp.status}: ${err.slice(0, 300)}`);
    }

    const data      = await resp.json();
    const candidate = data.candidates?.[0];
    if (!candidate) {
      const reason = data.promptFeedback?.blockReason || 'No candidates returned';
      throw new Error(`Gemini blocked the request: ${reason}`);
    }

    return candidate.content?.parts?.[0]?.text ?? '';
  }

  throw lastError || new Error('No Gemini model available');
}

// ── Claude API ────────────────────────────────────────────────────────────────
async function callClaude(apiKey, system, userContent, maxTokens = 1024) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':                              'application/json',
      'x-api-key':                                 apiKey,
      'anthropic-version':                         '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!resp.ok) {
    const err = await resp.text().catch(() => '');
    throw new Error(`Claude API error ${resp.status}: ${err.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text ?? '';
}

// ── Prompts ───────────────────────────────────────────────────────────────────
function locationSystemPrompt() {
  return `You are Reel Intel, a video intelligence assistant that identifies locations shown in Instagram Reels, posts, and stories.

Analyze ALL provided signals — location tags, captions, comments, audio transcript, and visual frames — to determine where the video was filmed. Be specific: name the exact place if you can, not just the city or country.

Also detect if the creator is deliberately withholding the location. Look for phrases like:
"DM for location", "comment below for spot", "drop a 🙏 for the place", "comment and I'll DM you", "secret spot", "can't reveal", "DM me", "follow for location"

Confidence guide:
90–100  Explicit location tag OR place name clearly visible in frame text
70–89   Strong visual landmark match + supporting text signal
50–69   Plausible visual match, limited or ambiguous text signals
20–49   Weak signals, educated guess only
0–19    Genuinely unidentifiable

Respond ONLY with a raw JSON object — no markdown fences, no extra commentary:
{
  "placeName": "Specific place name, or null if unknown",
  "placeDetail": "City · Region · Country",
  "placeType": "Category (e.g. Waterfall, Beach Café, Mountain Trail, Temple, Restaurant)",
  "confidence": 0–100,
  "withholdingLocation": true or false,
  "withholdingPattern": "Exact phrase detected, or null",
  "signals": {
    "locationTag": "Tag text or null",
    "caption": "Relevant caption excerpt or null",
    "visual": "What frames showed — landmarks, signage, architecture, vegetation — or null",
    "audio": "Place name heard in transcript, or null",
    "comments": "Most relevant comment or null"
  },
  "reasoning": "1–2 sentence explanation of how you reached this conclusion"
}`;
}

function askAnythingSystemPrompt() {
  return `You are Reel Intel, a video intelligence assistant. Answer the user's question based only on what you can observe in the provided video frames, captions, and audio transcript.

Be specific and cite what you actually see or hear. Don't speculate beyond the evidence.

When identifying shoppable products (clothing, accessories, food, gear, etc.):
• Identify by brand, type, color, and style
• Suggest 2–3 purchase options with realistic prices in INR (₹) and USD ($)
• Append a products block to your answer in exactly this format:
<products>[{"name":"Product Name","brand":"Brand or null","price":"~₹X,XXX / ~$XX","searchQuery":"google search terms to find it"}]</products>

When identifying music:
• Use the audio transcript if available
• If uncertain, say so and suggest Shazam

Keep answers concise and actionable. Where relevant, mention what timestamp or visual cue you're basing the answer on.`;
}

function buildLocationContent(frames, metadata, isDeepAnalysis) {
  const parts = [];

  const signals = [];
  if (metadata?.locationTag)         signals.push(`Instagram location tag: "${metadata.locationTag}"`);
  if (metadata?.caption)             signals.push(`Caption: "${metadata.caption}"`);
  if (metadata?.transcript)          signals.push(`Audio transcript: "${metadata.transcript}"`);
  if (metadata?.comments?.length) {
    signals.push(`Visible comments (${metadata.comments.length}):\n${metadata.comments.slice(0, 15).join('\n')}`);
  }

  const signalBlock = signals.length
    ? `Text signals found:\n\n${signals.join('\n\n')}`
    : 'No text signals found.';

  parts.push({
    type: 'text',
    text: [
      `Identify the filming location of this Instagram ${metadata?.urlType || 'video'}.`,
      '',
      signalBlock,
      '',
      isDeepAnalysis
        ? `⚡ DEEP ANALYSIS MODE — dense frame sampling + audio transcription included. ${frames.length} frames provided.`
        : `${frames.length} sampled frames below:`,
    ].join('\n'),
  });

  for (const frame of frames) {
    const b64 = frame.data.replace(/^data:image\/\w+;base64,/, '');
    parts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  }

  return parts;
}

function buildAskContent(question, frames, metadata, transcript) {
  const parts = [];

  const ctx = [];
  if (metadata?.locationTag) ctx.push(`Location tag: ${metadata.locationTag}`);
  if (metadata?.caption)     ctx.push(`Caption: ${metadata.caption}`);
  if (transcript)            ctx.push(`Audio: ${transcript}`);

  parts.push({
    type: 'text',
    text: [
      `User question: "${question}"`,
      '',
      `Context:\n${ctx.join('\n') || 'None'}`,
      '',
      `${(frames || []).length} video frames:`,
    ].join('\n'),
  });

  for (const frame of (frames || []).slice(0, 12)) {
    const b64 = frame.data.replace(/^data:image\/\w+;base64,/, '');
    parts.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64 } });
  }

  return parts;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function parseJsonResponse(text) {
  const stripped = text.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim();
  try {
    const m = stripped.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON object found in response');
    return JSON.parse(m[0]);
  } catch (e) {
    return {
      placeName:   null,
      placeDetail: 'Unable to parse Claude response',
      confidence:  0,
      error:       e.message,
      raw:         text.slice(0, 400),
    };
  }
}

function dataUrlToBlob(dataUrl) {
  const [header, base64] = dataUrl.split(',');
  const mime   = (header.match(/:(.*?);/) || [])[1] || 'video/mp4';
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
