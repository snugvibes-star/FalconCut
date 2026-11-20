/**
 * The single app store. Humans (UI) and AI (tools/agents) both edit through
 * commit() → History.apply() → the SAME engine functions. Holds the project,
 * undo/redo, selection, playback, media pool, background analysis, lint,
 * versions, AI chat/plan, co-editing locks and autosave/recovery.
 */
import { create } from 'zustand';
import {
  History, MediaPool, createProject, diffProjects,
  projectDuration, uid, getMedia, applyActions, encodeWAV,
  type Project, type Action, type Clip, type MediaAsset, type Aspect, type ProjectDiff,
} from '../../engine';
import { runTool, type ToolResult } from '../../tools/registry';
import { lintProject, type LintReport } from '../../quality/lint';
import { getPack } from '../../styles/packs';
import { effectivePack } from '../../styles/rules';
import { analyzeMedia, mergeAnalysis, recomputeSilences, defaultAnalyzeOptions, taskQueue, type AnalyzeOptions } from '../../analysis/analyze';
import { makeAIFn, loadAISettings, saveAISettings, hasAI, type AISettings } from '../../ai/client';
import { type Plan, type PlanStep } from '../../ai/planner';
import { respond, undoIntent, type HistoryTurn } from '../../ai/agent';
import { saveProject, loadProject, listProjects, putBlob, getBlob, deleteBlob, garbageCollectBlobs } from './persistence';
import { useUI } from './ui';

export interface Version {
  id: string;
  name: string;
  at: number;
  project: Project;
  thumbnail?: string;
  score: number;
  source: 'manual' | 'ai' | 'auto';
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  at: number;
  plan?: Plan;
  diff?: ProjectDiff;
  /** A failure the user can retry — never a fake assistant reply. */
  error?: boolean;
  retry?: string;
}

export interface AgentSession {
  token: string;
  projectId: string;
  createdAt: number;
  connected: boolean;
  relayUrl: string;
  activity: { at: number; text: string }[];
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface QueueStatus {
  label: string;
  stage: string;
  pct: number;
  note?: string;
  pending: number;
}

interface State {
  project: Project;
  history: History;
  pool: MediaPool;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string;
  redoLabel: string;
  lint: LintReport;

  selection: string[];
  playhead: number;
  playing: boolean;
  frameTick: number;
  zoom: number; // pixels per second
  ready: boolean;
  /** Playback zone (in/out points on the timeline). While set, playback stops
   * at `out` (or loops back to `in` when loop=true). Set with I/O keys. */
  zone: { in: number; out: number; loop: boolean } | null;

  analyzeOptions: AnalyzeOptions;
  queue: QueueStatus | null;

  versions: Version[];
  chat: ChatMessage[];
  plan: Plan | null;
  planRunning: boolean;
  aiSettings: AISettings;
  aiBusy: boolean;

  locks: Record<string, number>;
  session: AgentSession | null;
  autopilot: boolean;
  saveStatus: SaveStatus;
  lastSaved: number | null;

  /* lifecycle */
  init: () => Promise<void>;
  newProject: (name?: string, aspect?: Aspect) => void;
  openProject: (id: string) => Promise<void>;

  /* editing — the ONE path for human + AI */
  commit: (actions: Action[], label: string, source?: 'human' | 'ai', coalesceKey?: string) => void;
  previewTool: (name: string, params?: Record<string, unknown>, source?: 'human' | 'ai') => Promise<ToolResult>;
  applyTool: (name: string, params?: Record<string, unknown>, source?: 'human' | 'ai') => Promise<ToolResult>;
  undo: () => void;
  redo: () => void;
  replaceProject: (project: Project, label: string) => void;

  /* media */
  importFiles: (files: File[], opts?: { addToTimeline?: boolean }) => Promise<{ imported: number; skipped: string[]; ids: string[] }>;
  loadDemoTimeline: () => Promise<void>;
  loadShowcaseDemo: () => Promise<void>;
  removeMedia: (mediaId: string) => void;
  /** Kdenlive-style "Extract audio": decode the video's audio into a new WAV
   * asset + audio-track clip at the same position, and mute the original.
   * Returns 'ok' | 'no-clip' | 'no-buffer' | 'undecodable'. */
  extractAudio: (clipId: string) => Promise<'ok' | 'no-clip' | 'no-buffer' | 'undecodable'>;

  /* analysis */
  setAnalyzeOptions: (patch: Partial<AnalyzeOptions>) => void;
  analyze: (mediaId: string) => void;
  analyzeAll: () => void;
  refreshSilences: () => void;

  /* playback + selection */
  setPlayhead: (t: number, opts?: { fromPlayback?: boolean }) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  select: (ids: string[], additive?: boolean) => void;
  setZoom: (z: number) => void;
  /** Set/clear the playback zone. in/out are clamped (out > in + 0.05). */
  setZone: (z: { in: number; out: number; loop?: boolean } | null) => void;

  /* versions */
  snapshot: (name: string, source?: Version['source'], thumbnail?: string) => Version;
  restoreVersion: (id: string) => void;
  deleteVersion: (id: string) => void;
  diffVersion: (id: string) => ProjectDiff | null;

  /* AI */
  setAISettings: (patch: Partial<AISettings>) => void;
  sendChat: (text: string) => Promise<void>;
  executePlan: (plan: Plan) => Promise<{ applied: number; diff: ProjectDiff; idle: string[]; failed: string[] }>;
  approvePlan: () => Promise<void>;
  rejectPlan: () => void;
  clearChat: () => void;

  /* co-editing */
  touch: (clipIds: string[]) => void;
  lockedIds: () => Set<string>;
  setAutopilot: (on: boolean) => void;

  /* agent session */
  createSession: (relayUrl: string) => AgentSession;
  revokeSession: () => void;
  setSessionConnected: (on: boolean) => void;
  logActivity: (text: string) => void;

  /* helpers */
  getAnalysis: () => Project['analysis'];
  duration: () => number;
}

const LOCK_MS = 10_000;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function packOf(p: Project) {
  return effectivePack(getPack(p), p.rules);
}

function relint(p: Project): LintReport {
  return lintProject(p, packOf(p));
}

export const useStore = create<State>()((set, get) => {
  const history = new History(createProject('Untitled project'));
  const pool = new MediaPool();
  let projectEpoch = 0;

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveStatus: 'saving' });
    saveTimer = setTimeout(async () => {
      try {
        await saveProject(get().project);
        set({ saveStatus: 'saved', lastSaved: Date.now() });
        // Reclaim storage from blobs no project references (failed imports,
        // removed media, deleted projects) so quota deaths stay rare.
        void garbageCollectBlobs().catch(() => {});
      } catch {
        set({ saveStatus: 'error' });
      }
    }, 800);
  };

  const afterChange = (p: Project, label: string) => {
    const dur = projectDuration(p);
    const cur = get();
    const playhead = Math.min(cur.playhead, dur);
    const stopAtEnd = cur.playing && playhead >= dur;
    set({
      project: p,
      playhead,
      playing: stopAtEnd ? false : cur.playing,
      canUndo: history.canUndo,
      canRedo: history.canRedo,
      undoLabel: history.undoLabel,
      redoLabel: history.redoLabel,
      lint: relint(p),
    });
    if (stopAtEnd) cur.pool.pauseAll();
    void label;
    scheduleSave();
  };

  // keep the media pool's frame/buffer readiness reactive
  pool.onFrameReady = () => set((s) => ({ frameTick: s.frameTick + 1 }));

  taskQueue.onUpdate = () => {
    const cur = taskQueue.current;
    set({
      queue: cur
        ? { label: cur.task.label, stage: cur.stage, pct: cur.pct, note: cur.note, pending: taskQueue.pending }
        : null,
    });
  };

  return {
    project: history.current,
    history,
    pool,
    canUndo: false,
    canRedo: false,
    undoLabel: '',
    redoLabel: '',
    lint: relint(history.current),

    selection: [],
    playhead: 0,
    playing: false,
    frameTick: 0,
    zoom: 80,
    ready: false,
    zone: null,

    analyzeOptions: { ...defaultAnalyzeOptions },
    queue: null,

    versions: [],
    chat: [],
    plan: null,
    planRunning: false,
    aiSettings: loadAISettings(),
    aiBusy: false,

    locks: {},
    session: null,
    autopilot: true,
    saveStatus: 'idle',
    lastSaved: null,

    async init() {
      try {
        const projects = await listProjects();
        const recent = projects[0];
        if (recent) {
          history.reset(recent);
          // re-register media blobs from IndexedDB
          for (const asset of recent.media) {
            if (asset.blobKey) {
              const blob = await getBlob(asset.blobKey);
              if (blob) await pool.register(asset, blob);
            } else if (asset.type === 'generator') {
              await pool.register(asset);
            }
          }
          set({ project: history.current, lint: relint(history.current), ready: true, canUndo: false, canRedo: false });
          return;
        }
      } catch { /* storage unavailable — start fresh */ }
      set({ ready: true });
    },

    newProject(name = 'Untitled project', aspect: Aspect = '16:9') {
      projectEpoch++;
      if (saveTimer) clearTimeout(saveTimer);
      if (get().ready) void saveProject(get().project).catch(() => set({ saveStatus: 'error' }));
      taskQueue.cancelAll();
      get().pool.dispose();
      const fresh = new MediaPool();
      fresh.onFrameReady = () => set((s) => ({ frameTick: s.frameTick + 1 }));
      history.reset(createProject(name, aspect));
      set({
        project: history.current, pool: fresh, selection: [], playhead: 0, playing: false,
        versions: [], chat: [], locks: {}, session: null, plan: null, aiBusy: false, planRunning: false,
        lint: relint(history.current), canUndo: false, canRedo: false, undoLabel: '', redoLabel: '',
      });
      scheduleSave();
    },

    async openProject(id: string) {
      const epoch = ++projectEpoch;
      get().pause();
      get().revokeSession();
      taskQueue.cancelAll();
      if (saveTimer) clearTimeout(saveTimer);
      await saveProject(get().project);
      const p = await loadProject(id);
      if (!p) throw new Error('Project not found on this device.');
      const fresh = new MediaPool();
      fresh.onFrameReady = () => set((s) => ({ frameTick: s.frameTick + 1 }));
      for (const asset of p.media) {
        if (asset.blobKey) {
          const blob = await getBlob(asset.blobKey);
          if (blob) await fresh.register(asset, blob);
        } else if (asset.type === 'generator') await fresh.register(asset);
      }
      if (epoch !== projectEpoch) { fresh.dispose(); return; }
      get().pool.dispose();
      history.reset(p);
      set({ project: p, pool: fresh, selection: [], playhead: 0, playing: false,
        versions: [], chat: [], locks: {}, session: null, plan: null, aiBusy: false, planRunning: false,
        lint: relint(p), canUndo: false, canRedo: false, undoLabel: '', redoLabel: '', saveStatus: 'saved' });
    },

    commit(actions, label, source = 'human', coalesceKey) {
      if (!actions.length) return;
      const before = get().project;
      const locks = source === 'ai' ? get().lockedIds() : new Set<string>();
      const protectedClips = before.clips.filter((c) => c.locked || locks.has(c.id) || before.tracks.find((t) => t.id === c.trackId)?.locked);
      const unlocking = source === 'human' && actions.every((a) => a.type === 'set_track' || (a.type === 'set_clip_props' && Object.keys(a.patch).every((k) => k === 'locked')));
      if (protectedClips.length && !unlocking) {
        const candidate = applyActions(before, actions);
        if (protectedClips.some((c) => JSON.stringify(c) !== JSON.stringify(candidate.clips.find((next) => next.id === c.id)))) {
          if (source === 'ai') throw new Error('Edit would modify a locked clip. Wait for the human lock to expire or change the edit.');
          useUI.getState().toast('That clip or track is locked. Unlock it to edit.', 'info');
          return;
        }
      }
      const p = history.apply(actions, label, coalesceKey);
      if (source === 'human') {
        const ids = actions.map((a) => ('clipId' in a ? (a as { clipId?: string }).clipId : undefined)).filter(Boolean) as string[];
        if (ids.length) get().touch(ids);
      }
      afterChange(p, label);
    },

    async previewTool(name, params = {}, source = 'human') {
      const locked = source === 'ai' ? get().lockedIds() : undefined;
      const ai = hasAI(get().aiSettings) ? makeAIFn(get().aiSettings) : undefined;
      return runTool(get().project, name, params, { locked, ai });
    },

    async applyTool(name, params = {}, source = 'human') {
      const before = get().project;
      const epoch = projectEpoch;
      const result = await get().previewTool(name, params, source);
      if (get().project !== before || epoch !== projectEpoch) throw new Error('Project changed while preparing the edit. Preview again.');
      if (result.actions.length) {
        if (source === 'ai') get().snapshot(`Before ${name}`, 'ai');
        get().commit(result.actions, `${name}`, source);
      }
      return result;
    },

    undo() {
      const r = history.undo();
      if (r) afterChange(r.project, `Undo ${r.label}`);
    },

    redo() {
      const r = history.redo();
      if (r) afterChange(r.project, `Redo ${r.label}`);
    },

    replaceProject(project, label) {
      const p = history.replace(project, label);
      afterChange(p, label);
    },

    async importFiles(files, opts = {}) {
      const addToTimeline = opts.addToTimeline ?? true;
      const p0 = get().project;
      const epoch = projectEpoch;
      const actions: Action[] = [];
      const skipped: string[] = [];
      const ids: string[] = [];
      let imported = 0;
      let cursor = projectDuration(p0);
      const videoTrack = p0.tracks.find((t) => t.kind === 'video')?.id;
      const audioTrack = p0.tracks.find((t) => t.kind === 'audio')?.id;
      for (const file of files) {
        try {
          const type = classifyFile(file);
          const id = uid('media');
          const blobKey = `media_${id}`;
          await putBlob(blobKey, file);
          const asset: MediaAsset = {
            id, name: file.name, type, duration: type === 'image' ? 5 : 0,
            width: 0, height: 0, hasAudio: type !== 'image', blobKey,
            mime: file.type, size: file.size, source: 'file',
          };
          // probe real duration/dimensions
          if (type === 'video' || type === 'audio') {
            const meta = await probeMedia(file, type);
            asset.duration = meta.duration; asset.width = meta.width; asset.height = meta.height;
            asset.hasAudio = type === 'audio' ? true : meta.hasAudio;
          } else if (type === 'image') {
            const bmp = await createImageBitmap(file);
            asset.width = bmp.width; asset.height = bmp.height; bmp.close();
          }
          if (epoch !== projectEpoch) throw new Error('Project changed during import.');
          await get().pool.register(asset, file);
          actions.push({ type: 'add_media', asset });
          if (addToTimeline) {
            const trackId = type === 'audio' ? audioTrack : videoTrack;
            if (trackId) {
              actions.push({ type: 'add_clip', clip: { trackId, mediaId: id, start: type === 'audio' ? 0 : cursor, duration: Math.max(0.5, asset.duration || 5), inPoint: 0 } });
              if (type !== 'audio') cursor += Math.max(0.5, asset.duration || 5);
            }
          }
          imported++;
          ids.push(id);
        } catch (err) {
          // One unreadable/corrupt file must not abort the whole import and
          // orphan every blob written before it — skip it and keep going.
          skipped.push(`${file.name}: ${err instanceof Error ? err.message : 'could not be imported'}`);
          if (projectEpoch !== epoch) throw err;
        }
      }
      if (get().project.id !== p0.id) throw new Error('Project changed during import. Import files again in the current project.');
      if (actions.length) {
        get().commit(actions, `Import ${imported} file${imported === 1 ? '' : 's'}`);
        for (const action of actions) if (action.type === 'add_media') get().analyze(action.asset.id);
      }
      return { imported, skipped, ids };
    },

    /** First-run demo: imports the bundled sample media and lays out a tiny
     * timeline (video + music + title) in a single undoable action, so a new
     * user can press Play and see the editor working within seconds. */
    async loadDemoTimeline() {
      const p = get().project;
      const videoAsset = p.media.find((m) => m.name === 'testvideo.mp4');
      const audioAsset = p.media.find((m) => m.name === 'tone.wav');
      const mediaIds: string[] = [];
      const load = async (name: string) => {
        const res = await fetch(`/${name}`);
        if (!res.ok) throw new Error(`Demo media missing: ${name}`);
        const blob = await res.blob();
        const file = new File([blob], name, { type: blob.type || 'application/octet-stream' });
        const id = uid('media');
        await putBlob(`media_${id}`, file);
        const type = name.endsWith('.mp4') ? 'video' : 'audio';
        const asset: MediaAsset = {
          id, name, type, duration: type === 'video' ? 4 : 5,
          width: type === 'video' ? 1920 : 0, height: type === 'video' ? 1080 : 0,
          hasAudio: type === 'audio', blobKey: `media_${id}`,
          mime: file.type, size: blob.size, source: 'file',
        };
        await get().pool.register(asset, file);
        get().commit([{ type: 'add_media', asset }], `Add demo ${name}`);
        return id;
      };
      if (!videoAsset) mediaIds.push(await load('testvideo.mp4'));
      else mediaIds.push(videoAsset.id);
      if (!audioAsset) mediaIds.push(await load('tone.wav'));
      else mediaIds.push(audioAsset.id);

      const videoTrack = p.tracks.find((t) => t.kind === 'video')?.id;
      const audioTrack = p.tracks.find((t) => t.kind === 'audio')?.id;
      const textTrack = p.tracks.find((t) => t.kind === 'text')?.id;
      const videoId = mediaIds[0];
      const audioId = mediaIds[1];
      const actions: Action[] = [];
      if (videoTrack && videoId) actions.push({ type: 'add_clip', clip: { trackId: videoTrack, mediaId: videoId, start: 0, duration: 4, inPoint: 0 } });
      if (audioTrack && audioId) actions.push({ type: 'add_clip', clip: { trackId: audioTrack, mediaId: audioId, start: 0, duration: 5, inPoint: 0 } });
      if (textTrack) actions.push({ type: 'add_text', trackId: textTrack, start: 0, duration: 4, text: 'CutFlow Demo', role: 'title', preset: 'word-pop', style: { fontSize: 0.1, y: 0.12 } });
      if (actions.length) get().commit(actions, 'Load demo timeline');
    },

    /** Feature-showcase demo built from the bundled real-footage sample
     * (public/sample-scarlet.mp4, 9:16 vertical with its own audio). Uses the
     * same public import/probe/commit path as a human drag-and-drop, so it
     * also exercises the real import pipeline. Falls back to the legacy
     * synthetic demo if the sample file is not served. */
    async loadShowcaseDemo() {
      const p = get().project;
      const res = await fetch('/sample-scarlet.mp4');
      if (!res.ok) { await get().loadDemoTimeline(); return; }
      const blob = await res.blob();
      const file = new File([blob], 'sample-scarlet.mp4', { type: 'video/mp4' });
      const id = uid('media');
      await putBlob(`media_${id}`, file);
      const meta = await probeMedia(file, 'video');
      const asset: MediaAsset = {
        id, name: 'sample-scarlet.mp4', type: 'video',
        duration: meta.duration, width: meta.width, height: meta.height,
        hasAudio: meta.hasAudio, blobKey: `media_${id}`,
        mime: 'video/mp4', size: file.size, source: 'file',
      };
      await get().pool.register(asset, file);
      get().commit([{ type: 'add_media', asset }], 'Add showcase sample');
      // The sample is vertical: match the canvas so it plays full-frame.
      get().commit([{ type: 'set_settings', patch: { aspect: '9:16', width: 1080, height: 1920, fps: 30 } }], 'Match sample format');

      const videoTrack = get().project.tracks.find((t) => t.kind === 'video')?.id;
      const textTrack = get().project.tracks.find((t) => t.kind === 'text')?.id;
      const actions: Action[] = [];
      if (videoTrack) {
        // One clip per showcase section, each demonstrating a different tool:
        // 1) straight cut · 2) reverse · 3) 1.5x speed · 4) outro.
        actions.push({ type: 'add_clip', clip: { trackId: videoTrack, mediaId: id, start: 0, duration: 5, inPoint: 0 } });
        actions.push({ type: 'add_clip', clip: { trackId: videoTrack, mediaId: id, start: 5, duration: 3, inPoint: 24, reversed: true } });
        actions.push({ type: 'add_clip', clip: { trackId: videoTrack, mediaId: id, start: 8, duration: 3, inPoint: 13, speed: 1.5 } });
        actions.push({ type: 'add_clip', clip: { trackId: videoTrack, mediaId: id, start: 11, duration: 2.5, inPoint: 18 } });
      }
      if (textTrack) {
        actions.push({ type: 'add_text', trackId: textTrack, start: 0.3, duration: 2.2, text: 'SCARLET WITCH', role: 'title', preset: 'word-pop', style: { fontSize: 0.07, y: 0.12 } });
        actions.push({ type: 'add_text', trackId: textTrack, start: 11.2, duration: 2.2, text: 'edited in CutFlow — every cut is one undo step', role: 'caption', preset: 'word-pop', style: { fontSize: 0.035, y: 0.86 } });
      }
      if (actions.length) get().commit(actions, 'Load showcase timeline');
    },

    removeMedia(mediaId) {
      // Keep the source available for undo and version restore.
      get().commit([{ type: 'remove_media', mediaId }], 'Remove media');
    },

    async extractAudio(clipId) {
      const s = get();
      const clip = s.project.clips.find((c) => c.id === clipId);
      const asset = clip ? getMedia(s.project, clip.mediaId) : undefined;
      if (!clip || !asset) return 'no-clip';
      const buffer = clip.mediaId ? s.pool.getBuffer(clip.mediaId) : undefined;
      if (!buffer) {
        return s.pool.decodeFailedFor(asset.id) ? 'undecodable' : 'no-buffer';
      }
      const wav = encodeWAV(buffer);
      const id = uid('media');
      const blobKey = `media_${id}`;
      await putBlob(blobKey, wav);
      const newAsset: MediaAsset = {
        id,
        name: `${asset.name.replace(/\.[^.]+$/, '')} (audio).wav`,
        type: 'audio',
        duration: buffer.duration,
        width: 0, height: 0,
        hasAudio: true,
        blobKey,
        mime: 'audio/wav',
        size: wav.size,
        source: 'reference',
      };
      await s.pool.register(newAsset, wav);
      const audioTrack = get().project.tracks.find((t) => t.kind === 'audio');
      const actions: Action[] = [{ type: 'add_media', asset: newAsset }];
      if (audioTrack) {
        actions.push({
          type: 'add_clip',
          clip: {
            trackId: audioTrack.id, mediaId: id,
            start: clip.start, duration: clip.duration,
            inPoint: Math.max(0, Math.min(clip.inPoint, buffer.duration - 0.05)),
            volume: 1,
          },
        });
        // Mute the original clip's audio so the sound is not doubled — the
        // extracted audio clip now carries it (same position, same inPoint).
        actions.push({ type: 'set_clip_props', clipId: clip.id, patch: { volume: 0 } });
      }
      get().commit(actions, `Extract audio from ${asset.name}`);
      get().analyze(id);
      return 'ok';
    },

    setAnalyzeOptions(patch) {
      set({ analyzeOptions: { ...get().analyzeOptions, ...patch } });
    },

    analyze(mediaId) {
      const asset = getMedia(get().project, mediaId);
      if (!asset) return;
      const opts = get().analyzeOptions;
      const epoch = projectEpoch;
      taskQueue.push({
        id: uid('task'),
        label: `Analyze ${asset.name}`,
        run: async (onProgress) => {
          const blob = asset.blobKey ? await getBlob(asset.blobKey) : null;
          const ma = await analyzeMedia(asset, blob ?? null, opts, onProgress);
          const cur = get().project;
          if (epoch !== projectEpoch || !getMedia(cur, mediaId)) return;
          const analysis = mergeAnalysis(cur, ma, { silenceThresholdDb: opts.silenceThresholdDb, silenceMinMs: opts.silenceMinMs });
          const withAnalysis: Project = { ...cur, analysis };
          history.current = withAnalysis;
          set({ project: withAnalysis, lint: relint(withAnalysis) });
          scheduleSave();
        },
      });
    },

    analyzeAll() {
      for (const m of get().project.media) get().analyze(m.id);
    },

    refreshSilences() {
      const p = get().project;
      if (!p.analysis) return;
      const opts = get().analyzeOptions;
      const byMedia = { ...p.analysis.byMedia };
      for (const id of Object.keys(byMedia)) {
        byMedia[id] = recomputeSilences(byMedia[id], opts.silenceThresholdDb, opts.silenceMinMs);
      }
      const analysis = { ...p.analysis, byMedia, settings: { silenceThresholdDb: opts.silenceThresholdDb, silenceMinMs: opts.silenceMinMs }, updatedAt: Date.now() };
      const next: Project = { ...p, analysis };
      history.current = next;
      set({ project: next, lint: relint(next) });
      scheduleSave();
    },

    setPlayhead(t, opts) {
      // Seeking while playing would leave the audio graph playing from the old
      // position (it's built at play() time) — pause first, matching scrubbing.
      // The playback clock passes fromPlayback so its own advances stay silent.
      if (!Number.isFinite(t)) return;
      if (get().playing && !opts?.fromPlayback) get().pause();
      set({ playhead: Math.max(0, Math.min(t, projectDuration(get().project))) });
    },
    play() {
      // Pressing play at (or past) the end of the timeline restarts from 0 —
      // otherwise the play button appears dead right after a preview finishes.
      if (get().playhead >= projectDuration(get().project) - 0.05) set({ playhead: 0 });
      set({ playing: true });
    },
    pause() { get().pool.pauseAll(); set({ playing: false }); },
    togglePlay() { get().playing ? get().pause() : get().play(); },
    setZone(z) {
      if (!z) { set({ zone: null }); return; }
      const dur = projectDuration(get().project);
      const inT = Math.max(0, Math.min(z.in, dur));
      const outT = Math.max(inT + 0.05, Math.min(z.out, Math.max(dur, inT + 0.05)));
      set({ zone: { in: inT, out: outT, loop: z.loop ?? get().zone?.loop ?? false } });
    },

    select(ids, additive = false) {
      set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids }));
    },
    setZoom(z) { set({ zoom: Math.max(8, Math.min(600, z)) }); },

    snapshot(name, source = 'manual', thumbnail) {
      const p = get().project;
      const v: Version = { id: uid('ver'), name, at: Date.now(), project: JSON.parse(JSON.stringify(p)), thumbnail, score: relint(p).score, source };
      set((s) => ({ versions: [v, ...s.versions].slice(0, 40) }));
      return v;
    },
    restoreVersion(id) {
      const v = get().versions.find((x) => x.id === id);
      if (!v) return;
      get().snapshot('Before restore', 'auto');
      get().replaceProject(JSON.parse(JSON.stringify(v.project)), `Restore "${v.name}"`);
    },
    deleteVersion(id) {
      set((s) => ({ versions: s.versions.filter((v) => v.id !== id) }));
    },
    diffVersion(id) {
      const v = get().versions.find((x) => x.id === id);
      return v ? diffProjects(v.project, get().project) : null;
    },

    setAISettings(patch) {
      const next = saveAISettings(patch);
      set({ aiSettings: next });
    },

    async sendChat(text) {
      const clean = text.trim();
      if (!clean) return;
      const userMsg: ChatMessage = { id: uid('msg'), role: 'user', text: clean, at: Date.now() };
      set((s) => ({ chat: [...s.chat, userMsg], aiBusy: true, plan: null }));

      // "undo that" is deterministic — never send it to a model.
      const intent = undoIntent(clean);
      if (intent) {
        const label = intent === 'undo' ? get().undoLabel : get().redoLabel;
        if (intent === 'undo') get().undo(); else get().redo();
        set((s) => ({
          aiBusy: false,
          chat: [...s.chat, {
            id: uid('msg'), role: 'assistant' as const,
            text: label
              ? (intent === 'undo' ? 'Undone — the last edit has been reverted.' : 'Redone — the last edit is back.')
              : `Nothing to ${intent}.`,
            at: Date.now(),
          }],
        }));
        return;
      }

      // The model sees the conversation, not just the last sentence.
      const history: HistoryTurn[] = get().chat
        .slice(0, -1)
        .filter((m) => m.role !== 'system' && m.text.trim())
        .slice(-20)
        .map((m) => ({ role: m.role as 'user' | 'assistant', text: m.text }));

      let live: string | null = null;
      const onDelta = (delta: string) => {
        const id = live;
        if (!id) {
          live = uid('msg');
          set((s) => ({ chat: [...s.chat, { id: live as string, role: 'assistant', text: delta, at: Date.now() }] }));
        } else {
          set((s) => ({ chat: s.chat.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)) }));
        }
      };

      try {
        const turn = await respond(get().project, clean, history, get().aiSettings, onDelta);

        // Conversation: plain text, no plan, no tools.
        if (turn.mode === 'chat' || !turn.plan) {
          const reply: ChatMessage = { id: live ?? uid('msg'), role: 'assistant', text: turn.text, at: Date.now() };
          set((s) => ({
            chat: live ? s.chat.map((m) => (m.id === live ? reply : m)) : [...s.chat, reply],
            aiBusy: false,
            plan: null,
          }));
          return;
        }

        // One clear edit: do it now, then confirm in one sentence.
        if (turn.mode === 'action') {
          const res = await get().executePlan(turn.plan);
          const idle = res.idle.length
            ? ` Nothing changed for ${res.idle.join(', ')} — that needs analysed media; run Analyze on the clip first.`
            : '';
          const failed = res.failed.length ? ` ${res.failed.join(' ')}` : '';
          const fromRules = /^Matched your request|^Built-in rules/i.test(turn.text);
          const detail = res.diff.identical
            ? 'The project was already in that state — nothing changed.'
            : (res.applied && turn.text && !fromRules ? turn.text : `Done — ${res.diff.summary.toLowerCase()}.`);
          const reply: ChatMessage = { id: live ?? uid('msg'), role: 'assistant', text: `${detail}${idle}${failed}`, at: Date.now(), diff: res.diff };
          set((s) => ({
            chat: live ? s.chat.map((m) => (m.id === live ? reply : m)) : [...s.chat, reply],
            aiBusy: false,
            plan: null,
          }));
          return;
        }

        // Real multi-step plan. It is shown for review because it changes a lot.
        const reply: ChatMessage = { id: live ?? uid('msg'), role: 'assistant', text: turn.text, at: Date.now(), plan: turn.plan };
        set((s) => ({
          chat: live ? s.chat.map((m) => (m.id === live ? reply : m)) : [...s.chat, reply],
          aiBusy: false,
          plan: turn.plan,
        }));
        if (get().autopilot && get().session?.connected) await get().approvePlan();
      } catch (e) {
        // Honest failure with a retry button — never a fabricated reply.
        const err: ChatMessage = {
          id: uid('msg'), role: 'system',
          text: (e as Error).message || 'The AI request failed. Check the endpoint and key, then retry.',
          at: Date.now(), error: true, retry: clean,
        };
        set((s) => ({
          chat: live ? s.chat.map((m) => (m.id === live ? err : m)) : [...s.chat, err],
          aiBusy: false,
        }));
      }
    },

    async executePlan(plan) {
      get().snapshot('Before AI run', 'ai');
      const before = get().project;
      const idle: string[] = [];
      const failed: string[] = [];
      let applied = 0;
      // Visible text uses the human reason from the plan, never the tool id.
      const labelOf = (step: PlanStep) => (step.why?.trim() || step.tool.replace(/_/g, ' ')).replace(/\.+$/, '');
      for (const step of plan.steps) {
        try {
          const r = await get().previewTool(step.tool, step.params, 'ai');
          if (r.actions.length) {
            get().commit(r.actions, step.tool, 'ai');
            applied++;
          } else {
            idle.push(labelOf(step));
          }
        } catch (e) {
          failed.push(`${labelOf(step)} failed: ${(e as Error).message}`);
        }
      }
      return { applied, diff: diffProjects(before, get().project), idle, failed };
    },

    async approvePlan() {
      const plan = get().plan;
      if (!plan || get().planRunning) return;
      set({ planRunning: true });
      try {
        const res = await get().executePlan(plan);
        // A step that produces no actions is usually waiting for analysis (no
        // transcript → no captions, no silences → no dead-air cuts). Say so
        // instead of quietly reporting a smaller number.
        const idleNote = res.idle.length
          ? ` ${res.idle.length === 1 ? 'One step made' : `${res.idle.length} steps made`} no changes (${res.idle.join(', ')}) — they need analysed media: run Analyze on the clip first (transcript, silences and beats).`
          : '';
        const failNote = res.failed.length ? ` ${res.failed.join(' ')}` : '';
        const done: ChatMessage = {
          id: uid('msg'), role: 'assistant',
          text: res.applied
            ? res.diff.identical
              ? `Ran ${res.applied} step${res.applied === 1 ? '' : 's'} — the project was already in that state, so nothing changed.${idleNote}${failNote}`
              : `Applied ${res.applied} step${res.applied === 1 ? '' : 's'}. ${res.diff.summary}${idleNote}${failNote}`
            : `No changes were made.${idleNote}${failNote}`,
          at: Date.now(), diff: res.diff,
        };
        set((s) => ({ chat: [...s.chat, done], plan: null, planRunning: false }));
      } catch (e) {
        set((s) => ({
          chat: [...s.chat, {
            id: uid('msg'), role: 'system' as const,
            text: `Could not run the plan: ${(e as Error).message}`,
            at: Date.now(), error: true,
          }],
          planRunning: false,
        }));
      }
    },

    rejectPlan() {
      const plan = get().plan;
      set((s) => ({
        plan: null,
        chat: plan ? [...s.chat, { id: uid('msg'), role: 'system', text: 'Plan rejected — no changes applied.', at: Date.now() }] : s.chat,
      }));
    },

    clearChat() { set({ chat: [], plan: null }); },

    touch(clipIds) {
      const until = Date.now() + LOCK_MS;
      set((s) => {
        const locks = { ...s.locks };
        for (const id of clipIds) locks[id] = until;
        return { locks };
      });
    },
    lockedIds() {
      const now = Date.now();
      const out = new Set<string>();
      for (const [id, exp] of Object.entries(get().locks)) if (exp > now) out.add(id);
      return out;
    },
    setAutopilot(on) { set({ autopilot: on }); },

    createSession(relayUrl) {
      const token = crypto.randomUUID().replace(/-/g, '');
      const session: AgentSession = { token, projectId: get().project.id, createdAt: Date.now(), connected: false, relayUrl, activity: [] };
      set({ session });
      return session;
    },
    revokeSession() { set({ session: null }); },
    setSessionConnected(on) {
      set((s) => ({ session: s.session ? { ...s.session, connected: on } : null }));
    },
    logActivity(text) {
      set((s) => ({
        session: s.session
          ? { ...s.session, activity: [{ at: Date.now(), text }, ...s.session.activity].slice(0, 100) }
          : null,
      }));
    },

    getAnalysis() { return get().project.analysis; },
    duration() { return projectDuration(get().project); },
  };
});

// Debug hook for browser DevTools/testing (harmless in production).
if (typeof window !== 'undefined') {
  (window as unknown as { __cutflow?: unknown }).__cutflow = {
    useStore,
    get pool() { return useStore.getState().pool; },
  };
}

/** Probe duration/dimensions/audio of a video or audio file via a temp element. */
/** Classify an imported file. MIME first; when it's missing or generic
 * (drag-dropped files, some .m4a/.wav from certain apps), fall back to the
 * extension — misclassifying audio as video breaks the probe (duration 0),
 * lands clips on the wrong track kind, and armed the add_music hang. */
function classifyFile(file: File): MediaAsset['type'] {
  const mime = file.type || '';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  const ext = (file.name.toLowerCase().split('.').pop() ?? '');
  if (['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v', 'mpg', 'mpeg', 'wmv', 'flv', 'ts'].includes(ext)) return 'video';
  if (['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aif', 'aiff', 'wma', 'amr'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg', 'heic', 'heif'].includes(ext)) return 'image';
  return 'video';
}

function probeMedia(file: File, type: 'video' | 'audio'): Promise<{ duration: number; width: number; height: number; hasAudio: boolean }> {  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement(type);
    el.preload = 'metadata';
    el.muted = true;
    const done = (duration: number, width: number, height: number, hasAudio: boolean) => {
      URL.revokeObjectURL(url);
      resolve({ duration: Number.isFinite(duration) ? duration : 0, width, height, hasAudio });
    };
    el.addEventListener('loadedmetadata', () => {
      const v = el as HTMLVideoElement;
      const hasAudio = type === 'audio' ? true : (v.videoWidth === 0 ? true : detectAudioTrack(v));
      done(el.duration || 0, v.videoWidth || 0, v.videoHeight || 0, hasAudio);
    }, { once: true });
    el.addEventListener('error', () => done(0, 0, 0, type === 'audio'), { once: true });
    el.src = url;
    setTimeout(() => done(el.duration || 0, (el as HTMLVideoElement).videoWidth || 0, (el as HTMLVideoElement).videoHeight || 0, type === 'audio'), 4000);
  });
}

function detectAudioTrack(v: HTMLVideoElement): boolean {
  // Best-effort: webkitAudioDecodedByteCount / mozHasAudio / audioTracks where available.
  const anyV = v as unknown as { webkitAudioDecodedByteCount?: number; mozHasAudio?: boolean; audioTracks?: { length: number } };
  if (typeof anyV.mozHasAudio === 'boolean') return anyV.mozHasAudio;
  if (anyV.audioTracks) return anyV.audioTracks.length > 0;
  if (typeof anyV.webkitAudioDecodedByteCount === 'number') return anyV.webkitAudioDecodedByteCount > 0;
  return true; // assume audio; analysis flags it if undecodable
}

export type { Clip, ToolResult, Plan, ProjectDiff };