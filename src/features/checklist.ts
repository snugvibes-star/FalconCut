/**
 * Engineering status board for CutFlow capabilities — what the browser
 * build can actually do today. Grounded in tools/registry.ts (21 AI tools),
 * engine/effects.ts, engine/types.ts, engine/captions.ts, engine/generators.ts,
 * engine/motifs.ts, analysis/whisper.worker.ts and exporter/*. Keep honest.
 */

export type FeatureStatus = 'working' | 'partial' | 'not-possible';

export interface FeatureItem {
  id: string;
  group: string;
  label: string;
  status: FeatureStatus;
  note?: string;
}

export const FEATURE_CHECKLIST: FeatureItem[] = [
  // ── Editing core ───────────────────────────────────────────────────────────
  { id: 'multi-track-timeline', group: 'Editing core', label: 'Multi-track timeline (video + audio tracks)', status: 'working' },
  { id: 'split-trim', group: 'Editing core', label: 'Split, trim, ripple delete', status: 'working' },
  { id: 'drag-reorder', group: 'Editing core', label: 'Drag clips between tracks and reorder', status: 'working' },
  { id: 'markers', group: 'Editing core', label: 'Timeline markers', status: 'working' },
  { id: 'snapping', group: 'Editing core', label: 'Snapping to clip edges / playhead', status: 'working' },
  { id: 'undo-redo', group: 'Editing core', label: 'Undo / redo history', status: 'working' },
  { id: 'autosave', group: 'Editing core', label: 'Autosave project to browser storage', status: 'working' },
  { id: 'keyboard-shortcuts', group: 'Editing core', label: 'Keyboard shortcuts (space, J/K/L, split, delete, undo)', status: 'working' },
  { id: 'premiere-edit-keys', group: 'Editing core', label: 'Premiere-style edit keys: V select, C razor, Z lift, Shift+X extract, Ctrl+K add-edit-all, Ctrl+/ palette, I/O zone, Ctrl+Space play zone, Alt+Space loop zone, Shift+M marker loop', status: 'working', note: 'verified live: Ctrl+K split all clips at playhead; zone keys set/stop/loop through the store playback zone' },
  { id: 'zone-loop', group: 'Editing core', label: 'Playback zone (I/O in-out points): Space stops at zone out, Ctrl+Space plays the zone, Alt+Space loops it, marker-based loop button, Esc clears', status: 'working', note: 'zone rendered on the timeline ruler with loop badge; audio graph rebuilds on loop restart so picture+sound stay in step' },
  { id: 'preview-direct-manipulation', group: 'Editing core', label: 'Direct manipulation on the preview: click-select overlays, drag-move, corner-handle resize, rotate handle, inline text edit, center snap guides', status: 'working', note: 'verified live: drag 40 display px → 290 project px in one undo step; preview selection ↔ timeline selection synced both ways via one store field' },
  { id: 'preview-draw-tools', group: 'Editing core', label: 'Draw on the preview (12 tools: brush, pen, highlighter, eraser, line, arrow, rect, rounded rect, ellipse, polygon, sticker) as independent editable overlay layers', status: 'working', note: 'strokes rasterize through the engine into drawing clips on the text track — never burned into the video; eraser is layer-local (destination-out); verified live with undo/redo' },
  { id: 'context-menu', group: 'Editing core', label: 'Right-click context menu on clips (split, duplicate, extract audio, mute, fades, labels, lock)', status: 'working' },
  { id: 'audio-in-edit', group: 'Editing core', label: 'Audio panel inside the Edit workspace (right panel Audio tab)', status: 'working' },
  { id: 'context-inspector', group: 'Editing core', label: 'Inspector tabs adapt to selected clip kind (video / audio / text)', status: 'working' },
  { id: 'audio-playback', group: 'Editing core', label: 'Audio plays during preview (buffers decode even when probe misses audio tracks)', status: 'working', note: 'playhead anchored to the AudioContext clock (no drift in background windows); audio graph rebuilds mid-playback on speed/volume/mute/undo edits; same asset used by two clips gets independent elements' },
  { id: 'extract-audio', group: 'Editing core', label: 'Extract audio from video (Kdenlive-style detach: new WAV asset + audio clip, original muted)', status: 'working', note: 'verified live; requires a decodable audio track (AC3 files must be converted first)' },
  { id: 'first-run-demo', group: 'Editing core', label: 'First-run demo timeline (one click: sample video + music + title in a single undo step)', status: 'working', note: 'button on the empty canvas state' },
  { id: 'keyboard-cheatsheet', group: 'Editing core', label: 'Keyboard cheatsheet inside the command palette', status: 'working' },
  { id: 'agent-api-validation', group: 'Editing core', label: 'External agent API validates actions before applying (window.cutflow.applyActions rejects invalid action groups)', status: 'working' },
  { id: 'responsive-layout', group: 'Editing core', label: 'Responsive layout (collapsible panels below 1024px, resizable widths)', status: 'partial', note: 'panels collapse to overlays, tool strips scroll internally, Color page stacks on narrow screens (preview no longer collapses at 360px); dense NLE is desktop-first' },

  // ── Transform & animation ──────────────────────────────────────────────────
  { id: 'keyframes', group: 'Transform & animation', label: 'Per-clip keyframes (position, scale, opacity, rotation, skew)', status: 'working' },
  { id: 'easing', group: 'Transform & animation', label: 'Keyframe easing (smooth interpolation)', status: 'working' },
  { id: 'animation-presets', group: 'Transform & animation', label: 'One-click animation presets (Ken Burns, slide/pop/bounce in, fly out, spin, pulse, shake, tilt) writing real editable keyframes', status: 'working', note: 'each preset is one undo step; keyframes remain fully editable' },
  { id: 'skew-2d', group: 'Transform & animation', label: 'Skew X/Y (true 2D affine shear, animatable)', status: 'working' },
  { id: 'crop-flip', group: 'Transform & animation', label: 'Crop, flip, rotate', status: 'working' },
  { id: 'text-on-path', group: 'Transform & animation', label: 'Curved text on path (arc / polyline)', status: 'working' },
  { id: 'bezier-path', group: 'Transform & animation', label: 'Cubic bezier text path', status: 'partial', note: 'arc and polyline only' },
  { id: 'motion-blur', group: 'Transform & animation', label: 'True motion blur on animated transforms', status: 'not-possible', note: 'no per-frame accumulation blur in browser pipeline' },
  { id: '3d-layers', group: 'Transform & animation', label: '3D layers / camera space', status: 'partial', note: 'true perspective (Z-axis) is affine-impossible in canvas 2D; skew provides real 2.5D shear, presets cover common camera moves' },
  { id: 'optical-flow', group: 'Transform & animation', label: 'Optical-flow frame blending', status: 'not-possible', note: 'no optical flow model in browser; nearest-frame playback' },
  { id: 'particle-emitters', group: 'Transform & animation', label: 'Particle emitters on clips', status: 'partial', note: 'generator backgrounds only, not clip emitters' },

  // ── Speed ──────────────────────────────────────────────────────────────────
  { id: 'speed-change', group: 'Speed', label: 'Clip speed change (0.25x–4x)', status: 'working' },
  { id: 'speed-ramp', group: 'Speed', label: 'Time remapping / speed ramps (piecewise speed points on the clip)', status: 'working', note: 'piecewise-linear speed curve integrated for exact source mapping; ramp-aware split/trim/ripple keep continuity (tested); audio under a ramp plays at the segment average speed — exact pitch-following audio remap is not possible in-browser' },
  { id: 'freeze-frame', group: 'Speed', label: 'Freeze frame — capture the exact frame at the playhead and insert it as a 2s still (Camera button in the preview transport)', status: 'working', note: 'full-resolution render through the same engine as export; imported through the normal media path so it persists in the project' },
  { id: 'reverse', group: 'Speed', label: 'Reverse clip (video + audio): preview scrubs frame-by-frame (browsers cannot play a video element backward) and audio plays a genuinely reversed buffer; preview and export match', status: 'working', note: 'works with speed ramps too; scrubbing means reversed sections play at a lower effective fps than forward clips' },

  // ── Text & titles ──────────────────────────────────────────────────────────
  { id: 'text-clips', group: 'Text & titles', label: 'Text clips (font, size, color, outline, position)', status: 'working' },
  { id: 'text-animation', group: 'Text & titles', label: 'Text animations (pop / fade / rise / typewriter)', status: 'working' },
  { id: 'hook-title', group: 'Text & titles', label: 'Animated hook title tool', status: 'working' },
  { id: 'motifs', group: 'Text & titles', label: 'Motion graphic motifs (title-reveal, lower-third, bar-chart, ring-progress, count-up, burst)', status: 'working' },
  { id: 'lottie', group: 'Text & titles', label: 'Lottie / After Effects animation import', status: 'not-possible', note: 'no .json Lottie renderer integrated' },
  { id: 'title-templates', group: 'Text & titles', label: 'Full title template library', status: 'partial', note: 'motifs + hook title only' },

  // ── Captions ───────────────────────────────────────────────────────────────
  { id: 'auto-captions', group: 'Captions', label: 'Auto captions (Whisper WASM transcription)', status: 'working' },
  { id: 'caption-styles', group: 'Captions', label: 'Caption styles (clean, karaoke, bold-keywords, word-pop)', status: 'working' },
  { id: 'caption-editing', group: 'Captions', label: 'Edit caption text and timing', status: 'working' },
  { id: 'caption-translate', group: 'Captions', label: 'Translate captions to another language', status: 'working', note: 'requires user AI key' },
  { id: 'captions-srt-export', group: 'Captions', label: 'Export .srt sidecar subtitles', status: 'working' },

  // ── Color ──────────────────────────────────────────────────────────────────
  { id: 'color-correction', group: 'Color', label: 'Basic color correction (brightness, contrast, saturation, temperature)', status: 'working' },
  { id: 'lift-gamma-gain', group: 'Color', label: 'Lift/gamma/gain grading — Kdenlive-compatible, per-channel R/G/B (Inspector master + Color workspace)', status: 'working' },
  { id: 'hue-shift', group: 'Color', label: 'Hue shift, sepia, grayscale (CSS filter + CPU fallback)', status: 'working' },
  { id: 'color-presets', group: 'Color', label: 'Color preset looks (natural, warm, cool, cinematic, b-w, vibrant)', status: 'working' },
  { id: 'color-wheels', group: 'Color', label: 'Color wheels / curves / HSL qualifier', status: 'partial', note: 'lift/gamma/gain done; bezier curves and HSL qualifier not yet' },
  { id: 'auto-color-normalize', group: 'Color', label: 'Auto color normalize (Kdenlive "Normalize RGB")', status: 'working', note: 'percentile auto-levels per frame, strength slider' },
  { id: 'negate', group: 'Color', label: 'Negate / invert (Kdenlive `avfilter.negate`)', status: 'working' },
  { id: 'lut-import', group: 'Color', label: 'LUT import (.cube): Adobe 3D cube LUTs (17³/33³/65³…), stored inside the project, applied per clip with strength slider — same render path for preview and export', status: 'working', note: 'baked to a 64-level direct lookup (6 bits/channel — smooth LUTs show no visible banding); 1D LUTs are rejected with an honest error' },
  { id: 'scopes', group: 'Color', label: 'Video scopes (waveform, vectorscope, histogram)', status: 'working', note: 'live from the graded preview canvas in the Color workspace' },

  // ── Effects & transitions ──────────────────────────────────────────────────
  { id: 'blur-sharpen', group: 'Effects & transitions', label: 'Blur and sharpen effects', status: 'working' },
  { id: 'vignette', group: 'Effects & transitions', label: 'Vignette', status: 'working' },
  { id: 'transitions', group: 'Effects & transitions', label: 'Transitions (crossfade, dip-black, dip-white, wipe-left, slide-left, zoom-in)', status: 'working' },
  { id: 'blend-modes', group: 'Effects & transitions', label: 'Blend modes on clips (screen, multiply, overlay, add, soft-light, … via canvas compositing) — preview and export identical', status: 'working', note: 'same engine renders preview and export frames, so blend modes exported exactly as previewed' },
  { id: 'blend-transitions', group: 'Effects & transitions', label: '15 blend-style transitions (dodge, burn, dissolve-family, luminosity, …)', status: 'working', note: 'built on the blend-mode engine, one transition table' },
  { id: 'generators', group: 'Effects & transitions', label: 'Generators (solid, gradient, particles, waves)', status: 'working' },
  { id: 'audio-fades', group: 'Effects & transitions', label: 'Audio fades', status: 'working' },
  { id: 'audio-dynamics', group: 'Effects & transitions', label: 'Compressor, limiter, echo, pan/balance (native Web Audio nodes, preview + export)', status: 'working' },
  { id: 'glitch-styles', group: 'Effects & transitions', label: 'Stylized effect packs (glitch, film grain, light leaks)', status: 'not-possible', note: 'only blur/sharpen/vignette/grade implemented' },

  // ── Masks & keying ─────────────────────────────────────────────────────────
  { id: 'chroma-key', group: 'Masks & keying', label: 'Chroma key (green screen)', status: 'working' },
  { id: 'shape-masks', group: 'Masks & keying', label: 'Shape masks on clips', status: 'not-possible', note: 'not implemented' },
  { id: 'rotoscope', group: 'Masks & keying', label: 'Rotoscoping / puppet pin', status: 'not-possible', note: 'too slow for real-time browser perf' },
  { id: 'fusion-nodes', group: 'Masks & keying', label: 'Node-based compositor', status: 'not-possible', note: 'out of scope for browser app' },

  // ── AI vision ──────────────────────────────────────────────────────────────
  { id: 'face-analysis', group: 'AI vision', label: 'Face detection for reframe / zoom framing', status: 'working' },
  { id: 'object-tracking', group: 'AI vision', label: 'Multipoint object tracking / stabilization / auto-reframe', status: 'partial', note: 'face positions only, no point/object tracking' },
  { id: 'scene-detect', group: 'AI vision', label: 'Shot / scene change detection', status: 'working' },
  { id: 'beat-detect', group: 'AI vision', label: 'Music beat detection and beat snapping', status: 'working' },

  // ── Audio ──────────────────────────────────────────────────────────────────
  { id: 'audio-levels', group: 'Audio', label: 'Per-clip volume, mute, level meters', status: 'working' },
  { id: 'loudness-normalize', group: 'Audio', label: 'Loudness normalization (LUFS target) and clipping guard', status: 'working' },
  { id: 'audio-cleanup', group: 'Audio', label: 'Noise reduction, de-ess, high-pass (browser DSP)', status: 'working', note: 'DSP, not ML voice isolation' },
  { id: 'audio-codec-fallback', group: 'Audio', label: 'Undecodable-codec audio (AC3/E-AC3 in MP4) still plays in preview', status: 'partial', note: 'verified: element-audio fallback (approximate volume); WebAudio effects and WAV export cannot include it — the browser cannot decode AC3' },
  { id: 'music-ducking', group: 'Audio', label: 'Auto music ducking under speech', status: 'working' },
  { id: 'voiceover', group: 'Audio', label: 'In-app voiceover recording (Audio tab): captures the mic with MediaRecorder while the timeline plays, imports the take and drops it at the playhead on a Voiceover track', status: 'working', note: 'one undo step; honest errors when the mic is denied/missing; use headphones so the mic only hears you' },
  { id: 'tts', group: 'Audio', label: 'Text-to-speech voiceover generation', status: 'partial', note: 'needs user API key; not possible purely in-browser' },
  { id: 'stem-separation', group: 'Audio', label: 'Music stem separation (vocals / drums / bass)', status: 'not-possible', note: 'no in-browser model' },

  // ── AI automation ──────────────────────────────────────────────────────────
  { id: 'auto-edit', group: 'AI automation', label: 'One-click auto edit pipeline (per video type)', status: 'working', note: 'with an AI model connected (Google Gemini or OpenAI-compatible) the pipeline is planned by the model; without a key the built-in rules pipeline runs on-device — both are one undo step' },
  { id: 'dead-air-cut', group: 'AI automation', label: 'Cut dead air / fillers / retakes', status: 'working' },
  { id: 'smart-cutdown', group: 'AI automation', label: 'Smart cutdown — short-clip candidates with hook scores', status: 'working' },
  { id: 'ab-variants', group: 'AI automation', label: 'A/B edit variants', status: 'working' },
  { id: 'auto-multicam', group: 'AI automation', label: 'Auto multicam cut on speaker turns', status: 'working' },
  { id: 'auto-broll', group: 'AI automation', label: 'Auto b-roll from own media library', status: 'working' },
  { id: 'broll-pexels', group: 'AI automation', label: 'B-roll from Pexels stock search', status: 'partial', note: 'needs user Pexels API key' },
  { id: 'auto-fix', group: 'AI automation', label: 'Quality checker + auto-fix passes', status: 'working' },

  // ── Photo tools ────────────────────────────────────────────────────────────
  { id: 'photo-import', group: 'Photo tools', label: 'Still image clips (Ken Burns / pan-zoom)', status: 'working' },
  { id: 'photo-crop', group: 'Photo tools', label: 'Image crop and transform in timeline', status: 'working' },
  { id: 'photo-retouch', group: 'Photo tools', label: 'Photo retouch (blemish / healing / upscale)', status: 'not-possible', note: 'no image-editing model in browser' },

  // ── Export & deliver ───────────────────────────────────────────────────────
  { id: 'export-mp4', group: 'Export & deliver', label: 'MP4 export (muxed H.264 + AAC)', status: 'working', note: 'WebCodecs offline encode (faster than real time, frame-accurate) when the browser exposes an H.264 encoder; otherwise falls back to WebM' },
  { id: 'export-webm', group: 'Export & deliver', label: 'WebM export (VP9/Opus video)', status: 'working', note: 'WebCodecs offline VP9/Opus, or real-time MediaRecorder capture as fallback. Quality / resolution / audio selectable; cancellable.' },
  { id: 'export-wav', group: 'Export & deliver', label: 'Audio-only WAV export', status: 'working' },
  { id: 'export-png', group: 'Export & deliver', label: 'Current frame PNG export', status: 'working' },
  { id: 'export-srt', group: 'Export & deliver', label: 'Sidecar subtitle export', status: 'working', note: 'plain text, not the styled caption render' },
  { id: 'export-gif', group: 'Export & deliver', label: 'Animated GIF export of the marked zone (I / O) or the whole video', status: 'working', note: 'rendered frame-by-frame through the same engine as the preview, 256-color quantization, 8/10/15 fps at 320–640px, bounded to 240 frames (longer sections stretch the frame step), cancellable' },
  { id: 'export-destinations', group: 'Export & deliver', label: 'Delivery targets (TikTok/Reels/Shorts 9:16, YouTube 16:9, Instagram 4:5, square 1:1) that reframe the project in one undo step so preview, timeline and file all match the platform', status: 'working', note: 'reframing is a real editable project change, not an export-only crop — switch back any time; live dimensions are shown above the format list' },
  { id: 'export-4k', group: 'Export & deliver', label: '4K export with hardware acceleration', status: 'partial', note: 'resolution available but browser encoders are software-speed' },
  { id: 'cloud-export', group: 'Export & deliver', label: 'Direct publish to YouTube / TikTok', status: 'not-possible', note: 'no OAuth upload integrations' },

  // ── Productivity ───────────────────────────────────────────────────────────
  { id: 'preview-playback', group: 'Productivity', label: 'Real-time preview playback with scrubbing', status: 'working' },
  { id: 'preview-customize', group: 'Productivity', label: 'Preview customization: fullscreen (Fullscreen API), zoom Fit/25/50/100/200%, theater mode (hide side panels, Esc exits)', status: 'working' },
  { id: 'hideable-draw-rail', group: 'Productivity', label: 'Fully hideable preview draw rail — when hidden nothing overlays the video; a small pen icon docked beside (not on) the video restores it', status: 'working', note: 'eye button on the rail hides it; state persists across reloads (cutflow.ui.prefs)' },
  { id: 'resizable-timeline', group: 'Productivity', label: 'Resizable bottom timeline editor — drag handle between preview and timeline plus Small / Medium / Large presets', status: 'working', note: 'pointer-capture drag, height persists across reloads (cutflow.ui.prefs)' },
  { id: 'ai-providers', group: 'Productivity', label: 'AI settings: an OpenAI-compatible protocol (any vendor — OpenAI, Groq, Together, Mistral, DeepSeek, Fireworks, Perplexity — plus local Ollama / LM Studio, which need no key) with one-tap vendor presets, OpenRouter and Google Gemini native; a shield Verify button beside the key field that says whether THIS key works with THIS endpoint, Fetch models (lists the models your key can actually use), real Test connection with inline result, an explicit connection-proxy status line, and a gear in the AI panel to reopen settings anytime', status: 'working', note: 'requests go direct first and are replayed through a same-origin local proxy (/__ai) when a provider blocks browser CORS — that is what makes api.openai.com work, with loopback-only binding and an allowlist of forwarded headers. The model FIELD always wins over a model baked into the endpoint URL; retired Gemini models auto-upgrade on load; requests retry without parameters a model rejects (max_tokens→max_completion_tokens, temperature, response_format, responseMimeType) so Test connection works across providers. Keys stay in localStorage' },
  { id: 'pwa', group: 'Productivity', label: 'PWA: installable on desktop and mobile (Android/Chrome, iOS 16.4+/Safari add-to-home), offline app shell via service worker, standalone display', status: 'working', note: 'media lives in IndexedDB, so an installed editor keeps editing offline; AI features need the network by nature' },
  { id: 'in-page-api', group: 'Productivity', label: 'In-page scripting API for agents', status: 'working' },
  { id: 'co-edit-lock', group: 'Productivity', label: 'Clip locking for human/AI co-editing', status: 'working' },
  { id: 'project-file', group: 'Productivity', label: 'Save / open project file', status: 'working' },
  { id: 'stock-media', group: 'Productivity', label: 'Stock media panel: search free stock and import into the project through the same path as local files', status: 'partial', note: 'Archive.org works keyless (search + metadata verified live); Pexels / Pixabay / Freesound need a free personal key stored locally. Some CDN downloads are blocked by CORS in some browsers — the panel shows an honest error with a manual-import fallback instead of faking success' },
  { id: 'brand-mark', group: 'Productivity', label: 'Brand mark (golden-eagle app icon) in the top bar, browser tab, iOS home screen, Android/desktop PWA install and the Windows .ico — one artwork, every format', status: 'working', note: 'generated from the designer SVG by scripts/make-icons.mjs into icon-192/512, maskable (safe-zone padded with the icon\'s own background), apple-touch 180, favicon 16/32/48 + multi-size .ico, and icon.svg; palette-quantised above 192px so the PWA install payload stays ~130 kB' },
];

export const GROUP_ORDER = [
  'Editing core', 'Transform & animation', 'Speed', 'Text & titles', 'Captions',
  'Color', 'Effects & transitions', 'Masks & keying', 'AI vision', 'Audio',
  'AI automation', 'Photo tools', 'Export & deliver', 'Productivity',
];

export function checklistSummary(): { working: number; partial: number; notPossible: number } {
  const counts = { working: 0, partial: 0, 'not-possible': 0 };
  for (const item of FEATURE_CHECKLIST) counts[item.status]++;
  return { working: counts.working, partial: counts.partial, notPossible: counts['not-possible'] };
}
