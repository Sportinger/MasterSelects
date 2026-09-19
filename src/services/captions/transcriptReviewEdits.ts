import { cancelHistoryBatch, endBatch, startBatch } from '../../stores/historyStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type {
  HistoryTimelineClipEditState,
  HistoryTimelineEditState,
  HistoryTimelineTrackEditState,
} from '../../stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../stores/timeline/historyTimelineRestoreState';
import {
  rehydrateHistoryGeneratedTimelineRuntimes,
  syncHistoryRehydratedTimelineRuntimeResources,
} from '../timeline/historyRuntimeRehydration';
import { applyAutomaticAudioFades } from '../audio/applyAutomaticCutDeClick';
import {
  collectMissingAudioJunctionFadeTargets,
  DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS,
} from '../audio/automaticCutDeClick';
import { layerBuilder } from '../layerBuilder';
import { bindRuntimeToClip } from '../mediaRuntime/clipBindings';
import { renderHostPort } from '../render/renderHostPort';
import type { TimelineClip } from '../../types/timeline';

const POSITION_EPSILON = 0.001;
const EMPTY_OMISSIONS: readonly TranscriptReviewOmission[] = [];

export interface TranscriptReviewOmission {
  duration: number;
  eventKey: string;
  id: string;
  kind: 'pause' | 'word';
  restoreClipIds: readonly string[];
  restoreSegments: readonly TranscriptReviewRestoreSegment[];
  text: string;
  timelineEnd: number;
  timelineStart: number;
}

export interface TranscriptReviewRestoreSegment {
  inPoint: number;
  mediaFileId?: string;
  outPoint: number;
  trackId: string;
}

interface TranscriptReviewOmissionRecord extends TranscriptReviewOmission {
  compositionId: string;
  originalTimelineStart: number;
  restoreState: HistoryTimelineEditState;
}

interface TranscriptReviewRuntime {
  listeners: Set<() => void>;
  recordsByComposition: Map<string, Map<string, TranscriptReviewOmissionRecord>>;
  snapshotsByComposition: Map<string, readonly TranscriptReviewOmission[]>;
}

const runtimeGlobal = globalThis as typeof globalThis & {
  __MASTERSELECTS_TRANSCRIPT_REVIEW_EDITS__?: TranscriptReviewRuntime;
};
const runtime: TranscriptReviewRuntime = runtimeGlobal.__MASTERSELECTS_TRANSCRIPT_REVIEW_EDITS__ ?? {
  listeners: new Set(),
  recordsByComposition: new Map(),
  snapshotsByComposition: new Map(),
};
runtimeGlobal.__MASTERSELECTS_TRANSCRIPT_REVIEW_EDITS__ = runtime;

function publishComposition(compositionId: string): void {
  const records = runtime.recordsByComposition.get(compositionId);
  runtime.snapshotsByComposition.set(
    compositionId,
    records
      ? [...records.values()]
          .map(({ compositionId: _compositionId, originalTimelineStart: _start, restoreState: _state, ...record }) => record)
          .toSorted((left, right) => left.timelineStart - right.timelineStart || left.id.localeCompare(right.id))
      : EMPTY_OMISSIONS,
  );
  runtime.listeners.forEach(listener => listener());
}

export function subscribeTranscriptReviewEdits(listener: () => void): () => void {
  runtime.listeners.add(listener);
  return () => runtime.listeners.delete(listener);
}

export function getTranscriptReviewOmissions(
  compositionId: string | null | undefined,
): readonly TranscriptReviewOmission[] {
  return compositionId
    ? runtime.snapshotsByComposition.get(compositionId) ?? EMPTY_OMISSIONS
    : EMPTY_OMISSIONS;
}

export function isTranscriptReviewOmissionRemoved(
  omission: TranscriptReviewOmission,
  clips: readonly TimelineClip[],
): boolean {
  return omission.restoreSegments.some(segment => !clips.some(clip => (
    clip.trackId === segment.trackId
    && (segment.mediaFileId === undefined || clip.mediaFileId === segment.mediaFileId)
    && clip.inPoint <= segment.inPoint + POSITION_EPSILON
    && clip.outPoint >= segment.outPoint - POSITION_EPSILON
  )));
}

export function clearTranscriptReviewEdits(compositionId?: string): void {
  if (compositionId) {
    runtime.recordsByComposition.delete(compositionId);
    runtime.snapshotsByComposition.delete(compositionId);
  } else {
    runtime.recordsByComposition.clear();
    runtime.snapshotsByComposition.clear();
  }
  runtime.listeners.forEach(listener => listener());
}

export function recordTranscriptReviewOmission(input: {
  compositionId: string;
  eventKey: string;
  kind: TranscriptReviewOmission['kind'];
  restoreState: HistoryTimelineEditState;
  text: string;
  timelineEnd: number;
  timelineStart: number;
}): TranscriptReviewOmission {
  const duration = input.timelineEnd - input.timelineStart;
  const records = runtime.recordsByComposition.get(input.compositionId)
    ?? new Map<string, TranscriptReviewOmissionRecord>();
  const restoreClipIds = input.restoreState.timeline.clips.map(clip => clip.id).toSorted();
  const restoreSegments = input.restoreState.timeline.clips.map(clip => ({
    inPoint: clip.inPoint,
    ...(clip.mediaFileId === undefined ? {} : { mediaFileId: clip.mediaFileId }),
    outPoint: clip.outPoint,
    trackId: clip.trackId,
  }));
  for (const record of records.values()) {
    if (record.timelineStart >= input.timelineEnd - POSITION_EPSILON) {
      record.timelineStart -= duration;
      record.timelineEnd -= duration;
    }
  }
  const previousRecord = [...records.values()].find(record => (
    record.restoreClipIds.length === restoreClipIds.length
    && record.restoreClipIds.every((clipId, index) => clipId === restoreClipIds[index])
  ));
  const id = previousRecord?.id ?? `transcript-omission-${globalThis.crypto.randomUUID()}`;
  const record: TranscriptReviewOmissionRecord = {
    compositionId: input.compositionId,
    duration,
    eventKey: input.eventKey,
    id,
    kind: input.kind,
    originalTimelineStart: input.timelineStart,
    restoreClipIds,
    restoreSegments,
    restoreState: input.restoreState,
    text: input.text,
    timelineEnd: input.timelineStart + duration,
    timelineStart: input.timelineStart,
  };
  records.set(id, record);
  runtime.recordsByComposition.set(input.compositionId, records);
  publishComposition(input.compositionId);
  return record;
}

function insertCaptionTime(start: number, duration: number): void {
  useTimelineStore.setState(state => ({
    clips: state.clips.map(clip => {
      if (!clip.captionProperties) return clip;
      const clipEnd = clip.startTime + clip.duration;
      if (clipEnd <= start + POSITION_EPSILON) return clip;
      if (clip.startTime >= start - POSITION_EPSILON) {
        return { ...clip, startTime: clip.startTime + duration };
      }
      return {
        ...clip,
        duration: clip.duration + duration,
        outPoint: clip.outPoint + duration,
        source: clip.source
          ? { ...clip.source, naturalDuration: (clip.source.naturalDuration ?? clip.duration) + duration }
          : clip.source,
      };
    }),
  }));
}

export function restoreTranscriptReviewOmission(
  compositionId: string,
  omissionId: string,
): { error?: string; ok: boolean } {
  const records = runtime.recordsByComposition.get(compositionId);
  const record = records?.get(omissionId);
  if (!record) return { ok: false, error: 'The removed transcript range is no longer available.' };

  const initial = useTimelineStore.getState();
  if (!isTranscriptReviewOmissionRemoved(record, initial.clips)) {
    return { ok: true };
  }
  const trackIds = new Set(record.restoreState.timeline.clips.map(
    (clip: HistoryTimelineClipEditState) => clip.trackId,
  ));
  const missingTrack = [...trackIds].find(trackId => !initial.tracks.some(track => track.id === trackId));
  const lockedTrack = initial.tracks.find(track => trackIds.has(track.id) && track.locked);
  if (missingTrack) return { ok: false, error: 'A source track for this range no longer exists.' };
  if (lockedTrack) return { ok: false, error: `Track "${lockedTrack.name}" is locked.` };

  const batch = startBatch('Restore transcript range');
  try {
    const insertionTime = record.timelineStart;
    useTimelineStore.setState(state => ({
      clips: state.clips.map(clip => (
        trackIds.has(clip.trackId) && clip.startTime >= insertionTime - POSITION_EPSILON
          ? { ...clip, startTime: clip.startTime + record.duration }
          : clip
      )),
    }));
    insertCaptionTime(insertionTime, record.duration);

    const offset = insertionTime - record.originalTimelineStart;
    const restoreState: HistoryTimelineEditState = {
      ...record.restoreState,
      timeline: {
        ...record.restoreState.timeline,
        clips: record.restoreState.timeline.clips.map((clip: HistoryTimelineClipEditState) => ({
          ...clip,
          startTime: clip.startTime + offset,
          transitionIn: undefined,
          transitionOut: undefined,
        })),
      },
    };
    const current = useTimelineStore.getState();
    const restored = createHistoryTimelineRestoreState(restoreState, current).state;
    const activeComposition = useMediaStore.getState().getActiveComposition();
    const mediaState = useMediaStore.getState();
    const restoredClips = rehydrateHistoryGeneratedTimelineRuntimes(
      restored.clips.map(clip => {
        const mediaFile = mediaState.files.find(file => file.id === clip.mediaFileId);
        return mediaFile
          ? bindRuntimeToClip({
              ...clip,
              file: mediaFile.file ?? clip.file,
              needsReload: mediaFile.file ? false : clip.needsReload,
            }, {
              file: mediaFile.file,
              filePath: mediaFile.absolutePath ?? mediaFile.filePath,
              mediaFileId: mediaFile.id,
            })
          : clip;
      }),
      activeComposition
        ? { height: activeComposition.height, width: activeComposition.width }
        : undefined,
    );
    const restoredIds = new Set(restoredClips.map(clip => clip.id));
    if (current.clips.some(clip => restoredIds.has(clip.id))) {
      throw new Error('One or more removed clip segments already exist.');
    }
    useTimelineStore.setState(state => ({
      clipKeyframes: new Map([
        ...state.clipKeyframes,
        ...restored.clipKeyframes,
      ]),
      clips: [...state.clips, ...restoredClips],
    }));
    syncHistoryRehydratedTimelineRuntimeResources(restoredClips);

    for (const candidate of records?.values() ?? []) {
      if (candidate.id !== omissionId && candidate.timelineStart >= insertionTime - POSITION_EPSILON) {
        candidate.timelineStart += record.duration;
        candidate.timelineEnd += record.duration;
      }
    }
    publishComposition(compositionId);

    const fades = collectMissingAudioJunctionFadeTargets(useTimelineStore.getState().clips);
    applyAutomaticAudioFades(fades, DEFAULT_AUTOMATIC_DE_CLICK_FADE_SECONDS);
    const finalState = useTimelineStore.getState();
    finalState.updateDuration();
    finalState.setPlayheadPosition(insertionTime);
    finalState.invalidateCache();
    layerBuilder.invalidateCache();
    renderHostPort.requestNewFrameRender();
    if (batch.opened) endBatch();
    return { ok: true };
  } catch (error) {
    if (batch.opened) cancelHistoryBatch();
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The transcript range could not be restored.',
    };
  }
}

export function remapTranscriptReviewOmissionsForMove(input: {
  compositionId: string;
  end: number;
  start: number;
  target: number;
}): void {
  const records = runtime.recordsByComposition.get(input.compositionId);
  if (!records || input.target >= input.start && input.target <= input.end) return;
  const duration = input.end - input.start;
  for (const record of records.values()) {
    const time = record.timelineStart;
    let nextTime = time;
    if (time >= input.start - POSITION_EPSILON && time < input.end - POSITION_EPSILON) {
      nextTime = input.target < input.start
        ? input.target + (time - input.start)
        : input.target - duration + (time - input.start);
    } else if (input.target < input.start && time >= input.target && time < input.start) {
      nextTime = time + duration;
    } else if (input.target > input.end && time >= input.end && time < input.target) {
      nextTime = time - duration;
    }
    record.timelineStart = nextTime;
    record.timelineEnd = nextTime + record.duration;
  }
  publishComposition(input.compositionId);
}

export function cloneTranscriptReviewEdits(
  sourceCompositionId: string,
  targetCompositionId: string,
  mappings?: {
    clipIds?: Readonly<Record<string, string>>;
    trackIds?: Readonly<Record<string, string>>;
  },
): void {
  const sourceRecords = runtime.recordsByComposition.get(sourceCompositionId);
  if (!sourceRecords || sourceRecords.size === 0) return;
  runtime.recordsByComposition.set(
    targetCompositionId,
    new Map([...sourceRecords].map(([id, record]) => {
      const clone = structuredClone(record);
      const clipIds = mappings?.clipIds ?? {};
      const trackIds = mappings?.trackIds ?? {};
      clone.compositionId = targetCompositionId;
      clone.restoreClipIds = clone.restoreClipIds.map(clipId => clipIds[clipId] ?? clipId).toSorted();
      clone.restoreSegments = clone.restoreSegments.map(segment => ({
        ...segment,
        trackId: trackIds[segment.trackId] ?? segment.trackId,
      }));
      clone.restoreState.timeline.clipKeyframes = Object.fromEntries(
        Object.entries(clone.restoreState.timeline.clipKeyframes).map(([clipId, keyframes]) => [
          clipIds[clipId] ?? clipId,
          keyframes,
        ]),
      );
      clone.restoreState.timeline.clips = clone.restoreState.timeline.clips.map(
        (clip: HistoryTimelineClipEditState) => ({
          ...clip,
          id: clipIds[clip.id] ?? clip.id,
          trackId: trackIds[clip.trackId] ?? clip.trackId,
          ...(clip.linkedClipId === undefined
            ? {}
            : { linkedClipId: clipIds[clip.linkedClipId] ?? clip.linkedClipId }),
        }),
      );
      clone.restoreState.timeline.tracks = clone.restoreState.timeline.tracks.map(
        (track: HistoryTimelineTrackEditState) => ({
        ...track,
        id: trackIds[track.id] ?? track.id,
        ...(track.parentTrackId === undefined
          ? {}
          : { parentTrackId: trackIds[track.parentTrackId] ?? track.parentTrackId }),
        }),
      );
      return [id, clone];
    })),
  );
  publishComposition(targetCompositionId);
}
