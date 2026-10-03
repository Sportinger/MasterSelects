import type { TempoMap, TimelineClip } from '../../types';
import type { BeatRuleSource } from '../../types/compositionGraph';
import { iterateBarBeatLines } from '../../timeline/tempo/TempoMap';
import { getClipSourceRate } from '../../utils/clipPlaybackTiming';

export interface BeatRuleSourceState {
  clips: readonly TimelineClip[];
  tempoMap: TempoMap;
  duration: number;
}

export interface BeatRuleSourceOption {
  value: string;
  label: string;
  source?: BeatRuleSource;
  analysisClipId?: string;
}

export const beatRuleSourceValue = (source: BeatRuleSource): string =>
  source.kind === 'tempo-map' ? 'tempo-map' : `${source.clipId}:${source.provenance}`;

/** Unanalyzed clips remain selectable drafts, never invalid persisted rule sources. */
export function listBeatRuleSourceOptions(clips: readonly TimelineClip[]): BeatRuleSourceOption[] {
  const byId = new Map(clips.map(clip => [clip.id, clip]));
  const pairedVideos = new Set<string>();
  for (const clip of clips) {
    const linked = clip.linkedClipId ? byId.get(clip.linkedClipId) : undefined;
    if (clip.source?.type === 'video' && linked?.source?.type === 'audio') pairedVideos.add(clip.id);
    if (clip.source?.type === 'audio' && linked?.source?.type === 'video') pairedVideos.add(linked.id);
  }
  const options: BeatRuleSourceOption[] = [{ value: 'tempo-map', label: 'Composition tempo map', source: { kind: 'tempo-map' } }];
  for (const clip of clips) {
    if (pairedVideos.has(clip.id)) continue;
    const sourceGrid = clip.audioState?.sourceAnalysisRefs?.beatGridId;
    const processedGrid = clip.audioState?.processedAnalysisRefs?.beatGridId;
    // Video files can carry embedded audio; the existing extractor determines availability.
    if (clip.source?.type !== 'audio' && clip.source?.type !== 'video'
      && !clip.hasMixdownAudio && !sourceGrid && !processedGrid) continue;
    for (const provenance of ['source', 'processed'] as const) {
      const artifactId = provenance === 'source' ? sourceGrid : processedGrid;
      if (artifactId) options.push({ value: `${clip.id}:${provenance}`, label: `${clip.name} (${provenance})`,
        source: { kind: 'clip-beat-grid', clipId: clip.id, provenance, artifactId } });
    }
    if (!sourceGrid && !processedGrid) options.push({ value: `${clip.id}:unanalyzed`,
      label: `${clip.name} (not analyzed)`, analysisClipId: clip.id });
  }
  return options;
}

/**
 * Grid seconds to ascending timeline seconds. Source grids are in media time and are
 * mapped through trim/speed/reverse; processed grids were analyzed on the rendered clip
 * audio (already trimmed, reversed and retimed), so they are clip-local seconds.
 */
export function mapBeatGridToTimeline(
  beats: readonly { time: number }[],
  clip: Pick<TimelineClip, 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'speed' | 'reversed'>,
  provenance: 'source' | 'processed' = 'source',
): number[] {
  if (provenance === 'processed') {
    return beats
      .filter(beat => Number.isFinite(beat.time) && beat.time >= 0 && beat.time <= clip.duration)
      .map(beat => clip.startTime + beat.time)
      .toSorted((a, b) => a - b);
  }
  const rate = getClipSourceRate(clip);
  const reverse = clip.reversed || (clip.speed ?? 1) < 0;
  return beats
    .filter(beat => Number.isFinite(beat.time) && beat.time >= clip.inPoint && beat.time <= clip.outPoint)
    .map(beat => clip.startTime + (reverse ? clip.outPoint - beat.time : beat.time - clip.inPoint) / rate)
    .filter(time => time >= clip.startTime && time <= clip.startTime + clip.duration)
    .toSorted((a, b) => a - b);
}

/** Seconds of tempo-map beats kept in a snapshot; Refresh source extends it for longer timelines. */
export function tempoMapSnapshotHorizon(duration: number): number {
  return Math.max(600, duration * 2);
}

export function currentBeatRuleSource(source: BeatRuleSource, state: BeatRuleSourceState): BeatRuleSource | undefined {
  if (source.kind === 'tempo-map') return source;
  const clip = state.clips.find(candidate => candidate.id === source.clipId);
  const refs = source.provenance === 'processed' ? clip?.audioState?.processedAnalysisRefs : clip?.audioState?.sourceAnalysisRefs;
  return refs?.beatGridId ? { ...source, artifactId: refs.beatGridId } : undefined;
}

/** Artifact ids are versioned; timing and tempo edits also invalidate a snapshot. */
export function beatRuleSourceRevision(source: BeatRuleSource, state: BeatRuleSourceState): string | undefined {
  const current = currentBeatRuleSource(source, state);
  if (!current) return;
  // The tempo map is unbounded; composition length is not part of its identity (a rule that
  // extends the composition must not invalidate itself).
  if (current.kind === 'tempo-map') return JSON.stringify(['tempo-map', state.tempoMap]);
  const clip = state.clips.find(candidate => candidate.id === current.clipId)!;
  return JSON.stringify([current, clip.startTime, clip.duration, clip.inPoint, clip.outPoint, clip.speed ?? 1, clip.reversed ?? false]);
}

export async function resolveBeatRuleSource(source: BeatRuleSource, state: BeatRuleSourceState): Promise<{
  source: BeatRuleSource; beatSnapshot: number[]; sourceRevision: string;
} | null> {
  const current = currentBeatRuleSource(source, state);
  const sourceRevision = beatRuleSourceRevision(source, state);
  if (!current || !sourceRevision) return null;
  if (current.kind === 'tempo-map') {
    if (!Number.isFinite(state.duration) || state.duration < 0) return null;
    return { source: current, sourceRevision, beatSnapshot: iterateBarBeatLines(state.tempoMap, 0,
      tempoMapSnapshotHorizon(state.duration)).map(beat => beat.time) };
  }
  const clip = state.clips.find(candidate => candidate.id === current.clipId)!;
  const { loadTimelineBeatGrid } = await import('../audio/timelineBeatOnsetCache');
  const grid = await loadTimelineBeatGrid(current.artifactId);
  if (!grid) return null;
  const beatSnapshot = mapBeatGridToTimeline(grid.beats, clip, current.provenance);
  return { source: current, sourceRevision, beatSnapshot };
}
