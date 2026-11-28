# FalconCut features (detail)

The in-app **What works** board (`src/features/checklist.ts`) is the live source of truth. This page is a readable copy of the major working areas.

## Editing core
- Multi-track timeline: video, audio and text tracks; drag clips between tracks, auto-create tracks past the first/last edge, Lock / Mute / Solo / Hide, reorder tracks, split, trim, ripple delete, group/ungroup, snapping and keyboard nudging.
- Edit modes: Snap (nearest free gap), Overwrite (replace under the clip) and Insert (ripple later clips). Lift / Extract the marked I/O zone from the toolbar or command palette.
- Linked AV import: short videos with sound become a grouped video clip (muted) plus an audio clip on an audio track. Long files keep native element audio to avoid gigabytes of PCM.
- Keyframes: transform X/Y, scale, rotation, opacity, skew, volume and effect parameters, with editable time/value/easing in the Inspector Animation tab and draggable diamonds on the timeline.

## Visual tools
- Region crop (non-destructive), shape masks (rect/ellipse/polygon) with feather and invert, chroma key with colour pick, similarity, softness and spill reduction.
- Adjustment layers applied to the composited frame; LUT import; speed ramps with a curve editor; 15 blend modes and 21 transitions with duration and intensity.
- On-canvas overlay move/resize/rotate, layer boundary outlines, Bring forward / Send backward, opacity, fit modes and blend modes.
- Auto reframe to 16:9 / 9:16 / 1:1 / 4:5 with editable face-follow keyframes (X and Y) when analysis data exists.

## Audio
- Per-clip audio-stream selection for MP4/MOV/M4A; extract one stream or all streams to WAV clips.
- Waveform from a 100 Hz sample-peak envelope after analysis; mixer with real track gain, meters, mute/solo.
- Fades, volume keyframes, EQ, gain, gate, de-ess, denoise, compressor, limiter, echo, pan and LUFS analysis.
- Streaming WAV export in 120 s chunks — no 5-minute limit and no full PCM buffer in memory.

## Captions and text
- Manual Caption Studio with split/merge/distribute, find & replace, SRT/VTT/ASS import/export and styling.
- On-demand local Whisper transcription (model install is explicit); AI caption panel with media selection and word-level timing.
- Styled text/title clips with presets, effects and fade transitions burned into preview and export.

## Automation and agents
- 56 registered tools with human labels, groups, aliases and prerequisites exposed to the in-app assistant, in-page API and MCP bridge.
- `ui_action` lets an agent drive visible editor commands by their human labels. Single calls auto-run; multi-call edits become a reviewable plan. AI is optional — all buttons work without a key via local rules.
- 30 ready templates with one-click apply and "Save selection as template" (editing recipes only, no media embedded).

## Project portability
- Local autosave, named version snapshots, crash recovery JSON, project JSON export/import and one-file project bundles with embedded media (sources over 50 MB are skipped with a notice).

## Export
- MP4 (H.264/AAC) with WebCodecs when available, WebM fallback, PNG frame, animated GIF, SRT and streamed WAV.
- Output up to 3840×2160 via custom resolution / upscale; export preflight reports codec, dimension, storage and real-time cost before rendering starts.
