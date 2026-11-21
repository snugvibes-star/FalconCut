# FalconCut — Deep Analysis, Retention & "Make It a Real App" Plan

**Date:** 2026‑11‑16
**Scope:** static read of the whole repo + live end‑to‑end testing of the running app in headless Chrome (CDP), plus unit tests and the production build.
**Verdict in one line:** the *engine and concept* are genuinely strong and differentiated; the *product shell* is not shippable yet — the app did not boot at all when I started, the transition renderer is broken, and the "installable app" pieces are missing. Everything in this document is either measured live or cited to a file/line.

---

## 1. Executive summary

| # | Finding | Evidence |
|---|---------|----------|
| 1 | **The app did not boot.** `OverlayEditor.tsx:219` used an invalid TypeScript type (`Parameters<typeof useStore.getState().commit>`), Vite returned HTTP 500, and the browser showed a blank page. I fixed that one line; it now boots. | Vite error 500 + blank screenshot; fix in `src/components/preview/OverlayEditor.tsx` |
| 2 | **`npm run build` is still red** (2 type errors) and **1 unit test fails** (speed‑ramp split continuity). | `tsc` errors at `DrawBar.tsx:75`, `OverlayEditor.tsx:425`; `tests/engine.test.ts:198` expects 7.5625, got 4.5625 |
| 3 | **The core works.** Import → analyze → edit → undo → playback → MP4 export → reload‑restore all pass live. 22 AI tools preview without throwing; `auto_edit` produces 25 actions as **one undo step**. | 15/18 live tests pass (see §4) |
| 4 | **Transitions are visibly broken.** A "crossfade" applied as a clip *out* is a linear fade to **black** (128 → 96 → 64 → 32 luma at 25/50/75 %). And the PNG exporter renders the *incoming* half of a transition black. | `engine/render.ts:231‑238`; measured engine‑level with a solid resolver; PNG path measured at 0.41× normal luma |
| 5 | **Reopening a project shows a black preview** until you scrub. First frame after reload = luma 0; after one scrub = 124.7. | live probe on the running app; matches the known "nothing repaints" defect |
| 6 | **It is not an app yet.** `/manifest.webmanifest` and `/icon.svg` are referenced by `index.html:5,9` but don't exist; the SPA fallback returns `index.html` (status 200, `text/html`), there is no service worker, no install prompt. | live fetch + `navigator.serviceWorker.getRegistrations() === 0` |
| 7 | **Export speed is the retention risk.** 9 s of 960×540 video encoded in **8.6–11.1 s = 0.8–1.05× real time** on a fast machine (two runs). CapCut/phone editors export faster than real time. | measured `exportVideo` timing |
| 8 | **The thesis is defensible:** one deterministic renderer for preview+export, one action manifest for humans/AI/MCP, zero uploads, honest capability labels. Nobody else in this category has that combination. | architecture read + live tests |

---

## 2. How this was tested (so you can trust the numbers)

* **Static audit:** every source file read; three parallel deep‑dives (engine/exporter, UI/PWA, QA/release).
* **Unit tests:** `npm test` → **75/76 pass**, 9.97 s.
* **Production build:** `npm run build` → fails at `tsc -b` (2 errors).
* **Live E2E (headless Chrome 157 via CDP, 1600×1000):** fresh profile, IndexedDB wiped, real file‑input import of a real MP4 + generated PNG + generated WAV, then 18 checks through the app's own store surface (`window.falconcut`) and UI clicks.
* **Renderer probes:** deterministic `renderFrame` calls with a synthetic resolver (solid gray frames) to isolate compositing from decode timing.
* **Artifacts:** screenshots, a JSON result matrix (`feature-test-v3-results.json`), and the harness scripts are in `…\default-workspace\falconcut-qa\`.

Harness: `falconcut-qa/feature-test-v3.mjs` (E2E), `falconcut-qa/eval.mjs` (single expression against the live page), `falconcut-qa/diag.mjs` (boot diagnostics).

---

## 3. What is genuinely strong (do not rebuild)

1. **One document, one edit path.** The whole project is one JSON `Project` (`engine/types.ts:330‑346`); every mutation is a serializable `Action` applied by `applyAction` inside immer (`engine/actions.ts:194‑559`). Human clicks, AI tools, MCP and the in‑page API all land in `commit() → History → scheduleSave()` (`src/state/store.ts:320‑340`). This is the right architecture and it is rare.
2. **One renderer.** `renderFrame(project, t, ctx, resolver)` is used by preview (`Preview.tsx:89‑98`), PNG (`exporter/artifacts.ts:93`), MP4 (`exporter/video.ts:185‑187`) and WebM (`exporter/webm.ts:110`). WYSIWYG is structurally true (modulo the bugs in §5).
3. **One audio graph.** `buildAudioGraph` (`engine/audio.ts:47‑180`) is shared by preview and every export path, including WAV (`artifacts.ts:50`).
4. **22 high‑level tools with real preview semantics.** `runTool` returns actions and changes nothing; `applyTool` is one undo step. I ran every tool's own example through the app: **0 threw**, most produced sensible actions or honest warnings ("needs a transcript", "no AI endpoint configured"). That is a stronger agent surface than CapCut's or Premiere's.
5. **Honest capability board.** `src/features/checklist.ts` labels Working / Partial / Not possible with reasons. This is a trust asset — keep it, and keep it honest (two entries are now wrong: see §6).
6. **Privacy / local‑first.** Media in IndexedDB, no upload, no account, no telemetry. This is the marketing wedge against CapCut (cloud, account, watermark) and Adobe (subscription, cloud).
7. **Quality lint + auto‑fix.** `quality/lint.ts` (15 checks) and `auto_fix` run headless; the panel discloses "Rules, not a visual review". Good.

---

## 4. Live test results (measured)

### Passed (15/18)

| Result | Detail |
|---|---|
| Boot + agent API | shell renders, `window.falconcut` present |
| Import 3 files via Media panel | media=3, clips=3 in **879 ms** |
| Analysis of every asset | video/image/audio all get `analysis.byMedia` entries |
| Playback | playhead 0.09 → 1.73 s over 1.8 s (≈real time); pause holds |
| Split / undo | 3 clips → 4 → undo → 3 |
| Keyframes | scale animates in the **exported** render: mean luma 44.7 → 127.3 |
| Effects | vignette changes exported pixels (luma 127.1 → 121.2) |
| All 22 tools preview | none threw; warnings are honest |
| `auto_edit` | 25 actions, 3 → 8 clips, **one undo** restores 3 |
| Quality lint | issues readable by agents |
| PNG / SRT / WAV | PNG 207 KB; WAV 9 s stereo |
| **MP4 export** | H.264+AAC, 960×540, 270 frames, 523 KB, **8.6–11.1 s (0.8–1.05× real time)**, playable (`videoWidth` 960, duration 9.0) |
| Persistence | reload restores the same project with all 3 media |

### Failed (3/18) — all real product defects

| Failure | Measured | Root cause |
|---|---|---|
| Transition OUT "crossfade" dips to black | luma ratio **0.49** vs normal | `engine/render.ts:231‑238`: `transitionOut` always paints an opaque black (or white for `dip-white`) full‑frame fade, whatever the type |
| Transition IN crossfade in PNG export | luma ratio **0.41** | `exporter/artifacts.ts:55‑99`: `projectPNG` builds its own exact‑key resolver and never preloads the transition partner clip, so the "previous" layer is transparent |
| PWA | manifest 200 `text/html`, icon 200 `text/html`, SW registrations **0** | `public/manifest.webmanifest` and `public/icon.svg` do not exist; SPA fallback serves `index.html` |

Engine‑level transition probe (solid gray frames, no decode involved): normal **128**; out‑transition at 25/50/75 % → **96 / 64 / 32** (linear fade to black); in‑transition at 50 % → **128** (a real crossfade with the previous clip). So the compositor *can* crossfade; only the `out` path and the PNG resolver are wrong.

Additional measured defect: **preview black after reload** — canvas mean luma **0** at load, **124.7** after moving the playhead. This is the "preview can stay black… nothing repaints" item from your own master prompt; it is still there and it is the first thing a returning user sees.

---

## 5. Blocking defects, ranked (fix these before any feature work)

| P | Defect | Where | Fix |
|---|---|---|---|
| 0 | Build red: `PreviewTool` includes `'select'` which is not a `DrawTool` | `src/components/preview/DrawBar.tsx:75` | narrow the type before the call |
| 0 | Build red: `getContext('2d')` may be null | `OverlayEditor.tsx:425` | null‑guard / non‑null assert |
| 0 | Unit test red: split of a speed‑ramped clip breaks source‑time continuity | `engine/actions.ts:276‑279` | trim/split against `avgSpeed` (or integrate the ramp) |
| 1 | **Transition out is a dip‑to‑black for every type** | `engine/render.ts:231‑238` | for `crossfade`, blend the *next* clip's first frame over the outgoing one (needs a look‑ahead resolver); reserve black/white paint for `dip-*` |
| 1 | **PNG export misses transition partner frames** | `exporter/artifacts.ts:55‑99` | build it on `collectFrameRequests` + `ExportFrameResolver` (already imported and unused), delete the duplicate `BlobLoader` import |
| 1 | Preview stays black until a repaint | `engine/media.ts:147‑157`, `Preview.tsx` | when `frame()` returns null because a seek is in flight, schedule a retry/re‑render on `seeked`; draw a diagnostic tile on decode error |
| 1 | MediaRecorder WebM fallback exports **black video** (Safari/Firefox path) | `exporter/webm.ts:38‑46` | `el.src = URL.createObjectURL(await loadBlob(blobKey))`, key by asset id, revoke on stop |
| 1 | WebM fallback can hang forever / unhandled rejection | `exporter/webm.ts:116, 98‑136` | try/catch in the rAF loop, `.catch()` on `seekFrame`, guarantee `recorder.stop()` |
| 2 | >5 min projects export **silently without audio** | `exporter/artifacts.ts:34` + `video.ts:108‑109` | chunk the offline mix; surface `audioError` instead of swallowing |
| 2 | 4K probe is fixed at 720p; no fallback to WebM on encode failure | `exporter/video.ts:246‑253`, `ExportDialog.tsx:53‑64` | probe at the real output size; check all WebCodecs globals; catch and fall back |
| 2 | `trim_clip`/`split` ignore `speedPoints` | `engine/actions.ts:276‑279` | same as the failing test |
| 2 | Creation ids can collide (same action applied twice → duplicate clip ids) | `engine/actions.ts:195,143` | salt with a monotonic counter |
| 3 | Preview audio ignores fade/keyframe/effect edits until stop/play | `src/hooks/usePlayback.ts:149‑156` | extend `audioSig` with `inPoint`, `fades`, `keyframes`, `speedPoints`, `effects` |
| 3 | Chroma key silently never fires for `rgb()`/short hex | `engine/effects.ts:62‑64` | parse properly and warn |
| 3 | `typewriter` offered but not implemented; `letterSpacing` ignored | `engine/captions.ts:82‑85, 95‑131` | implement or remove from UI |

---

## 6. Feature inventory vs the claims (honesty audit)

**What is real and works today (verified):** multi‑track timeline, split/trim/ripple, markers, snapping, undo/redo, autosave + project library, keyboard shortcuts, context menu, keyframes + easing + animation presets, crop/flip/rotate/skew, text clips + effects, captions rendering, SRT export, color grade (brightness/contrast/temp/saturation/lift‑gamma‑gain), color presets, scopes, chroma key, blur/sharpen/vignette, audio fades/compressor/limiter/echo/pan, loudness normalize + ducking, 22 AI tools, smart cutdown, A/B variants, multicam, auto b‑roll slots, quality lint + auto‑fix, MP4/WebM/WAV/PNG/SRT export, agent API + MCP + relay.

**Claims that are not currently true:**

1. `src/features/checklist.ts` marks **transitions "working"** — they render as dips to black (measured). Downgrade to **Partial** with the reason until fixed.
2. `checklist.ts` marks **"scopes working"** and **"preview customization working"** — plausible, but the preview itself can be black on load (§4), which undermines both.
3. `llms.txt`/`ExportDialog` promise "MP4 · H.264" at any resolution — the level caps (4.0/3.1) make 4K fail, and the probe is 720p.
4. `ExportDialog` says WebM real‑time capture is the fallback — that path produces black video today.
5. `public/llms.txt` describes `window.falconcut.applyTool` etc. correctly, but the app can't be reached at all if a syntax error lands in a component (no CI gate).

**Feature surface vs CapCut/Premiere** — the honest position is: FalconCut has **breadth in AI automation** (better than both), **parity in basic editing**, **a real gap in polish/depth** (transitions, effects library, templates, color depth, audio depth, performance).

---

## 7. Retention: why users would leave, and what actually keeps them

Retention in a consumer editor is not driven by feature count. It is driven by five loops. Here is FalconCut's position on each:

### 7.1 Time‑to‑first‑win (strong idea, weak execution)
The winning flow is: *open → import → "Auto edit" → preview → export → share*. It exists (`auto_edit`, 25 actions, one undo) and needs **no AI key**. But:
* first‑run users see a black preview (§4) → "it's broken";
* the demo timeline button helps, but there is no guided "3 steps" onboarding;
* Whisper captions need a model download on first use with no visible size/time estimate;
* no platform presets ("TikTok 9:16 + captions + hook") in one click.

**Retention lever:** a first‑run "make your first clip in 3 clicks" flow with a real sample project and a share‑ready export at the end. This is the single highest‑leverage retention change.

### 7.2 Trust in the output (currently the biggest churn risk)
Users forgive missing features; they do not forgive *silent* failure. Today: black exports on the fallback path, black preview after reload, transitions that look amateur, silent audio after 5 minutes, a one‑click "reset everything" in the error boundary. Every one of those is a refund/review moment.
**Lever:** "never silently wrong" — visible decode errors, export validation (decode the first and last frame of the produced file before offering download), and a "Your export is ready and plays" check.

### 7.3 Speed (the CapCut killer)
0.81× real time at 540p, CPU `getImageData` effects (`engine/effects.ts:88‑203`), double render pass in export (`exporter/frames.ts:11‑19`), main‑thread decode. On a 3‑minute 1080p vlog this is minutes, not seconds.
**Lever:** WebGL2/WebGPU effect chain + WebCodecs hardware preference + worker‑side decode. Target: **2–4× faster than real time** at 1080p. This is a technical moat no web editor has today.

### 7.4 Session‑to‑session continuity
Projects persist (verified across reload), but:
* there is **no project import** (JSON export doesn't embed media) — a lost machine means lost work;
* error boundary can wipe IndexedDB in one click with no export‑first prompt;
* no quota/storage warnings;
* no cloud, no sync, no co‑editing (fine — but then backups must be excellent).

**Lever:** `.falconcut` bundle export/import (project + media), quota meter, "download backup" nudge, and export‑before‑reset.

### 7.5 Habit & identity
No template library, no brand kit, no asset/music library, no presets that make the second video faster than the first. Every CapCut session is faster because of templates/trends/favorites. FalconCut has styles packs (`styles/packs.ts`, `styles/rules.ts`) but not a browsable template gallery.
**Lever:** 20–30 editable viral templates (hook + captions + zooms + music + transitions) + brand kit + "apply my look" + per‑platform presets. This is what turns a tool into a habit.

**Retention scorecard (my assessment):**

| Loop | Today | Potential | Cheapest fix |
|---|---|---|---|
| Time‑to‑first‑win | 3/10 | 9/10 | onboarding + black‑preview fix + platform presets |
| Output trust | 2/10 | 9/10 | transitions, fallback export, decode errors, export validation |
| Speed | 3/10 | 9/10 | shader pipeline + worker export + hw encode |
| Continuity | 5/10 | 8/10 | bundle backup/import + quota + reset guard |
| Habit | 2/10 | 8/10 | template gallery + brand kit + presets |
| Differentiation (privacy/agent) | 9/10 | 10/10 | ship it visibly: "no upload" proof, MCP one‑click, local LLM |

---

## 8. What to add to beat CapCut and Premiere (prioritized)

Ordering rule: **trust → speed → social parity → depth → moat.** Anything that cannot be honest in preview *and* export does not ship.

### P0 — Ship‑ability (≈1–2 weeks, blocks everything)
1. Green `npm run build` + green `npm test` (the 5 items in §5 P0).
2. Fix transition out + PNG resolver (P1 rows) and re‑label transitions honestly.
3. Fix the MediaRecorder fallback so Firefox/Safari export isn't black.
4. Preview repaint: never leave a stale black frame.
5. Export modal: keep rendering when the dialog closes; progress + completion notification (`Notification` API); cancel.
6. Chunked audio mix past 5 min; surface audio errors.
7. First‑run onboarding + sample project + 3‑step flow.

**Why first:** without 1–5 every other feature multiplies churn.

### P1 — Beat CapCut on social speed (2–4 weeks)
8. **One‑click platform packs:** TikTok / Reels / Shorts / YouTube / LinkedIn → aspect + safe zones + captions style + hook + bitrate + filename + cover thumbnail.
9. **Multi‑format export in one run** (9:16 + 1:1 + 16:9 from one timeline) as a background queue.
10. **Template gallery:** 20–30 viral templates (hook, captions, zoom, music bed, transitions) with previews and one‑click apply; save any project as a template.
11. **Caption engine upgrade:** word‑level karaoke (exists), auto‑emoji, keyword highlight, bilingual pairs, SRT/VTT/ASS import, speaker labels, transcript search/edit, translate (exists).
12. **Music/SFX library** with clearly licensed loops + beat‑sync (exists) + auto‑ducking (exists).
13. **Mobile/PWA:** installable, touch gestures (pinch zoom, long‑press menu), share sheet target, responsive timeline.
14. **Speed pass:** WebGL2 effect chain (vignette/blur/chroma/curves/LUT/grain), hardware encoder preference, frame cache, decode in a worker. Target 2–4× faster than real time at 1080p.

**Why:** these are the features that make CapCut win on phones. FalconCut can match them in the browser and beat them on privacy + no watermark + no account.

### P2 — Beat Premiere on depth (4–8 weeks)
15. Real transition library (30+) as shader passes; in/out/combo semantics; apply‑to‑all; easing.
16. Effects: 40+ (glitch, RGB split, VHS, grain, shake, mirror, kaleidoscope, pixelate, fisheye, wave, light leaks, CRT, posterize, duotone…).
17. Color depth: curves, HSL qualifier, `.cube` LUT import + intensity, color match, node grading, Rec.709 handling, waveform/parade/vectorscope (scopes exist).
18. Audio depth: parametric EQ, multiband comp, gate/expander, de‑noise/de‑ess (DSP exists), buses/sends, automation lanes, LUFS targets (exists), recording (voiceover/webcam), TTS (exists).
19. Editing depth: nested sequences, source/program monitor, 3‑point edit, slip/slide/roll, mask shapes + track mattes, adjustment layers, tracking (point/planar partial), motion blur (honest Partial).
20. **Interchange:** FCPXML / EDL / OTIO export, Adobe XML import — this is how professionals adopt you without abandoning their pipeline.
21. Shortcut presets (Premiere / CapCut / DaVinci) + full remap UI.

### P3 — The moat nobody else has (ongoing)
22. **Agent‑native editing as a product, not an API:** "AI editor" panel that plans → previews → applies with one undo; MCP server packaged as a one‑click install; in‑page API (exists) documented; multi‑agent roles already in `ToolDef.roles` — wire them into a planner that critiques its own output with `quality/lint.ts`.
23. **Local‑first intelligence:** Whisper (exists), background removal via ONNX/MediaPipe, face tracking (exists), scene/beat detection (exists), RNNoise‑style voice isolation, optional local LLM (WebLLM) so "no key, no cloud" is literally true.
24. **Collaboration without a server:** WebRTC P2P co‑editing with CRDT on the `Project` document; the clip‑lock system (`locks`) already models human/AI co‑editing.
25. **Performance parity with native:** WebGPU renderer + hardware encode + worker pipeline. Publish honest benchmark numbers in the README — it's a marketing asset.

### What **not** to add (protect the brand)
3D layers, node compositors, rotoscoping, LUTs without a parser, "AI dubbing with lip‑sync", cloud publish — unless they can be **Working** in preview and export. Your own honesty rule is the differentiator; a fake button destroys it.

---

## 9. "Make it feel like a real app" — concrete checklist

### 9.1 Installable PWA (this is what "like an app" means on the web)
* `public/manifest.webmanifest`: `name`, `short_name`, `start_url: "/"`, `scope: "/"`, `display: "standalone"`, `theme_color` (use the real background `#101012`, not `#07090F`), `background_color`, `icons` 192/512 + `maskable`, `screenshots`, `categories`, `shortcuts` (New project, Import, Auto edit), `share_target` (accept video/audio), `file_handlers` for `.falconcut`.
* Real `public/icon.svg` + PNG fallbacks + `apple-touch-icon`; fix `index.html:5,9` (both currently 404).
* `vite-plugin-pwa` (Workbox): precache the app shell, runtime‑cache hashed assets and fonts, offline fallback page, update toast ("New version — reload"), and `registerSW` in `src/main.tsx`.
* `beforeinstallprompt` → Install button in `TopBar` and the mobile "More" menu; standalone‑mode CSS; `display-mode: standalone` handling.
* Offline reality check: demo media (`testvideo.mp4`, `tone.wav`) and the Whisper model must be cached or the first‑run flow fails offline.
* Cross‑origin isolation for threaded ORT needs COOP/COEP headers — GitHub Pages cannot set them; use `coi-serviceworker` or fall back to single‑threaded ORT.

### 9.2 Desktop wrapper (only if you want an installer)
Electron is the safer choice than Tauri because you get a known Chromium with WebCodecs; Tauri's WebView2 H.264 support varies by machine. If you do it:
* `base: './'` or a custom protocol (absolute `/assets/...` breaks under `file://`), and make `fetch('/tone.wav')` relative.
* IndexedDB origin changes → existing browser projects are invisible. Ship project **export/import bundles** first, then migrate.
* `will-download` handler / native save dialog; `showSaveFilePicker` in the web path.
* Close guard while `saveStatus !== 'saved'`; single‑instance lock; native menu; `.falconcut` file association; auto‑update + code signing.
* Don't fork the renderer — reuse the exact same `dist/` build.

### 9.3 Publishing to GitHub `main` (prepared, not executed — per your instruction)
When you decide to publish: `git init -b main`; `.gitignore` (`node_modules/`, `dist/`, `tsconfig.tsbuildinfo`, `editor-qa.png`, `qa/`); one squashed "Initial public release v1.0.0" commit; tag `v1.0.0`. Add: README (pitch, GIF from `editor-qa.png`, quickstart, honest limits, agent API), `LICENSE` (MIT or Apache‑2.0), CI (`npm ci && npm run build && npm test` on Node 22), Pages workflow with `base: '/falconcut/'` + `404.html`, `SECURITY.md` (AI keys in `localStorage`, relay token in URL), `engines.node >= 22`, `.nvmrc`. Scrub `FALCONCUT-MASTER-PROMPT.md` and `docs/kdenlive-filter-map.md` (internal paths/methodology) and add provenance for `public/testvideo.mp4` + `tone.wav` (licensing), delete the unused `tone2.wav`.

---

## 10. Recommended next 10 actions (in order)

1. Fix the 2 type errors + the speed‑ramp split test → green build/test.
2. Fix `transitionOut` (crossfade with the next clip) and `projectPNG` (use `ExportFrameResolver`).
3. Fix the preview‑black‑after‑load repaint loop.
4. Fix `projectWebM` (`el.src`, promise settlement) — Firefox/Safari parity.
5. Add export background queue + completion notification; chunk audio past 5 min.
6. Add manifest + icons + service worker + install button (PWA v1).
7. Add project bundle export/import + quota/save‑error recovery + reset guard.
8. Add first‑run onboarding: sample project, 3‑step flow, platform presets.
9. Add template gallery + brand kit (retention loop #5).
10. Start the WebGL2 effect chain + hardware encode (speed moat).

---

## Appendix A — Files I changed during testing

* `src/components/preview/OverlayEditor.tsx:219` — replaced the invalid `Parameters<typeof useStore.getState().commit>[0]` with `Parameters<ReturnType<typeof useStore.getState>['commit']>[0]`. **This was required for the app to boot at all.** Nothing else in the project was modified.

## Appendix B — Reproduce the evidence

```powershell
# unit tests
cd C:\Users\Nexus Computer\Documents\Qoder\2026-11-11\a95fd32a
npm test

# build (currently red)
npm run build

# dev app + headless Chrome (port 9224), then:
node C:\Users\Nexus Computer\OneDrive\Documents\deepseek-harness\default-workspace\falconcut-qa\feature-test-v3.mjs http://127.0.0.1:5173
```

`feature-test-v3-results.json` holds the pass/fail matrix used in §4; `01-empty-state.png` … `06-export.png` are the captured screenshots.
