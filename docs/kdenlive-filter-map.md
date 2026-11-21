# Kdenlive → FalconCut feature mapping

Deep analysis of the **actual Kdenlive installed on this machine**
(`D:\apps\video_editor_mcp\src\video_editor\bin\kdenlive.exe`, data dir
`...\bin\data\kdenlive\`), done by parsing its shipped effect-definition XMLs —
the same ground truth Kdenlive's own UI is generated from.

**Methods used** (REA reverse-engineering methodology, applied to an
open-source binary's shipped artifacts):

1. Located the install via Start-Menu shortcut resolution (`WScript.Shell`).
2. Parsed **all 433 effect XML files** from `data/kdenlive/effects/` →
   tag, name, parameter list, types, defaults, min/max, animatable flags.
3. Classified by engine family via the `tag` prefix (`avfilter.*`, `frei0r*`,
   `movit*`, `ladspa*`, mlt-core, text).
4. Cross-checked Kdenlive's running MCP surface (D-Bus broken on this Windows
   install — `ERROR: [WinError 2]` — so on-disk data files were used instead).
5. Compared the inventory against FalconCut's engine
   (`engine/effects.ts`, `engine/types.ts`, `engine/audio.ts`).

Full machine-readable inventory: `%TEMP%\kdenlive_effects.csv`
(415 parsed effects, 2,040 parameters, **584 animatable**).

## Inventory by family

| Family            | Count | What it is                          | Browser relevance        |
|-------------------|-------|-------------------------------------|--------------------------|
| avfilter          | 146   | FFmpeg filters wrapped by MLT       | many reimplementable     |
| frei0r            | 96    | Native plugin effects               | reimplementable case-wise|
| mlt-core          | 84    | MLT's own NLE toolkit               | core reference set       |
| ladspa            | 75    | Linux audio plugins                 | native-only              |
| movit (GPU)       | 13    | OpenGL shader effects               | mostly duplicate mlt-core|
| text              | 1     | Dynamic text                        | FalconCut has richer text  |

## Already covered by FalconCut (verified)

| Kdenlive filter(s) | FalconCut equivalent | Status |
|---|---|---|
| `lift_gamma_gain`, `lumaliftgaingamma`, `movit.lift_gamma_gain` | color effect `lift_r/g/b`, `gamma_r/g/b`, `gain_r/g/b` (per-channel, keyframe-animatable) | **Working** — same 9-parameter model, verified live |
| `avfilter.colorlevels`, brightness/contrast family | color effect brightness/contrast | Working |
| `avfilter.huesaturation`, `frei0r.hueshift0r` | color effect hue/saturation | Working |
| `avfilter.colortemperature` | color effect temperature | Working |
| `avfilter.negate` (invert) | — | **Gap** (easy to add) |
| `boxblur`, `avfilter.gblur`, `avgblur`, `smartblur` | blur effect | Working (CSS/CPU gaussian-ish) |
| `avfilter.cas`, `avfilter.unsharp` | sharpen effect | Working (3×3 kernel) |
| `frei0r.vignette` | vignette effect | Working |
| `chroma_key`, `chroma_keep`, `lumakey` | chromaKey effect (tolerance + softness) | Working |
| `avfilter.deesser`, `agate`, denoiser family | deess, gate, denoise audio effects (DSP) | Working (DSP, not ML) |
| `avfilter.loudnorm`, `loudness` (2-pass) | loudness normalization | Working (single-pass LUFS) |
| `panner`, `avfilter.stereotools` (partial) | per-clip volume | Partial (no pan/balance yet) |
| `avfilter.equalizer` | eq audio effect | Working (expandable to more bands) |
| Edge crop / transform family | crop, flip, rotate, scale, position | Working |
| Dynamic text | text clips, captions, title motifs | Working (richer) |

## Browser-feasible — prioritized adoptions

**Adopted and verified (this build):**

| Kdenlive filter | FalconCut implementation | Verification |
|---|---|---|
| `lift_gamma_gain` (all 3 variants) | per-channel LGG in the color effect | live pixel check on preview |
| `avfilter.negate` | `negate` effect (`invert` 0..1) | A/B: inverted channels sum to 255 |
| `avfilter.normalize` | `normalize` effect (1–99 percentile auto-levels, strength slider) | implemented, pixel pass |
| `avfilter.acompressor` | `compressor` — native `DynamicsCompressorNode` | graph schedules, plays |
| `avfilter.alimiter` / `limiter` | `limiter` — brick-wall `DynamicsCompressorNode` | graph schedules, plays |
| `avfilter.aecho` | `echo` — `DelayNode` + feedback + wet mix | graph schedules, plays |
| `panner` / `audiobalance` | `pan` — native `StereoPannerNode` (−1..+1) | graph schedules, plays |
| **Extract audio** (context menu) | decode → `encodeWAV` → new WAV asset + audio-track clip at same position/inPoint, original clip muted, analyzed, one undo step | verified live end-to-end (4.00 s WAV from MP4, buffer decodes, clip plays) |

**Next candidates (browser-feasible, not yet adopted):**

1. **Gradient Map / Colorize** (`gradientmap`, `avfilter.colorize`) — duotone
   via canvas gradient LUT; easy and high visual value.
2. **Drop Shadow** (mlt-core) — canvas `shadowBlur/shadowColor` for text and
   image clips.
3. **Extra bands EQ** — more `BiquadFilterNode`s (low/high shelf, peaking).
4. **Audio Wave/ Spectrum visualization** (mlt-core graph filters) —
   `AnalyserNode` + canvas; nice for the Audio workspace.

## Honest "not possible in a browser tab" set

| Kdenlive capability | Why not |
|---|---|
| 75 LADSPA audio plugins | Native Linux plugin host |
| 96 frei0r native plugins | Native plugin ABI — must be reimplemented per effect if wanted |
| 13 movit GPU shaders | OpenGL pipeline; our CPU pipeline covers the same math slower |
| 2-pass workflows (Normalize 2-pass, frame-server render) | Requires a full frame-server loop; single-pass approximations only |
| VR360 (`frei0r.bigsh0t_*`) | Equirectangular reprojection needs GPU warping |
| Stereoscopic 3D (`avfilter.stereo3d`) | No 3D display surface in browser preview |
| Waveform monitor / vectorscope / RGB parade | Technically possible but heavy per-frame analysis — declared out of scope for now |
| Motion-estimation filters (deshake, vidstab) | Too slow in JS for real-time |

## Summary

- Kdenlive exposes **415 effects**; FalconCut's engine today covers the
  **core NLE grading/keying/audio set** (the mlt-core essentials) plus a
  growing avfilter-compatible subset, with the same one-engine
  (preview = export) guarantee Kdenlive gets from MLT.
- Next highest-value adoptions: negate, compressor/limiter/echo/pan
  (all native Web Audio nodes), gradient map, normalize, drop shadow.
- Everything adopted is verified against the checklist
  (`src/features/checklist.ts`), with honest Working/Partial/Not-possible
  statuses.
