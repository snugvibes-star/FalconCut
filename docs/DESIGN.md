# FalconCut — Master Build Prompt

## 1. The aim

FalconCut is a browser-native, local-first video editor that **beats CapCut on speed and beats Premiere Pro on depth, with zero uploads and zero fake buttons.**

Three things make it win, and every task must serve one of them:

1. **One engine.** Preview and export run the *same* renderer and the *same* audio graph. What you see is exactly what you get. No "works in preview only" features.
2. **One action manifest.** Every capability is a single registered action/tool. A human clicking a button and an AI agent calling a tool execute *the identical code path* and produce *one undo step*.
3. **Honest capability.** Anything the browser genuinely cannot do is labelled **Partial** or **Not possible in browser** with a reason — never faked, never a dead button.

Extend the existing app. Rebuild nothing.

---

## 2. Non-negotiables

- Never delete or regress what already works.
- Every tool must be visibly working in **preview and export**, or honestly labelled as not working.
- Every effect, transition, mask, filter and colour operation is drawn by the **same renderer** in both paths.
- Every mutation goes through **Action → applyActions → history**, so AI edits and human edits are one undo step each.
- Every new capability is registered in the tool manifest with a plain-English description, a params schema and an example, so it appears in **Ctrl+K**, the Tools panel, the MCP bridge and the AI planner at once.
- Heavy work (decode, transcription, segmentation, stabilisation, encoding) runs in **web workers**; the UI never blocks.
- GPU work (effects, colour, transitions, compositing) is **WebGL2 shaders**, not per-pixel JS.

---

## 3. What already exists (do not rebuild)

Project root: `C:\Users\Nexus Computer\Documents\Qoder\2026-11-11\a95fd32a` (React 18 + Vite + TypeScript + Zustand + immer).

- `engine/` — `render.ts` (single `renderFrame(project, t, ctx, resolver)`), `actions.ts`, `history.ts`, `effects.ts`, `easing.ts`, `generators.ts`, `motifs.ts`, `captions.ts`, `audio.ts` (`buildAudioGraph`, shared by preview and WAV export), `media.ts` (preview `MediaPool`), `diff.ts`. Project doc is one JSON `Project` with `tracks[]`/`clips[]`, flat `effects[]` and flat `keyframes[]` (`path` strings).
- `exporter/` — JSON, SRT, PNG, WAV only.
- `tools/registry.ts` — 22 tools; `scripts/gen-manifest.mjs` → `public/tools.json`; `server/relay.mjs` + `server/falconcut-mcp.mjs` for agent access.
- `analysis/` — Whisper worker, silence/beat/scene/text analysis. `ai/` — planner + client with user-supplied key and a no-key path. `quality/lint.ts` — 15 checks with per-issue auto-fixes.
- `src/` — Left panel (Media / Tools / Styles), centre `Preview`, right panel (Inspect / AI / Versions / Quality / Notes), `Timeline`, dialogs, IndexedDB autosave.

Known real defects to fix as part of Milestone 0 (not as a separate ask):
- `exporter/artifacts.ts` has TypeScript errors (`activeClips` / `sourceTimeOf` unimported, duplicate `BlobLoader`) → `npm run build` fails and PNG export throws.
- Preview can stay black when a source frame isn't decoded yet, when the project has no video track, or when a reloaded media blob is missing; nothing repaints.
- Preview audio graph is only rebuilt on play/pause, not on seek while paused.
- Playhead clamping *is* implemented in `setPlayhead`; timeline clip drags can still run past project end.
- `engine/subtitles.ts` is fully written but imported by nothing.
- Keyframes work for 7 paths only; crop, text, speed and audio-effect params do not animate.
- The Quality badge counts all issues, not warnings; warnings are only visible inside the Quality tab.

---

## 4. The engine contract (how anything gets built)

1. **Rendering.** Replace the Canvas2D effect application with a WebGL2 pipeline behind the existing `renderFrame` signature. Canvas2D stays as the fallback. Each effect is a shader module in a chain; vignette, blur, chroma key, curves, LUT and transitions all become shader passes so preview and export are byte-identical.
2. **Export.** Build the real encoder on WebCodecs (`VideoEncoder` + `AudioEncoder`) with `mp4-muxer` / `webm-muxer` (already installed, never wired), and a MediaRecorder fallback. Export feeds the same `renderFrame` and `buildAudioGraph` through an exact-frame resolver.
3. **State.** Every new capability = new `Action` type in `engine/actions.ts` + a `ToolDef` in `tools/registry.ts`. Nothing reaches the document any other way.
4. **Keyframes.** Generalise to any numeric property path with a typed registry, so crop, text, mask, speed and effect params all animate.

---

## 5. Feature scope

Build in milestone order. Each milestone is complete only when it works in preview **and** export, is in Ctrl+K, is in the tool manifest, and is in the Feature checklist.

### M0 — Delivery foundation (must be first)
- Green build, working PNG export, black-preview fixes, seek-and-play audio, timeline clamping on drags.
- **WebCodecs video export**: MP4/H.264 baseline + WebM, 480p–4K, 24/30/60 fps, bitrate/quality control, audio muxed, range export, single frame, PNG sequence, audio-only WAV/MP3, GIF. H.265/VP9/AV1 only when the browser reports support (else labelled Partial).
- Background export queue with progress and completion notification.
- **WebGL2 shader pipeline** sharing one pass chain with Canvas2D fallback.
- **Feature checklist page** in Settings: every feature, status Working / Partial / Not possible in browser, plus the reason. Generated from one source of truth so it cannot drift.
- **Shared command registry**: Ctrl+K, Tools tab, MCP and AI all read one list. Search covers every tool, command, panel and setting.
- Fix the two Quality warnings `main` flow: show each warning's message inline with a one-click fix, and make the badge count warnings separately from errors.

### M1 — Editing core
- Multi-track timeline, unlimited tracks, per-track height/colour/lock/mute/hide, markers with notes, ruler, grid, zoom-to-fit, safe margins and guides, magnetic mode, snapping options.
- Tools: select, razor, trim, ripple, roll, slip, slide, rate stretch, lift, extract, in/out, 3-point edit, pen, hand, zoom, type, track-select forward/backward.
- Linked audio/video, copy-paste attributes, gap closing, ripple delete, match frame, replace clip, subclips, bins with labels/search/metadata, relink missing media.
- Source + program monitors with insert/overwrite; J/K/L dynamic trimming; multi-sequence projects, nested/compound sequences, sequence settings and presets.
- Transform: position, scale, rotation, anchor, crop, flip, opacity, fit/fill, blend modes.
- Keyframes on everything, graph editor (linear/ease/bezier), copy-paste keyframes, motion blur, easy ease, motion-path editing, safe expressions field (wiggle/loop/time/linear/ease), parenting/null objects.
- Speed: constant, ramp curve with presets (montage, hero, bullet, jump cut), freeze, reverse, frame-blended slow motion (optical flow = Partial), time remap, speed/duration dialog, scene-edit detection, remix-to-length.
- Masks: linear, mirror, circle, rectangle, star, heart, pen/bezier, feather, invert, expansion, mask keyframes; track matte alpha/luma; adjustment layers.
- Canvas background: blur, solid, gradient, image.

### M2 — Text, titles, captions
- Text clips and text tracks, drag/resize/rotate on canvas.
- Styling: Google Fonts + user font upload, size, bold, italic, underline, colour, gradient fill, stroke, shadow, glow, background box, highlight, letter spacing, line height, alignment, uppercase; curved text and text on path.
- Animations in/out/loop: fade, pop, typewriter, slide, bounce, zoom, blur-in, glitch, wave, shake, karaoke; kinetic typography presets; text animators per character/word/line.
- Templates: titles, lower thirds, quote cards, intros, call-outs, countdowns, callout arrows, responsive graphics with editable parameters.
- Shapes, arrows, speech bubbles, stickers, emoji, animated stickers/GIF/WebP/Lottie, PNG/GIF upload, pen annotation.
- Captions: Whisper auto-captions in a worker, manual editor, transcript panel with search/speaker labels, SRT/VTT/ASS import-export, bilingual, word-by-word highlight, TikTok/Hormozi/clean/karaoke presets, burn-in or sidecar, translate, lyric timing tool.
- TTS via SpeechSynthesis plus optional API key, creating an audio clip.

### M3 — Colour
- Primary: exposure, brightness, contrast, highlights, shadows, whites, blacks, saturation, vibrance, temperature, tint, hue, sharpen, clarity, fade, grain, vignette — each with reset.
- White-balance eyedropper, auto tone, auto colour.
- Wheels (shadows/mid/highlights), RGB + luma curves, HSL qualifier secondary, split toning, hue-vs-hue/sat/lum curves.
- Filter library ≥30 presets with intensity slider; LUT `.cube` import with intensity; colour match between clips; still gallery save/apply.
- Scopes: histogram, waveform, parade, vectorscope, false colour, zebra.
- Node-based grading: serial, parallel and layer nodes with keyframes, power windows with tracking; colour-warper = Partial; Rec.709/sRGB/log handling.

### M4 — Effects, transitions, motion graphics
- ≥40 video effects: gaussian/radial/motion/tilt-shift blur, glitch, RGB split, VHS, film grain, shake, zoom burst, mirror, kaleidoscope, pixelate, mosaic, fisheye, bulge, wave/ripple, light leaks, lens flare, glow, bloom, bokeh, snow, rain, sparkle, fire, smoke, scanlines, CRT, old film, vignette, edge detect, sketch, posterize, duotone, chromatic aberration, camera shake, strobe, flash.
- ≥30 transitions with duration and easing, apply-to-all: fade, dissolve, dip to black/white, slide, push, wipe, zoom, spin, whip pan, glitch, flash, blur, luma wipe, cube, page curl, ripple, shape wipes.
- In/out/combo clip animations: zoom, slide, spin, bounce, shake, swing, fade.
- Generators: particles with emitters/gravity/colour-over-life, shapes, gradients, solids, countdowns, progress bars, audio visualiser; blend-mode overlays with user upload.
- Shape layers with fill, stroke, trim paths, repeater, round corners, path animation; simple 3D layers with Three.js camera and lights (Partial if heavy); rotoscope brush and puppet pin (Partial).
- Compositor: merge/transform/blur/glow/keyer/mask/paint/text/generators as wired nodes (Partial); Lottie in/out for simple animations; preset library of lower thirds, call-outs, logo reveals, counters.
- Chroma key with similarity, smoothness, spill suppression, edge feather/refine; person cutout via in-browser segmentation; background replace (image/video/blur/colour).
- Tracking: point, face, planar (Partial) with attach-to-text/sticker; stabilisation; auto reframe for 9:16, 1:1, 16:9; PiP, split screen, collage grids; freeze/loop/boomerang/echo trails/duplicate-with-offset.

### M5 — Audio
- Per-clip volume, fades, pan, keyframes; per-track mixer with meters, solo/mute; buses, sends, submixes, automation lanes, record-arm track.
- LUFS metering and normalise to platform targets (YouTube −14, podcast −16, broadcast −23).
- Cleanup: noise reduction with noise print, voice enhance, de-click, de-clip, de-ess, de-reverb (Partial), dynamics, gate/expander, parametric + graphic EQ, multiband compressor, limiter.
- Creative: reverb, delay, chorus, flanger, phaser, distortion, pitch shift, pitch correction (Partial), voice effects (robot, chipmunk, deep, telephone, radio), speed with/without pitch.
- Auto ducking, beat detection with markers and cut-on-beat, waveform auto-sync, batch normalise, extract/detach audio, waveform + spectral view with selection repair.
- Voiceover and webcam recording straight to timeline; teleprompter; sound-effects browser with tags/search; vocal-stem separation only if a model truly runs in-browser, otherwise Not possible.

### M6 — AI (all through the same engine actions)
- Auto captions, silence removal, filler removal, retake removal, smart cutdown with hook score, auto reframe, beat sync, highlights, B-roll slots, script-to-storyboard from the user's own media, caption translation, dubbing (lip-sync = Partial).
- AI chat/edit panel that calls the tool manifest; optional image generation and upscale/denoise via the user's key (Partial).
- Every AI action shows a preview first, runs the same actions as the manual tool, and lands as one undo step. No-key path keeps every tool usable.

### M7 — Assets, brand, capture, delivery
- Asset library: free-licensed music, SFX, backgrounds, overlays, stickers, LUTs (clearly licensed only) plus local import with tags/search.
- Font manager, palette manager, brand kit (logo, colours, fonts, intro/outro) applied in one click; watermark, end screens, intro/outro templates.
- Batch: apply preset to many clips, batch export, batch caption.
- Recorders: screen (getDisplayMedia) with webcam bubble/click highlights, webcam, voiceover.
- Utilities: compressor/converter, trim without re-encode, video→GIF/WebP, image sequence→video, frame extraction, metadata and media report, missing-media warnings.
- Project interchange: export/import `.falconcut` (JSON + media refs), template save, 15 built-in templates (intro, vlog, product, reel, slideshow, quote, countdown, tutorial, podcast clip, before/after), versions, autosave, backup/restore.
- Export presets per platform (TikTok, Reels, Shorts, YouTube, X, LinkedIn), cover-thumbnail picker, safe zones per platform.
- Workspaces (Editing, Color, Audio, Effects, Captions), full shortcut remapping with Premiere/CapCut/DaVinci presets.
- Image editor for stills: crop/rotate/resize, curves/levels/HSL, sharpen/blur/noise, layers with blend modes, masks, shadow/stroke/glow/gradient overlay, marquee/ellipse/lasso/magic wand/subject select, refine edge, clone/heal (Partial), content-aware fill (Not possible), thumbnail maker with text templates.

---

## 6. Status wording (use these exact values)

- **Working** — does the full job in preview and export.
- **Partial** — works with a real, stated limitation (say what is reduced and why).
- **Not possible in browser** — needs a server, native codec or model that cannot run locally (say why).

Never mark something Working because a button exists. The checklist is a claim about behaviour, and it is checked against the tests.

---

## 7. Definition of done per milestone

1. All new actions and tools are registered; each has a description and an example.
2. Each appears in Ctrl+K and the Tools panel.
3. Each is exercised in preview and in an exported file.
4. Tests added: engine determinism, action round-trip, tool → action mapping, lint coverage.
5. `npm run build` green, `npm test` green, browser QA script passes.
6. Feature checklist updated with honest statuses.
7. Report what works, what is Partial and why, before starting the next milestone.
