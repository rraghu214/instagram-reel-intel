# 🎬 Reel Intel

> **The AI-powered intelligence layer for Instagram Reels.**
> Scroll your feed. Hit Analyze. Know everything.

Reel Intel is a Chrome extension that sits quietly in your browser sidebar and, on demand, tells you *everything* about any Instagram Reel — where it was filmed, what's in it, what song is playing, what outfit the creator is wearing, and more. Powered by Google Gemini (free) with Claude as a smart fallback.

---

## ✨ What it does

| You see a Reel... | Reel Intel tells you... |
|---|---|
| 🏖️ A stunning café you've never seen | Exact name, city, Google Maps link |
| 👗 An outfit you need to own | Brand, style, where to buy it |
| 🎵 A banger you can't name | Song title + artist |
| 🍝 A recipe that looks incredible | Full ingredient list + steps |
| 📸 Gorgeous cinematography | Camera, lens, shooting style |
| 🗺️ A travel vlog | Location + similar places nearby |

All of this without ever leaving Instagram. All from the sidebar.

---

## 🚀 Features

### 🔍 Location Detection (the flagship)
Multi-round AI analysis that gets smarter with every pass:
- Reads the **location tag**, **caption**, **author username**, and **comments** first
- Extracts **video frames** via canvas and sends them to AI
- Runs up to **3 confidence-driven rounds** — if the first guess is shaky, it samples more frames
- Offers a **deep analysis mode** with dense frame sampling + audio transcription for stubborn locations
- Shows a **confidence bar** (0–100%) so you know how sure it is

### 💬 Ask Anything
Switch to the Ask tab and ask the Reel anything in plain English:
- *"Where is this place exactly?"*
- *"What song is playing?"*
- *"Give me the full recipe with quantities."*
- *"What camera was used to film this?"*
- *"How crowded is this place? What's the vibe?"*

One-tap **quick chips** get you answers in seconds.

### 📚 Persistent History
Every analysis is saved locally — forever (or until your browser storage fills up):
- Searchable by place name, city, or country
- Timestamps on every entry
- Q&A pairs appended to history items
- One-click delete with the ✕ button
- Click any history item to jump back to it

### 🗺️ Google Maps Integration
- **Open in Maps** — deep-links to the exact place
- **Similar places** — finds comparable spots nearby using the Places API
- Falls back to a Google Maps search if no API key is configured

### 🛑 Full Control
- **Manual trigger** — analysis never starts until *you* press Analyze
- **Stop button** — cancel mid-flight; if any result was found, it's shown
- **Re-analyze** — fresh run any time with the ↺ button

### 📡 Works Everywhere on Instagram
- `/reel/` pages — individual reels
- `/p/` pages — photo and video posts
- `/stories/` — stories
- Home feed — analyze whatever is playing as you scroll
- Reels feed — same deal

---

## 🧠 How it works

```
Instagram page
      │
      ▼
content_script.js          ← injected into instagram.com
  • Extracts caption, location tag, author username, comments
  • Finds the currently playing video (prefers active playback)
  • Seeks to random timestamps → captures JPEG frames via canvas
  • Fetches video blob for audio transcription
      │
      ▼
background.js              ← MV3 service worker
  • Receives frames + metadata from content script
  • Builds multimodal prompt (text signals + images)
  • Calls Gemini API → falls back to Claude if quota exceeded
  • Parses JSON response with 3-tier fallback parser
  • Caches nothing server-side — everything stays in your browser
      │
      ▼
sidebar/sidebar.js         ← persistent browser sidebar
  • Renders result card with confidence bar
  • Saves to chrome.storage.local (survives restarts)
  • Restores result when you switch tabs and come back
```

### AI model chain
```
gemini-2.5-flash  ──► gemini-2.0-flash  ──► gemini-2.0-flash-lite  ──► Claude (fallback)
     503/429               503/429                  503/429              if key saved
```

---

## ⏱️ API Call Sequence

Every time you hit **▶ Analyze**, here's exactly what fires and when:

```
USER HITS ANALYZE
        │
        ▼
① content_script.js  ──  no API calls, instant
   • Reads DOM: caption, location tag, author username, comments
   • Finds the currently playing video
   • Seeks to random timestamps → captures JPEG frames via Canvas
        │
        ▼
② OpenAI Whisper  ──  runs in background, non-blocking
   • Fetches the video blob from Instagram (uses page cookies)
   • Sends to Whisper for speech-to-text transcription
   • Transcript is added to the next AI round if it arrives in time
   ⚠ Does NOT block the result from showing — runs in parallel
        │
        ▼
③ Gemini API  ──  primary AI, called first
   • Tries gemini-2.5-flash
        │ 429 / 503 / 404?
        ▼
   • Tries gemini-2.0-flash
        │ 429 / 503 / 404?
        ▼
   • Tries gemini-2.0-flash-lite
        │ all three failed?
        ▼
④ Claude API  ──  fallback, only if all Gemini models fail
   • Identical prompt, identical JSON output format
   • Transparent to the user — result looks the same
        │
        ▼
⑤ Result evaluated
   • Confidence ≥ threshold → show result, done ✅
   • Confidence < threshold → loop back to ③ with more frames
   • Max 3 rounds of sampling before showing best result
        │
        ▼
⑥ Google Maps API  ──  on-demand only, never called automatically
   • "Open in Maps" clicked → Places API resolves name to place_id
   • "Similar places" clicked → Places API text search nearby
```

### Key things to note
- **Step ① is free** — pure DOM reading + Canvas, no network calls
- **Step ② runs in parallel** — Whisper never delays your result
- **Steps ③→④ are a waterfall** — Claude only activates if all Gemini models are unavailable
- **Step ⑥ is optional** — Maps API is never called unless you click a button
- **The loop (③→⑤) runs up to 3 times** — each round adds 8 more frames for stubborn locations

---

## 🛠️ Installation

Reel Intel is a **developer extension** — you load it directly from the source folder. No Chrome Web Store required.

### Step 1 — Get the code
```bash
git clone https://github.com/rraghu214/instagram-reel-intel.git
# or just download and unzip
```

### Step 2 — Load in Chrome / Edge / Brave
1. Open your browser and go to `chrome://extensions`
2. Toggle **Developer mode** ON (top-right corner)
3. Click **Load unpacked**
4. Select the `reel-intel` folder
5. The Reel Intel icon appears in your toolbar ✅

### Step 3 — Open the sidebar
Click the **Reel Intel icon** in your browser toolbar. The sidebar opens on the right.

> **Tip:** Pin the extension to your toolbar so it's always one click away.

---

## 🔑 Getting Started — API Keys

Reel Intel needs at least **one AI key** to analyze Reels. Everything else is optional.

Go to **⚙ Settings** (gear icon in the sidebar) and fill in what you have.

---

### 1. Gemini API Key — Free, Recommended

The primary AI engine. Free tier gives you ~1,500 requests/day.

1. Go to [aistudio.google.com](https://aistudio.google.com)
2. Click **Get API key** → **Create API key in new project**
3. Copy the key and paste it into Settings → *Gemini API Key*
4. Hit **Test** — you should see `✓ Valid (gemini-2.5-flash)`

> **Quota tip:** The free tier is per-project. If you hit the daily limit (429 error), create a new key from a fresh project — takes 30 seconds.

---

### 2. Claude API Key — Optional Fallback

Claude automatically takes over when Gemini's quota is exhausted or a model is overloaded. Think of it as insurance.

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Create an account and add **$5 credit** (minimum top-up, no expiry)
3. Go to **API Keys** → create a new key
4. Paste into Settings → *Claude API Key*

> **Value:** At ~$3/1M input tokens, $5 buys you hundreds of analyses. It'll last a long time as a pure fallback.

---

### 3. OpenAI API Key — Optional (Audio Transcription)

Used for Whisper audio transcription — helps identify locations from spoken words, background audio, and on-screen text read aloud.

1. Go to [platform.openai.com](https://platform.openai.com)
2. **API Keys** → **Create new secret key**
3. Add a small credit ($5 is plenty — Whisper is very cheap)
4. Paste into Settings → *OpenAI API Key*

> Without this key, audio signals are skipped. Most location detection still works fine via visual frames + text.

---

### 4. Google Maps API Key — Optional (Maps Features)

Enables **Open in Maps** deep-linking and **Similar places** discovery.

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project → **APIs & Services** → **Enable APIs**
3. Enable the **Places API**
4. Go to **Credentials** → **Create credentials** → **API key**
5. ⚠️ Set **Application restrictions** to *None* (browser extensions aren't websites)
6. Under **API restrictions**, allow only *Places API*
7. Paste into Settings → *Google Maps API Key*

> Without this key, the Maps button falls back to a Google Maps search URL — still useful, just not as precise.

---

### Settings summary

| Key | Required? | What breaks without it |
|---|---|---|
| Gemini | **Yes** (or Claude) | No AI analysis at all |
| Claude | No | No fallback when Gemini quota runs out |
| OpenAI | No | No audio transcription |
| Google Maps | No | Maps button uses search instead of deep-link |

---

## 🎯 Usage Scenarios

### Scenario 1 — "Where is this café?"
1. Scroll Instagram, spot a gorgeous café reel
2. Click **▶ Analyze** in the sidebar
3. Watch the signal rows fill in — location tag, caption, frames
4. Get: *"The Rameshwaram Café · Bengaluru · Karnataka · India — 100% confidence"*
5. Click **Open in Maps** → navigate there

### Scenario 2 — "What song is this?"
1. Reel is playing with a banger in the background
2. Switch to the **Ask anything** tab
3. Tap the **"Song playing?"** chip
4. Get the song name, artist, and a Shazam suggestion if uncertain

### Scenario 3 — "I need that outfit"
1. Creator is wearing something incredible
2. Ask: *"What clothing is being worn? Where can I buy it?"*
3. Get a breakdown of the outfit with brand guesses, price ranges in ₹ and $, and Google search terms

### Scenario 4 — "What's the recipe?"
1. Food reel with no caption
2. Tap the **"Recipe?"** chip
3. Get a full ingredient list and steps extracted from the visual frames

### Scenario 5 — Deep analysis for a tricky location
1. First pass returns 35% confidence — "somewhere in Southeast Asia"
2. Click **🔍 Run deep analysis**
3. Extension samples every ~1–2 seconds of the video + transcribes audio
4. Returns: *"Phi Phi Islands · Krabi · Thailand — 78% confidence"*

---

## 🗂️ Project Structure

```
reel-intel/
├── manifest.json          # MV3 manifest — permissions, entry points
├── background.js          # Service worker — AI calls, Maps, audio
├── content_script.js      # Injected into Instagram — frame capture, DOM scraping
├── sidebar/
│   ├── sidebar.html       # Sidebar UI layout
│   ├── sidebar.js         # All UI logic, state, history
│   └── sidebar.css        # Styling
├── settings/
│   ├── settings.html      # API key settings page
│   ├── settings.js        # Save/test keys logic
│   └── settings.css       # Settings styling
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🌐 Browser Support

| Browser | Status |
|---|---|
| Chrome 114+ | ✅ Full support |
| Microsoft Edge | ✅ Full support |
| Brave | ✅ Full support |
| Firefox | ❌ Uses different extension API (MV3 sidePanel not supported) |
| Safari | ❌ Different extension model |

---

## 🔒 Privacy

- **No server.** All processing happens between your browser, the Instagram page, and the AI APIs you configure.
- **No tracking.** Reel Intel has no analytics, no telemetry, no phone-home calls.
- **Your keys stay local.** API keys are stored in `chrome.storage.sync` — synced to your Google account, never sent to any Reel Intel server (there isn't one).
- **Your history stays local.** All analysis history is stored in `chrome.storage.local` on your device only.

The only data that leaves your browser are the video frames + text signals sent to Gemini/Claude for analysis — the same content you're already watching on Instagram.

---

## ⚡ Troubleshooting

**"No video element found"**
The reel hasn't fully loaded yet. Wait a moment and hit Retry.

**"Gemini daily quota exhausted"**
You've hit the free-tier daily limit (~1,500 req/day). Options:
- Wait until midnight Pacific for quota reset
- Create a new Gemini key from a fresh Google Cloud project
- Add a Claude API key as a paid fallback

**"Gemini 503 — model overloaded"**
The extension automatically tries the next model in the fallback chain. If all three fail, it falls back to Claude. If Claude isn't configured, wait a few minutes and retry.

**Maps "Request denied"**
Your Maps API key likely has website restrictions set. Go to Google Cloud Console → API key settings → set **Application restrictions** to *None*.

**Analysis shows wrong result (e.g. grabbed wrong video on feed)**
The extension picks the currently *playing* video. Make sure the reel you want to analyze is actively playing (not paused). Scroll to it, let it start, then hit Analyze.

**Sidebar not opening**
Make sure **Developer mode** is enabled in `chrome://extensions` and the extension is loaded without errors. Try removing and re-loading the unpacked extension.

---

## 🧩 Tech Stack

- **Chrome Extensions MV3** — service worker architecture, `chrome.sidePanel` API
- **Google Gemini** (`gemini-2.5-flash` / `2.0-flash` / `2.0-flash-lite`) — primary multimodal AI
- **Anthropic Claude** (`claude-sonnet`) — fallback AI
- **OpenAI Whisper** — audio transcription
- **Google Places API** — location resolution + similar places
- **Canvas API** — in-browser video frame extraction (no server upload)
- **Vanilla JS** — zero dependencies, zero build step

---

## 📄 License

MIT — do whatever you want with it.

---

<div align="center">

Built with curiosity, caffeine, and way too many Instagram reels.

**[⚙ Settings](#-getting-started--api-keys) · [🐛 Issues](#-troubleshooting) · [⭐ Star if useful](#)**

</div>
