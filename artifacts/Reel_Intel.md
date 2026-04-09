# Reel Intel — Product Idea

A Chrome extension that acts as a **video intelligence layer** on top of Instagram Reels. Click the extension on any Reel and get instant answers about what's in the video — location, products, music, recipes, and more.

---

## Core concept

Two modes in one panel:

1. **Location mode** — automatically identifies the place being shown in the Reel, with a confidence %, signal breakdown, and a "find similar places" button powered by Google Maps.
2. **Ask anything mode** — a freeform prompt interface where the user can ask any question about the video (e.g. "Where can I buy that blue shirt the man in the yellow hat is wearing?").

---

## UI — three panel states

There are three visual states the panel can be in, depending on what signals are found.  
Save each block below as an `.html` file and open in a browser to preview.

---

### Mode A — Location detected (high confidence)

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
  .panel { background: #fff; border: 0.5px solid #e0e0e0; border-radius: 12px; overflow: hidden; width: 300px; }
  .panel-header { padding: 12px 14px 10px; border-bottom: 0.5px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; }
  .logo { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: #7F77DD; }
  .mode-tabs { display: flex; padding: 10px 14px 0; gap: 6px; }
  .tab { flex: 1; padding: 6px 0; font-size: 12px; text-align: center; border-radius: 6px; border: 0.5px solid #e0e0e0; color: #888; background: transparent; }
  .tab.active { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
  .panel-body { padding: 12px 14px; }
  .signal-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 0.5px solid #f0f0f0; }
  .signal-row:last-of-type { border-bottom: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot-found { background: #1D9E75; }
  .dot-scanning { background: #EF9F27; }
  .dot-none { background: #ccc; }
  .signal-label { font-size: 12px; color: #888; flex: 1; }
  .signal-value { font-size: 12px; font-weight: 500; color: #111; max-width: 140px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result-card { margin: 10px 0; background: #f8f8f8; border-radius: 8px; padding: 10px 12px; }
  .result-place { font-size: 15px; font-weight: 500; }
  .result-sub { font-size: 12px; color: #888; margin-top: 2px; }
  .conf-wrap { margin: 8px 0 4px; }
  .conf-labels { display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-bottom: 4px; }
  .conf-bar { height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden; }
  .conf-fill { height: 100%; border-radius: 2px; }
  .action-row { display: flex; gap: 6px; margin-top: 10px; }
  .btn { flex: 1; padding: 7px 0; font-size: 12px; border: 0.5px solid #ddd; border-radius: 8px; background: transparent; cursor: pointer; text-align: center; color: #111; }
  .btn.primary { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
</style>
</head>
<body>
<div class="panel">
  <div class="panel-header">
    <div class="logo"><div class="logo-dot"></div>Reel Intel</div>
    <span style="font-size:11px;color:#888;cursor:pointer">✕</span>
  </div>
  <div class="mode-tabs">
    <div class="tab active">Location</div>
    <div class="tab">Ask anything</div>
  </div>
  <div class="panel-body">
    <div class="signal-row"><div class="dot dot-found"></div><div class="signal-label">Location tag</div><div class="signal-value">Coorg, Karnataka</div></div>
    <div class="signal-row"><div class="dot dot-found"></div><div class="signal-label">Caption</div><div class="signal-value">Abbey Falls trail</div></div>
    <div class="signal-row"><div class="dot dot-scanning"></div><div class="signal-label">Audio</div><div class="signal-value" style="color:#BA7517;font-style:italic;font-weight:400">scanning...</div></div>
    <div class="signal-row"><div class="dot dot-none"></div><div class="signal-label">Comments</div><div class="signal-value" style="color:#ccc;font-weight:400">—</div></div>
    <div class="result-card">
      <div class="result-place">Abbey Falls, Coorg</div>
      <div class="result-sub">Karnataka, India · Nature / Waterfall</div>
      <div class="conf-wrap">
        <div class="conf-labels"><span>Confidence</span><span>91%</span></div>
        <div class="conf-bar"><div class="conf-fill" style="width:91%;background:#1D9E75"></div></div>
      </div>
    </div>
    <div class="action-row">
      <div class="btn">Open in Maps</div>
      <div class="btn primary">Similar places ↗</div>
    </div>
  </div>
</div>
</body>
</html>
```

**"Open in Maps" — Mode A:** The Instagram location tag is present. "Open in Maps" resolves the tag's place ID and deep-links directly to that exact location — e.g. `https://maps.google.com/maps?q=place_id:ChIJ...`. This is the **actual location from the post**, not a search.

---

### Mode B — Best guess (creator withholding / no signal)

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
  .panel { background: #fff; border: 0.5px solid #e0e0e0; border-radius: 12px; overflow: hidden; width: 300px; }
  .panel-header { padding: 12px 14px 10px; border-bottom: 0.5px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; }
  .logo { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: #7F77DD; }
  .mode-tabs { display: flex; padding: 10px 14px 0; gap: 6px; }
  .tab { flex: 1; padding: 6px 0; font-size: 12px; text-align: center; border-radius: 6px; border: 0.5px solid #e0e0e0; color: #888; background: transparent; }
  .tab.active { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
  .panel-body { padding: 12px 14px; }
  .banner { background: #FAEEDA; border: 0.5px solid #EF9F27; border-radius: 8px; padding: 7px 10px; margin-bottom: 10px; font-size: 11px; color: #633806; }
  .signal-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 0.5px solid #f0f0f0; }
  .signal-row:last-of-type { border-bottom: none; }
  .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
  .dot-found { background: #1D9E75; }
  .dot-none { background: #ccc; }
  .signal-label { font-size: 12px; color: #888; flex: 1; }
  .signal-value { font-size: 12px; font-weight: 500; color: #111; max-width: 150px; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .result-card { margin: 10px 0; background: #f8f8f8; border-radius: 8px; padding: 10px 12px; }
  .result-place { font-size: 15px; font-weight: 500; }
  .result-sub { font-size: 12px; color: #888; margin-top: 2px; }
  .conf-wrap { margin: 8px 0 4px; }
  .conf-labels { display: flex; justify-content: space-between; font-size: 11px; color: #888; margin-bottom: 4px; }
  .conf-bar { height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden; }
  .conf-fill { height: 100%; border-radius: 2px; }
  .action-row { display: flex; gap: 6px; margin-top: 10px; }
  .btn { flex: 1; padding: 7px 0; font-size: 12px; border: 0.5px solid #ddd; border-radius: 8px; background: transparent; cursor: pointer; text-align: center; color: #111; }
  .btn.primary { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
  .deep-btn { width: 100%; margin-top: 6px; padding: 8px 0; font-size: 12px; border: 0.5px solid #AFA9EC; border-radius: 8px; background: #fff; cursor: pointer; text-align: center; color: #3C3489; font-weight: 500; box-sizing: border-box; }
</style>
</head>
<body>
<div class="panel">
  <div class="panel-header">
    <div class="logo"><div class="logo-dot"></div>Reel Intel</div>
    <span style="font-size:11px;color:#888;cursor:pointer">✕</span>
  </div>
  <div class="mode-tabs">
    <div class="tab active">Location</div>
    <div class="tab">Ask anything</div>
  </div>
  <div class="panel-body">
    <div class="banner">⚠ Creator appears to be withholding the location — this is a visual best guess only.</div>
    <div class="signal-row"><div class="dot dot-none"></div><div class="signal-label">Location tag</div><div class="signal-value" style="color:#ccc;font-weight:400">None</div></div>
    <div class="signal-row"><div class="dot dot-none"></div><div class="signal-label">Caption</div><div class="signal-value" style="color:#888;font-weight:400">"DM for location 🤫"</div></div>
    <div class="signal-row"><div class="dot dot-found"></div><div class="signal-label">Visual frames</div><div class="signal-value">Limestone cliffs, teal</div></div>
    <div class="result-card">
      <div class="result-place">Possibly: Halong Bay</div>
      <div class="result-sub">Vietnam · Best guess from visuals</div>
      <div class="conf-wrap">
        <div class="conf-labels"><span>Confidence</span><span>42%</span></div>
        <div class="conf-bar"><div class="conf-fill" style="width:42%;background:#EF9F27"></div></div>
      </div>
    </div>
    <div class="action-row">
      <div class="btn">Open in Maps</div>
      <div class="btn primary">Similar places ↗</div>
    </div>
    <div class="deep-btn">🔍 Run deep analysis</div>
  </div>
</div>
</body>
</html>
```

**"Open in Maps" — Mode B:** No tag exists. "Open in Maps" opens a Maps search for the inferred name (e.g. `https://maps.google.com/?q=Halong+Bay+Vietnam`). The amber bar and banner make clear this is a best-effort search, not a confirmed post location.

**"Run deep analysis" button:** Triggers an exhaustive frame-sampling pass — see the frame sampling strategy section below.

---

### Mode C — Ask anything tab

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; padding: 20px; }
  .panel { background: #fff; border: 0.5px solid #e0e0e0; border-radius: 12px; overflow: hidden; width: 300px; }
  .panel-header { padding: 12px 14px 10px; border-bottom: 0.5px solid #e0e0e0; display: flex; align-items: center; justify-content: space-between; }
  .logo { font-size: 13px; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .logo-dot { width: 8px; height: 8px; border-radius: 50%; background: #7F77DD; }
  .mode-tabs { display: flex; padding: 10px 14px 0; gap: 6px; }
  .tab { flex: 1; padding: 6px 0; font-size: 12px; text-align: center; border-radius: 6px; border: 0.5px solid #e0e0e0; color: #888; background: transparent; }
  .tab.active { background: #EEEDFE; border-color: #AFA9EC; color: #3C3489; font-weight: 500; }
  .ask-panel { padding: 12px 14px; }
  .answer-label { font-size: 11px; color: #888; margin-bottom: 4px; }
  .answer-box { background: #f8f8f8; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; font-size: 12px; color: #111; line-height: 1.6; }
  .product-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 0.5px solid #f0f0f0; }
  .product-row:last-child { border-bottom: none; }
  .thumb { width: 32px; height: 32px; border-radius: 6px; background: #e0e0e0; flex-shrink: 0; }
  .product-name { font-size: 12px; font-weight: 500; }
  .product-meta { font-size: 11px; color: #888; }
  .product-link { font-size: 11px; color: #185FA5; white-space: nowrap; }
  .input-wrap { display: flex; gap: 6px; align-items: flex-end; }
  .ask-input { flex: 1; font-size: 12px; padding: 7px 10px; border: 0.5px solid #ddd; border-radius: 8px; background: #f8f8f8; color: #111; resize: none; height: 54px; font-family: inherit; }
  .send-btn { width: 30px; height: 30px; border-radius: 8px; background: #7F77DD; border: none; cursor: pointer; color: white; font-size: 14px; flex-shrink: 0; }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .chip { font-size: 11px; padding: 4px 9px; border: 0.5px solid #e0e0e0; border-radius: 20px; cursor: pointer; color: #888; background: #f8f8f8; white-space: nowrap; }
</style>
</head>
<body>
<div class="panel">
  <div class="panel-header">
    <div class="logo"><div class="logo-dot"></div>Reel Intel</div>
    <span style="font-size:11px;color:#888;cursor:pointer">✕</span>
  </div>
  <div class="mode-tabs">
    <div class="tab">Location</div>
    <div class="tab active">Ask anything</div>
  </div>
  <div class="ask-panel">
    <div class="answer-label">Answer</div>
    <div class="answer-box">
      <div style="margin-bottom:8px">The blue linen shirt looks like a <strong>Uniqlo linen relaxed shirt</strong> — available in multiple blues.</div>
      <div class="product-row">
        <div class="thumb"></div>
        <div style="flex:1"><div class="product-name">Linen relaxed-fit shirt</div><div class="product-meta">Uniqlo · ~₹2,490</div></div>
        <div class="product-link">Shop ↗</div>
      </div>
      <div class="product-row">
        <div class="thumb"></div>
        <div style="flex:1"><div class="product-name">Oversized linen shirt</div><div class="product-meta">H&amp;M · ~₹1,799</div></div>
        <div class="product-link">Shop ↗</div>
      </div>
    </div>
    <div class="input-wrap">
      <textarea class="ask-input" placeholder="Ask anything about this video..."></textarea>
      <button class="send-btn">→</button>
    </div>
    <div class="chips">
      <div class="chip">Where is this?</div>
      <div class="chip">What song is playing?</div>
      <div class="chip">What camera was used?</div>
      <div class="chip">Recipe from this?</div>
    </div>
  </div>
</div>
</body>
</html>
```

---

## Technical approach

### Frame sampling strategy

The extension does **not** extract a fixed set of frames and stop. It uses a confidence-driven iterative loop.

**Standard pass (runs automatically on panel open):**

1. Sample 6–8 frames at random timestamps distributed across the video duration.
2. Send frames + available text signals to Claude → receive place candidate + confidence score.
3. If confidence ≥ threshold (e.g. 80%): stop and show result.
4. If confidence < threshold: pick a **new** set of random timestamps, avoiding already-sampled ones, and repeat from step 2.
5. Cap at ~3 rounds (~24 frames total) to avoid runaway API cost. If still below threshold after the cap: show current best guess with actual confidence score and amber UI.

**Deep analysis pass (user-triggered, Mode B only):**

- User clicks "Run deep analysis."
- Extension samples frames densely — e.g. every 1–2 seconds across the full video duration.
- Triggers audio transcription via Whisper in parallel (if not already done).
- Re-queries Claude with the full expanded frame set + transcript.
- UI shows: *"Running deep analysis..."* with a progress indicator.
- Result updates in place with revised confidence score.

The principle: **fast by default** (random sampling, stop when confident), **thorough on demand** (user opts in for the expensive pass).

### "Open in Maps" — exact behaviour by mode

| Mode | Situation | What "Open in Maps" does |
|---|---|---|
| A | Instagram location tag present | Resolves tag's place ID → deep-links to exact location: `maps.google.com/maps?q=place_id:ChIJ...` — the actual post location |
| A/B | No tag, high-confidence inference | Search link for inferred name: `maps.google.com/?q=Abbey+Falls+Coorg` |
| B | Best guess / low confidence | Search link for best-guess name with amber UI clearly signalling it is inferred |

Only Mode A with a tag is guaranteed to open the creator's actual location.

### How video content is accessed

- The Instagram Reel uses a standard HTML5 `<video>` element.
- A content script uses `ctx.drawImage(videoElement, ...)` on a hidden canvas to extract frames without the user pausing at the right moment.
- **Extract once, share across both tabs:** Frames and transcript are cached in `chrome.storage.session` on panel open. Both the Location tab and Ask Anything tab query the same payload.

### Signal hierarchy for place detection

Signals are checked in priority order. The first confident match wins; lower signals confirm or provide fallback.

| Priority | Signal | How extracted | Difficulty |
|---|---|---|---|
| 1 | On-screen text (place name printed in video) | Canvas frame + Claude OCR | Easy |
| 2 | Caption text | DOM `querySelector` | Easy |
| 3 | Instagram location tag (geo-tag by creator) | DOM `querySelector` | Easy |
| 4 | Comment section (viewers name the place) | Scrape visible DOM comments | Partial — lazy-loaded, ~20–30 comments |
| 5 | Audio / narration (creator says the place name) | Extract video URL → Whisper transcription | Medium — adds ~3–5s |
| 6 | Visual frames (landmarks, scenery, architecture) | Iterative canvas seek + Claude vision | Medium |
| 7 | No signal / "DM me" pattern detected | Switch to best-guess mode | Best guess only |

**Fast lane (signals 1–3):** Checked instantly on panel open via DOM. Result shown immediately if found.

**Slow lane (signals 4–6):** Run in the background if fast lane fails. Updates the result when complete.

### Detecting the "DM me" pattern (Signal 7)

Claude reads the caption and top comments for patterns like:
- "comment below 👇"
- "DM for location"
- "drop a 🙏 for the spot"
- "comment and I'll DM you"

When detected: amber banner shown, confidence bar turns amber, "Run deep analysis" button appears.

---

## Example queries the extension can answer

| User asks | Signals used | How answered |
|---|---|---|
| "Where is this?" | Tags → caption → audio → visuals | Location mode default |
| "Find me that blue shirt" | Visual frames | Claude identifies item → web search for where to buy |
| "What song is playing?" | Audio transcript | Whisper → song title match |
| "What camera/lens was used?" | Caption, comments | DOM scrape + Claude |
| "Give me the recipe shown" | Visual frames + audio | Claude reads ingredients/steps from video |
| "Is this place crowded?" | Visual frames + comments | Crowd density read + comment sentiment |

---

## APIs and services

| Service | Purpose |
|---|---|
| Claude API (claude-sonnet-4-6) | Vision analysis of frames, text reasoning, answering freeform questions |
| Whisper (OpenAI) or Gemini audio | Audio transcription for signal 5, and deep analysis |
| Google Maps Places API | "Similar places" suggestions, place ID resolution for "Open in Maps" |
| Gemini API with Maps Grounding | Optional: richer location-aware answers (announced March 2026) |

---

## Architecture — Chrome extension components

```
manifest.json
  - permissions: activeTab, scripting, storage

content_script.js  (injected into instagram.com)
  - finds <video> element
  - iterative frame sampling loop:
      sample 6-8 random timestamps
      → send to background → check confidence
      → if low, resample new timestamps, repeat (max 3 rounds)
  - scrapes caption, location tag, comments from DOM
  - extracts video src URL for Whisper (deep analysis)
  - caches all extracted data in chrome.storage.session

background.js  (service worker)
  - calls Claude API with frames + text signals
  - evaluates confidence; requests another sample round if below threshold
  - on deep analysis trigger: calls Whisper API + dense frame pass
  - calls Google Maps Places API for similar places + place ID resolution
  - returns results to panel

popup/panel.html+js  (the extension UI)
  - Tab 1: Location
      signal rows (found / scanning / none)
      result card with confidence bar (green or amber)
      "Open in Maps" + "Similar places" buttons
      "Run deep analysis" button (Mode B only)
  - Tab 2: Ask anything
      freeform prompt input
      answer display with product rows if relevant
      suggestion chips
```

---

## Build order suggestion

**Phase 1 — MVP (location only, fast lane)**
- Extract caption + location tag from DOM
- Single-pass 6–8 frame extraction
- Send to Claude → place name + confidence
- Basic panel with green/amber result
- "Open in Maps" with place ID (tag) or search fallback

**Phase 2 — Iterative sampling + deep analysis**
- Confidence-driven sampling loop (resample if below threshold)
- "Run deep analysis" button
- Audio transcription via Whisper on demand

**Phase 3 — Slow lane + best-guess mode**
- Comment scraping
- "DM me" pattern detection → amber UI + banner

**Phase 4 — Ask anything tab**
- Freeform prompt input reusing cached frames + transcript
- Product search integration
- Suggestion chips

**Phase 5 — Maps integration**
- Google Maps Places API for similar places
- Gemini Maps Grounding (optional, richer location answers)

---

## Open questions / decisions

- **Extension name:** "Reel Intel" (working title)
- **Auth model:** User brings own Claude API key, or backend proxy?
- **Confidence threshold:** 80% suggested as the "stop sampling" cutoff — needs tuning with real data.
- **Sampling cap:** 3 rounds (~24 frames) before giving up and showing best guess.
- **Audio latency:** Don't block the UI — show fast-lane result first, update silently when Whisper completes.
- **Instagram ToS:** Extension uses native `<video>` element and public DOM — no private API calls. Review before Chrome Web Store submission.
- **Monetisation:** Free tier (limited queries/day) + paid tier (unlimited + audio + deep analysis)?

---

## Reference

- Google Maps Grounding via Gemini API: https://ai.google.dev/gemini-api/docs/maps-grounding
- Ask Maps feature (March 2026): https://techcrunch.com/2026/03/12/google-maps-is-getting-an-ai-ask-maps-feature-and-upgraded-immersive-navigation/
- Chrome Extensions Manifest V3: https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3
- `requestVideoFrameCallback()` MDN: https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback
