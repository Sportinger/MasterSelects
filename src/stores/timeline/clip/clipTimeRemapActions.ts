import { WarpInitializationError } from '../../../services/timeline/retime/clipWarpInitialization';
import { validWarpPoints } from '../../../services/timeline/retime/clipWarp';
import type { ClipTimeRemap } from '../../../types/timeline';
import { endBatch, startBatch } from '../../historyStore';
import { createClipSpeedSource, createIdentityClipWarp, createStoreSpeedSource, resolveClipSourceTime } from '../../../services/timeline/retime/clipRetime';
import { clearProcessedAudioAnalysisRefs } from '../helpers/audioAnalysisStateHelpers';
import { resolveLinkedVideoAudioPair } from '../helpers/linkedClipSpeed';
import { getActiveCompositionFrameRate } from '../editOperations/activeCompositionFrameRate';
import type { ClipActionContext } from './clipActionContext';

/** One mutation for both halves, even when linked speed following is disabled. */
export function setClipTimeRemapAction(
  { set, get }: ClipActionContext, clipId: string, timeRemap: ClipTimeRemap | null,
): boolean {
  const state = get();
  if (state.isExporting || (timeRemap !== null &&
    (timeRemap.kind === 'freeze' ? !Number.isFinite(timeRemap.sourceTime)
      : timeRemap.kind === 'loop' ? timeRemap.phase !== undefined && !Number.isFinite(timeRemap.phase)
      : timeRemap.kind === 'warp' ? !validWarpPoints(timeRemap.points) : true))) return false;
  const clip = state.clips.find(item => item.id === clipId);
  if (!clip) return false;
  const pair = resolveLinkedVideoAudioPair(state.clips, clipId);
  const targets = pair ? [pair.video, pair.audio] : [clip];
  if (targets.some(item => state.tracks.find(track => track.id === item.trackId)?.locked)) return false;
  const minimumDuration = 1 / getActiveCompositionFrameRate();
  const remap: ClipTimeRemap | undefined = timeRemap === null ? undefined
    : timeRemap.kind === 'warp' ? structuredClone(timeRemap)
    : timeRemap.kind === 'loop' ? { kind: 'loop', phase: timeRemap.phase ?? 0 } : { kind: 'freeze',
    sourceTime: resolveClipSourceTime({ ...clip, transitionSourceMap: undefined,
      transitionSourceTimeOverride: undefined, transitionSourceHold: false, timeRemap }, 0).sourceTime };
  if (targets.every(item => JSON.stringify(item.timeRemap) === JSON.stringify(remap) &&
    (!remap || item.duration >= minimumDuration))) return true;
  const ids = new Set(targets.map(item => item.id));
  const batch = startBatch(remap?.kind === 'warp' ? 'Warp clip' : remap?.kind === 'loop' ? 'Loop clip' : remap ? 'Freeze frame' : 'Remove clip retime');
  try {
    set({ clips: state.clips.map(item => ids.has(item.id)
      ? clearProcessedAudioAnalysisRefs({ ...item, timeRemap: remap ? structuredClone(remap) : undefined,
        duration: remap ? Math.max(minimumDuration, item.duration) : item.duration }) : item) });
    get().updateDuration();
    get().invalidateCache();
    return true;
  } finally {
    if (batch.opened) endBatch();
  }
}

export function freezeClipAtPlayheadAction(context: ClipActionContext, clipId: string): boolean {
  const state = context.get();
  const clip = state.clips.find(item => item.id === clipId);
  if (!clip) return false;
  const local = state.playheadPosition - clip.startTime;
  // "At playhead" is only meaningful inside the clip; never freeze a silently clamped edge frame.
  if (!(local >= 0 && local < clip.duration)) return false;
  const { sourceTime } = resolveClipSourceTime(clip, local, createStoreSpeedSource(clipId, state));
  return setClipTimeRemapAction(context, clipId, { kind: 'freeze', sourceTime });
}

/** Both UI entry points sample fresh keyframes at the active composition frame rate. */
export function toggleClipWarpAction(context: ClipActionContext, clipId: string): boolean {
  const state = context.get();
  const clip = state.clips.find(item => item.id === clipId);
  if (!clip) return false;
  if (clip.timeRemap?.kind === 'warp') return setClipTimeRemapAction(context, clipId, null);
  const timing = { ...clip, keyframes: state.clipKeyframes.get(clipId) ?? [] };
  try {
    return setClipTimeRemapAction(context, clipId,
      createIdentityClipWarp(timing, createClipSpeedSource(timing), getActiveCompositionFrameRate()));
  } catch (error) {
    if (error instanceof WarpInitializationError) return false;
    throw error;
  }
}
