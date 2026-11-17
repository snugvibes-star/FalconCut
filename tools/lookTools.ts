/**
 * Look tools: apply_color_preset, add_broll_slots, auto_broll (own library
 * keyword matching + optional Pexels stock API with the user's key).
 */
import type { Action } from '../engine/actions';
import { getMedia, projectDuration, uid } from '../engine/types';
import { COLOR_PRESETS } from '../engine/effects';
import type { ToolContext, ToolResult } from './cutTools';
import { speechClips, sourceToTimeline } from './helpers';

export function applyColorPreset(ctx: ToolContext, params: { name?: string } = {}): ToolResult {
  const p = ctx.project;
  const name = params.name ?? ctx.pack.color;
  const preset = COLOR_PRESETS[name] ?? COLOR_PRESETS.natural;
  const actions: Action[] = [];
  let n = 0;
  for (const clip of p.clips) {
    if (clip.kind !== 'media') continue;
    const asset = getMedia(p, clip.mediaId);
    if (!asset || !(asset.type === 'video' || asset.type === 'image' || asset.type === 'generator')) continue;
    for (const e of clip.effects) if (e.type === 'color' || e.type === 'vignette') actions.push({ type: 'remove_effect', clipId: clip.id, effectId: e.id });
    actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'color', params: { ...preset.params } } });
    if (name === 'cinematic') actions.push({ type: 'add_effect', clipId: clip.id, effect: { type: 'vignette', params: { amount: 0.35 } } });
    n++;
  }
  return { actions, summary: `Applied the "${preset.name}" color preset to ${n} visual clip${n === 1 ? '' : 's'}.`, stats: { clips: n, preset: name } };
}

export function addBrollSlots(ctx: ToolContext): ToolResult {
  const p = ctx.project;
  if (!ctx.pack.broll.enabled) return { actions: [], summary: 'B-roll suggestions are disabled by the active pack.' };
  const actions: Action[] = [];
  let slots = 0;
  for (const clip of speechClips(p)) {
    const ma = p.analysis!.byMedia[clip.mediaId!];
    if (!ma) continue;
    // long talking stretches without a shot change
    const boundaries = [clip.inPoint, ...ma.scenes.filter((s) => s > clip.inPoint && s < clip.inPoint + clip.duration * clip.speed), clip.inPoint + clip.duration * clip.speed];
    for (let i = 0; i < boundaries.length - 1; i++) {
      const len = boundaries[i + 1] - boundaries[i];
      if (len < ctx.pack.broll.minStretchSec) continue;
      const midSrc = boundaries[i] + len / 2;
      const tl = sourceToTimeline(p, clip.mediaId!, midSrc);
      if (tl == null) continue;
      const kw = ma.keywords.slice(0, 3).join(', ');
      actions.push({ type: 'add_marker', marker: { time: tl, label: `B-roll slot (${len.toFixed(0)}s static)`, color: '#FBBF24', kind: 'broll' } });
      actions.push({ type: 'add_tack', tack: { time: tl, clipId: clip.id, author: 'ai', text: `Cutaway would help here: ${len.toFixed(0)}s of continuous talking. Suggested subject: ${kw || 'relevant b-roll'}. Drop a clip on V2 above this moment.` } });
      slots++;
    }
  }
  return {
    actions,
    summary: slots ? `Marked ${slots} b-roll slot${slots === 1 ? '' : 's'} where long talking stretches need a cutaway (markers + tacks). Fill them with your own footage or auto_broll.` : 'No long static stretches found.',
    stats: { slots },
  };
}

export async function autoBroll(ctx: ToolContext, params: { pexelsKey?: string; query?: string } = {}): Promise<ToolResult> {
  const p = ctx.project;
  const slots = p.markers.filter((m) => m.kind === 'broll');
  const images = p.media.filter((m) => m.type === 'image' || (m.type === 'video' && !m.hasAudio));
  const actions: Action[] = [];
  const warnings: string[] = [];
  let filled = 0;

  const overlayTrack = p.tracks.find((t) => t.kind === 'video' && t.id !== p.clips.find((c) => c.kind === 'media')?.trackId);
  const trackId = overlayTrack?.id ?? (() => { const id = uid('trk'); actions.push({ type: 'add_track', track: { id, kind: 'video', name: 'B-roll' }, index: 0 }); return id; })();

  const keywordsFor = (time: number): string[] => {
    for (const clip of speechClips(p)) {
      const ma = p.analysis!.byMedia[clip.mediaId!];
      if (!ma?.transcript) continue;
      const src = clip.inPoint + (time - clip.start) * clip.speed;
      const near = ma.transcript.words.filter((w) => Math.abs(w.start - src) < 6).map((w) => w.word.toLowerCase().replace(/\W/g, ''));
      if (near.length) return near.filter((w) => w.length > 3);
    }
    return [];
  };

  for (const slot of slots.slice(0, 8)) {
    const kws = params.query ? [params.query] : keywordsFor(slot.time);
    // 1) own library: name/tag match
    const own = images.find((m) => kws.some((k) => m.name.toLowerCase().includes(k) || m.tags?.some((t) => t.toLowerCase().includes(k))));
    if (own) {
      const dur = Math.min(own.type === 'image' ? 3 : own.duration, 4);
      actions.push({ type: 'add_clip', clip: { trackId, mediaId: own.id, start: slot.time - dur / 2, duration: dur, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0, skewX: 0, skewY: 0, opacity: 0.96, cropL: 0, cropR: 0, cropT: 0, cropB: 0 } } });
      filled++;
      continue;
    }
    // 2) Pexels with user's key (optional)
    if (params.pexelsKey && kws.length) {
      try {
        const res = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(kws.slice(0, 2).join(' '))}&per_page=1&orientation=portrait`, { headers: { Authorization: params.pexelsKey } });
        if (!res.ok) throw new Error(`Pexels ${res.status}`);
        const data = await res.json();
        const photo = data.photos?.[0];
        if (photo) {
          const imgRes = await fetch(photo.src.large);
          const blob = await imgRes.blob();
          const bmp = await createImageBitmap(blob);
          const mediaId = uid('media');
          const blobKey = `media_${mediaId}`;
          const { putBlob } = await import('../src/state/persistence');
          await putBlob(blobKey, blob);
          actions.push({ type: 'add_media', asset: { id: mediaId, name: `pexels-${photo.id}.jpg`, type: 'image', duration: 4, width: bmp.width, height: bmp.height, hasAudio: false, blobKey, mime: 'image/jpeg', source: 'stock', tags: kws.slice(0, 3) } });
          actions.push({ type: 'add_clip', clip: { trackId, mediaId, start: slot.time - 1.5, duration: 3, inPoint: 0 } });
          filled++;
        }
      } catch (e) {
        warnings.push(`Stock fetch failed: ${(e as Error).message}`);
      }
    }
  }
  if (!filled && !params.pexelsKey) warnings.push('No matching media in your library. Import b-roll, or add a Pexels API key in Settings to fetch stock (your key, your account).');
  return { actions, summary: filled ? `Filled ${filled} b-roll slot${filled === 1 ? '' : 's'} with matching media on an overlay track.` : 'No b-roll filled.', stats: { filled }, warnings };
}