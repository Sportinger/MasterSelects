import type { MediaFile } from '../../../../stores/mediaStore/types';
import type { TimelineClip } from '../../../../types/timeline';

export interface SourceAnalysisSnapshot {
  source: Blob;
  durationSeconds: number;
  values: readonly unknown[];
}

function ready<T>(clips: readonly TimelineClip[], select: (clip: TimelineClip) => T | undefined): T | undefined {
  let selected: T | undefined;
  let selectedId: string | undefined;
  for (const clip of clips) {
    const value = select(clip);
    if (value !== undefined && (selectedId === undefined || clip.id.localeCompare(selectedId) < 0)) {
      selected = value;
      selectedId = clip.id;
    }
  }
  return selected;
}

/** Source analysis is independent of clip placement, transforms and UI state. */
export function collectSourceAnalysisSnapshots(
  files: readonly MediaFile[],
  clips: readonly TimelineClip[],
): Map<string, SourceAnalysisSnapshot> {
  const clipsBySource = new Map<string, TimelineClip[]>();
  for (const clip of clips) {
    const id = clip.source?.mediaFileId ?? clip.mediaFileId;
    if (!id) continue;
    const sourceClips = clipsBySource.get(id) ?? [];
    sourceClips.push(clip);
    clipsBySource.set(id, sourceClips);
  }
  const snapshots = new Map<string, SourceAnalysisSnapshot>();
  const filesById = new Map(files.map(file => [file.id, file]));
  const sourceIds = new Set([...filesById.keys(), ...clipsBySource.keys()]);
  for (const id of sourceIds) {
    const media = filesById.get(id);
    const sourceClips = clipsBySource.get(id) ?? [];
    const source = media?.file ?? sourceClips
      .map(clip => clip.source?.file ?? (clip.needsReload ? undefined : clip.file)).find(Boolean);
    const durations = [media?.duration, media?.sceneCutAnalysis?.duration,
      ...sourceClips.map(clip => clip.source?.naturalDuration),
      ...sourceClips.map(clip => clip.outPoint)]
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
    if (!source || durations.length === 0) continue;
    // Reference DTOs are small. Compare their identifiers rather than retaining
    // audioState objects, which also change when clip gain/effects are edited.
    const audioRefs = new Set<string>();
    for (const refs of [media?.audioAnalysisRefs, ...sourceClips.flatMap(clip => [
      clip.audioState?.sourceAnalysisRefs, clip.audioState?.processedAnalysisRefs,
    ])]) {
      if (!refs) continue;
      for (const value of Object.values(refs)) {
        for (const ref of Array.isArray(value) ? value : [value]) {
          if (typeof ref === 'string') audioRefs.add(ref);
        }
      }
    }
    const transcript = media?.transcriptStatus === 'ready' && media.transcript
      ? media.transcript
      : ready(sourceClips, clip => clip.transcriptStatus === 'ready' ? clip.transcript : undefined);
    snapshots.set(id, {
      source,
      durationSeconds: Math.max(...durations),
      values: [
        ready(sourceClips, clip => clip.analysisStatus === 'ready' ? clip.analysis : undefined),
        transcript,
        transcript ? media?.transcribedRanges : undefined,
        media?.sceneCutStatus === 'ready' ? media.sceneCutAnalysis : undefined,
        ready(sourceClips, clip => clip.sceneDescriptionStatus === 'ready' ? clip.sceneDescriptions : undefined),
        [...audioRefs].toSorted().join('|'),
      ],
    });
  }
  return snapshots;
}

export function sourceAnalysisSnapshotsMatch(
  previous: SourceAnalysisSnapshot | undefined,
  next: SourceAnalysisSnapshot,
): boolean {
  return previous?.source === next.source
    && previous.durationSeconds === next.durationSeconds
    && previous.values.every((value, index) => value === next.values[index]);
}
