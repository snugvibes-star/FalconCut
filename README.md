# CutFlow

CutFlow is a privacy-first, AI-native video editor that runs entirely in your browser. Your media never leaves the device — no uploads, no account, no backend. Editing intelligence (analysis, style rules, high-level tools, quality checks) lives in the application, not in a model, so even a modest AI model can produce professional, human-looking edits — and every AI feature is optional.

<!-- TODO: screenshot -->

## Quickstart

**Requirements:** Node.js 18+ and a Chromium-based browser (Chrome or Edge) for the best experience (see [Browser requirements](#browser-requirements)).

```bash
npm install        # install dependencies
npm run dev        # dev server at http://localhost:5173
```

Production build:

```bash
npm run build      # type-check + build to dist/
npm run preview    # serve the production build locally
```

Tests (76-test engine suite — timeline, effects, store, tools, exports):

```bash
npm run test
```

## Features

CutFlow's honest, always-up-to-date status board lives in [`src/features/checklist.ts`](src/features/checklist.ts) — it is rendered in-app and marks every capability as `working`, `partial`, or `not-possible`. Highlights:

- **Multi-track timeline** — video + audio tracks, split/trim/ripple delete, drag-reorder between tracks, snapping, markers, undo/redo, autosave to browser storage.
- **Speed ramps & freeze frames** — clip speed 0.25x–4x, piecewise time remapping with a graphical ramp editor (ramp-aware split/trim/ripple keep continuity), one-click freeze frames from the preview transport, and true clip reverse (video scrubs frame-by-frame, audio plays a genuinely reversed buffer — preview and export match).
- **Blend modes & blend transitions** — screen, multiply, overlay, add, soft-light and more via canvas compositing, plus 15 blend-style transitions. The same engine renders preview and export, so what you see is what you get.
- **Drawing & direct manipulation** — 12 draw tools (brush, pen, arrow, shapes, stickers…) as independent editable overlay layers; drag-move, corner-resize, rotate, and inline text edit directly on the preview.
- **Captions** — automatic transcription with Whisper running as WASM in a web worker, multiple caption styles, editing, translation (needs an AI key), and `.srt` sidecar export.
- **Color grading** — lift/gamma/gain per channel, hue/temperature/saturation, preset looks, auto-normalize, live scopes (waveform, vectorscope, histogram) in the Color workspace, and `.cube` LUT import with per-clip strength.
- **Audio DSP** — compressor, limiter, echo, pan, fades, LUFS loudness normalization, noise reduction/de-ess/high-pass, auto music ducking, in-app voiceover recording.
- **Export** — MP4 (H.264 + AAC) via WebCodecs when available, WebM (VP9/Opus) otherwise, audio-only WAV, current-frame PNG, animated GIF of a marked section, and `.srt` subtitles.
- **Stock media panel** — search and import free stock media (Archive.org works keyless; Pexels/Pixabay/Freesound use a free personal key stored locally).
- **Keyboard shortcuts** — Premiere-style edit keys (V select, C razor, I/O zone, Ctrl+K add-edit-all…) plus a full cheatsheet in the command palette.
- **Optional AI planning** — connect an AI agent for one-click auto edits, dead-air cutting, smart cutdowns, A/B variants, auto b-roll, and beat-snapped assembly. Without a key, every tool still works from buttons via local rules. Model settings support Google Gemini (native protocol) and any OpenAI-compatible endpoint, with a **Fetch models** button that lists the models your key can actually use and a **Test connection** button that sends one tiny real request with the values in the form.
- **PWA — installable on every device** — install CutFlow as an app on Windows, macOS, Linux, Android (Chrome) and iOS (Safari 16.4+). A service worker caches the app shell, so an installed editor keeps working offline — media lives in IndexedDB on the device either way.

Honest limits worth knowing: no 3D camera space, no reverse playback, no optical-flow frame blending, no LUT `.cube` import, no multicam angle-switching UI. The checklist file is the source of truth.

## Optional AI setup

AI is **fully optional** — all core editing works without any key. If you want model-driven planning (auto edit, caption translation, AI chat), configure a provider in-app.

**Keys are stored in your browser's `localStorage` only.** They are never sent anywhere except to the provider you choose, and never committed anywhere.

### Google Gemini

1. Get a free API key at [aistudio.google.com](https://aistudio.google.com).
2. Open **Settings** (gear icon) → **AI provider** → select **Google Gemini**.
3. Paste your key.
4. Set the model, e.g. `gemini-2.0-flash`.
5. Click **Test connection**.

### OpenAI-compatible endpoints

Settings → AI provider → **OpenAI-compatible**: enter a base URL (e.g. an OpenAI or local LM Studio/Ollama-compatible endpoint), an API key, and a model name. Test connection to verify.

## Privacy & data

- **Local-first:** all decoding, rendering, transcription, and export happen on your device. There is no backend and no telemetry.
- **Browser storage:** projects autosave to IndexedDB; media assets are stored locally alongside them.
- **Garbage collection:** orphaned assets (media no longer referenced by any clip) are cleaned up from storage automatically.
- **AI keys:** stored in `localStorage` only, used only for calls to the provider you configured.
- **Whisper model:** the transcription model is downloaded once from Hugging Face and cached — that one download is the only network fetch besides optional stock search.

## Browser requirements

CutFlow targets modern browsers. **Chromium-based browsers (Chrome, Edge) are recommended** — they expose WebCodecs with H.264, enabling fast, frame-accurate **MP4 export**. Firefox and Safari fall back to **WebM** export (VP9/Opus). Older or restricted browsers may still work for editing but with reduced export options.

## Troubleshooting

- **MP4 export unavailable** — your browser doesn't expose an H.264 encoder through WebCodecs. Use **WebM** export instead (works everywhere; convert with any tool afterward).
- **Large-file playback stutter** — very large videos are decoded on demand; give the timeline a moment after loading before expecting smooth playback. Scrub once through the section you want to preview.
- **CORS-blocked stock downloads** — some stock CDNs block direct browser downloads. The stock panel shows an honest error; download the file manually and import it as a local file instead.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Keep `npm run test` green and keep feature claims honest — update `src/features/checklist.ts` whenever behavior changes.

## License

[MIT](LICENSE) — © 2026 CutFlow contributors.

## Tech stack

React 18, Vite 5, TypeScript, Tailwind CSS, zustand (state), WebCodecs + canvas 2D (render/export pipeline), `mp4-muxer`/`webm-muxer` (container muxing), `@huggingface/transformers` (Whisper WASM captions), IndexedDB via `idb` (local storage). No backend — the whole app is a static build.
