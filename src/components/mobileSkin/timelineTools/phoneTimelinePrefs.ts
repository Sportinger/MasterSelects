// Timeline preferences the Timeline sheet and the timeline control row change through the editor's
// own store actions: snapping, the beat grid (a Bars ruler lane, which is what the editor snaps to),
// its subdivision, the metronome, the in/out range, loop playback and the view options. None of
// them is project content in the editor (the desktop buttons do not create undo steps either), so
// the sheet snapshots them when it opens and Cancel puts the snapshot back exactly.

import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';
import type { TimelineGridSubdivision } from '../../../timeline/tempo/barsGrid';
import type { MetronomeMode } from '../../../services/audio/metronomeScheduler';

export interface PhoneTimelinePrefs {
  snappingEnabled: boolean;
  beatGrid: boolean;
  gridSubdivision: TimelineGridSubdivision;
  metronomeEnabled: boolean;
  metronomeVolume: number;
  metronomeMode: MetronomeMode;
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;
  thumbnailsEnabled: boolean;
  waveformsEnabled: boolean;
  trackFocusMode: TimelineTrackFocusMode;
}

type TimelineState = ReturnType<typeof useTimelineStore.getState>;

export function hasBeatGrid(state: Pick<TimelineState, 'rulerLanes'>): boolean {
  return state.rulerLanes.some((lane) => lane.format === 'bars');
}

export function readPhoneTimelinePrefs(state: TimelineState = useTimelineStore.getState()): PhoneTimelinePrefs {
  return {
    snappingEnabled: state.snappingEnabled,
    beatGrid: hasBeatGrid(state),
    gridSubdivision: state.timelineGridSubdivision,
    metronomeEnabled: state.metronomeEnabled,
    metronomeVolume: state.metronomeVolume,
    metronomeMode: state.metronomeMode,
    inPoint: state.inPoint,
    outPoint: state.outPoint,
    loopPlayback: state.loopPlayback,
    thumbnailsEnabled: state.thumbnailsEnabled,
    waveformsEnabled: state.waveformsEnabled,
    trackFocusMode: state.trackFocusMode,
  };
}

/** Shows or hides the beat grid: the editor snaps to beats only while a Bars ruler lane exists. */
export function setPhoneBeatGrid(enabled: boolean): void {
  const store = useTimelineStore.getState();
  const lane = store.rulerLanes.find((candidate) => candidate.format === 'bars');
  if (enabled && !lane) store.addRulerLane('bars');
  if (!enabled && lane) store.removeRulerLane(lane.id);
}

/**
 * Puts every preference back to `prefs` through the editor's actions (Cancel). With
 * `content: false` the beat grid and the in/out range are left alone: they are project content in
 * the editor's repository, and the sheet's edit session rolls them back itself.
 */
export function restorePhoneTimelinePrefs(prefs: PhoneTimelinePrefs, { content = true }: { content?: boolean } = {}): void {
  const store = useTimelineStore.getState();
  if (store.snappingEnabled !== prefs.snappingEnabled) store.toggleSnapping();
  if (content) setPhoneBeatGrid(prefs.beatGrid);
  if (store.timelineGridSubdivision !== prefs.gridSubdivision) store.setTimelineGridSubdivision(prefs.gridSubdivision);
  if (store.metronomeEnabled !== prefs.metronomeEnabled) store.toggleMetronome();
  if (store.metronomeVolume !== prefs.metronomeVolume) store.setMetronomeVolume(prefs.metronomeVolume);
  if (store.metronomeMode !== prefs.metronomeMode) store.setMetronomeMode(prefs.metronomeMode);
  // Clear first: setInPoint/setOutPoint clamp against each other.
  if (content && (store.inPoint !== prefs.inPoint || store.outPoint !== prefs.outPoint)) {
    store.clearInOut();
    if (prefs.inPoint !== null) useTimelineStore.getState().setInPoint(prefs.inPoint);
    if (prefs.outPoint !== null) useTimelineStore.getState().setOutPoint(prefs.outPoint);
  }
  if (store.loopPlayback !== prefs.loopPlayback) store.setLoopPlayback(prefs.loopPlayback);
  if (store.thumbnailsEnabled !== prefs.thumbnailsEnabled) store.setThumbnailsEnabled(prefs.thumbnailsEnabled);
  if (store.waveformsEnabled !== prefs.waveformsEnabled) store.setWaveformsEnabled(prefs.waveformsEnabled);
  if (store.trackFocusMode !== prefs.trackFocusMode) store.setTrackFocusMode(prefs.trackFocusMode);
}

export interface PhoneRangeResult {
  inPoint: number | null;
  outPoint: number | null;
  /** What happened, in words; says so when the editor moved the mark (never silent). */
  message: string;
}

function frameText(time: number, fps: number): string {
  const frames = Math.round(time * fps);
  const seconds = Math.floor(frames / fps);
  const rest = frames - seconds * fps;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${String(rest).padStart(2, '0')}`;
}

export function formatPhoneRangeTime(time: number, fps: number): string {
  return frameText(time, Math.max(1, Math.round(fps) || 30));
}

/** Sets the in or out mark at `time` with the editor's action and reports where it landed. */
export function setPhoneRangeMark(edge: 'in' | 'out', time: number, fps: number): PhoneRangeResult {
  const store = useTimelineStore.getState();
  if (edge === 'in') store.setInPoint(time);
  else store.setOutPoint(time);
  const { inPoint, outPoint } = useTimelineStore.getState();
  const landed = edge === 'in' ? inPoint : outPoint;
  const label = edge === 'in' ? 'In' : 'Out';
  let message = `${label} set at ${formatPhoneRangeTime(landed ?? time, fps)}.`;
  if (landed !== null && Math.abs(landed - time) > 1e-6) {
    message = edge === 'in'
      ? `In cannot be after Out: it sits at ${formatPhoneRangeTime(landed, fps)}.`
      : `Out cannot be before In or past the end: it sits at ${formatPhoneRangeTime(landed, fps)}.`;
  }
  return { inPoint, outPoint, message };
}

/** The range export and loop use: in..out, open ends fall back to 0 and the composition end. */
export function phoneRangeSpan(inPoint: number | null, outPoint: number | null, duration: number): { start: number; end: number } | null {
  if (inPoint === null && outPoint === null) return null;
  const start = inPoint ?? 0;
  const end = outPoint ?? duration;
  return end > start ? { start, end } : null;
}
