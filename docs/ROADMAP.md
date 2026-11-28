# Roadmap

Order is based on editing impact and implementation risk. Each item ships only when it has real tests and a browser QA pass.

1. **Streaming MP4 export** — chunked encode/mux with real progress, cancellation and resume state. Current WAV export is already streamed.
2. **WASM H.264 fallback** — MP4 on browsers without WebCodecs H.264, without degrading output quality.
3. **Proxy editing** — opt-in low-resolution preview sources, originals always used for export.
4. **Generic motion tracking** — current point tracking is single-point NCC on a small patch; multipoint, scale/rotation and re-acquisition are next.
5. **Video background removal** — local model matting for moving subjects; still-image removal already exists.
6. **Nested sequences / compound clips** — reusable sub-timelines as editable clips.
7. **Hosted demo and browser-matrix CI** — Chrome/Edge/Firefox/Safari smoke tests.
