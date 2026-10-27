// Places imported phone media on the timeline. Planning is pure (tested on its own); execution
// uses the timeline's own addClip and runs as ONE undo step.
//
// Append: visual media go one after another to the end of the main track (the lowest video track,
// which the phone timeline emphasises); audio files go to the end of the first audio track.
// Overlay: everything starts at the playhead, visual media on a free video track above the main one.
// Each next clip starts at the ACTUAL end of the clip created before it on the same lane.

import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import type { FileImportResult, MediaFile } from '../../../stores/mediaStore/types';
import type { AddClipOptions } from '../../../stores/timeline/storeTypes/clipActionTypes';
import { DEFAULT_IMAGE_DURATION } from '../../../stores/timeline/constants';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../../services/logger';
import { runEditorBatch } from '../../../services/project/repository/transaction/editorMutationRuntime';
import {
  getTimelineDropMediaTypeOverride,
  resolveMediaFileForTimelineDrop,
} from '../../../services/timeline/timelineExternalDropMediaResolver';
import {
  createSignalTimelineAdapterPlan,
  placeSignalAssetOnTimeline,
} from '../../../runtime/renderers/signalTimelineRendererAdapter';

const log = Logger.create('PhoneMediaPlacement');

export type PhonePlacementMode = 'append' | 'overlay';
export type PhonePlacementLane = 'visual' | 'audio';

export interface PhonePlacementRequest {
  key: string;
  lane: PhonePlacementLane;
  /** Expected duration in seconds; execution replaces it with the created clip's real length. */
  duration: number;
}

export interface PhonePlacementTimeline {
  tracks: readonly Pick<TimelineTrack, 'id' | 'type' | 'locked'>[];
  clips: readonly Pick<TimelineClip, 'trackId' | 'startTime' | 'duration'>[];
  playhead: number;
}

export interface PhonePlacementLaneTarget {
  /** Existing track, or null when a new track of `createTrack` type must be added first. */
  trackId: string | null;
  createTrack: 'video' | 'audio' | null;
  startTime: number;
}

export interface PhonePlacementStep {
  key: string;
  lane: PhonePlacementLane;
  /** Planned start; execution uses the actual end of the previous clip on the same lane. */
  startTime: number;
}

export interface PhonePlacementPlan {
  mode: PhonePlacementMode;
  lanes: Record<PhonePlacementLane, PhonePlacementLaneTarget>;
  steps: PhonePlacementStep[];
}

const EPSILON = 1e-6;

function usable(track: Pick<TimelineTrack, 'type' | 'locked'>, type: 'video' | 'audio'): boolean {
  return track.type === type && !track.locked;
}

/** The phone's main track: the lowest (last in store order) unlocked video track. */
export function findPhoneMainVideoTrackId(tracks: PhonePlacementTimeline['tracks']): string | null {
  return tracks.findLast((track) => usable(track, 'video'))?.id ?? null;
}

function trackEnd(timeline: PhonePlacementTimeline, trackId: string): number {
  return timeline.clips.reduce(
    (end, clip) => (clip.trackId === trackId ? Math.max(end, clip.startTime + clip.duration) : end),
    0,
  );
}

function isTrackFree(timeline: PhonePlacementTimeline, trackId: string, start: number, end: number): boolean {
  return !timeline.clips.some(
    (clip) => clip.trackId === trackId && clip.startTime < end - EPSILON && clip.startTime + clip.duration > start + EPSILON,
  );
}

function sumDuration(requests: readonly PhonePlacementRequest[], lane: PhonePlacementLane): number {
  return requests.reduce((total, request) => (request.lane === lane ? total + request.duration : total), 0);
}

function appendTarget(timeline: PhonePlacementTimeline, trackId: string | null, type: 'video' | 'audio'): PhonePlacementLaneTarget {
  return trackId
    ? { trackId, createTrack: null, startTime: trackEnd(timeline, trackId) }
    : { trackId: null, createTrack: type, startTime: 0 };
}

function overlayVisualTarget(timeline: PhonePlacementTimeline, total: number): PhonePlacementLaneTarget {
  const start = Math.max(0, timeline.playhead);
  const mainId = findPhoneMainVideoTrackId(timeline.tracks);
  const mainIndex = mainId ? timeline.tracks.findIndex((track) => track.id === mainId) : -1;
  // Nearest free track above the main one first; addTrack('video') inserts at the top otherwise.
  for (let index = mainIndex - 1; index >= 0; index -= 1) {
    const track = timeline.tracks[index];
    if (usable(track, 'video') && isTrackFree(timeline, track.id, start, start + total)) {
      return { trackId: track.id, createTrack: null, startTime: start };
    }
  }
  return { trackId: null, createTrack: 'video', startTime: start };
}

function overlayAudioTarget(timeline: PhonePlacementTimeline, total: number): PhonePlacementLaneTarget {
  const start = Math.max(0, timeline.playhead);
  const free = timeline.tracks.find((track) => usable(track, 'audio') && isTrackFree(timeline, track.id, start, start + total));
  return free ? { trackId: free.id, createTrack: null, startTime: start } : { trackId: null, createTrack: 'audio', startTime: start };
}

/** Pure placement plan in pick order. */
export function planPhoneMediaPlacement(
  requests: readonly PhonePlacementRequest[],
  timeline: PhonePlacementTimeline,
  mode: PhonePlacementMode,
): PhonePlacementPlan {
  const lanes: Record<PhonePlacementLane, PhonePlacementLaneTarget> = mode === 'append'
    ? {
      visual: appendTarget(timeline, findPhoneMainVideoTrackId(timeline.tracks), 'video'),
      audio: appendTarget(timeline, timeline.tracks.find((track) => usable(track, 'audio'))?.id ?? null, 'audio'),
    }
    : {
      visual: overlayVisualTarget(timeline, sumDuration(requests, 'visual')),
      audio: overlayAudioTarget(timeline, sumDuration(requests, 'audio')),
    };
  const cursor: Record<PhonePlacementLane, number> = { visual: lanes.visual.startTime, audio: lanes.audio.startTime };
  const steps = requests.map((request): PhonePlacementStep => {
    const startTime = cursor[request.lane];
    cursor[request.lane] = startTime + request.duration;
    return { key: request.key, lane: request.lane, startTime };
  });
  return { mode, lanes, steps };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface PhonePlaceableMedia {
  name: string;
  result: FileImportResult;
}

export interface PhonePlacementFailure {
  name: string;
  message: string;
}

export interface PhonePlacementOutcome {
  clipIds: string[];
  failures: PhonePlacementFailure[];
}

function positive(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Lane and expected duration of an import result; images get the default still duration. */
export function describePhonePlacement(result: FileImportResult): { lane: PhonePlacementLane; duration: number } {
  if (result.type === 'signal') return { lane: 'visual', duration: createSignalTimelineAdapterPlan(result).duration };
  if (result.type === 'audio') return { lane: 'audio', duration: positive(result.duration) ?? DEFAULT_IMAGE_DURATION };
  if (result.type === 'image') return { lane: 'visual', duration: DEFAULT_IMAGE_DURATION };
  return { lane: 'visual', duration: positive(result.duration) ?? DEFAULT_IMAGE_DURATION };
}

function visualOptions(media: MediaFile): AddClipOptions | undefined {
  // Fit keeps the whole picture visible when its aspect differs from the canvas (e.g. 16:9 in 9:16).
  return media.type === 'video' || media.type === 'image' ? { visualScaleMode: 'fit' } : undefined;
}

async function placeOne(item: PhonePlaceableMedia, trackId: string, startTime: number, duration: number): Promise<string | null> {
  const timeline = useTimelineStore.getState();
  if (item.result.type === 'signal') {
    const placed = await placeSignalAssetOnTimeline(item.result, trackId, startTime, timeline);
    if (placed.fallbackReason) log.warn('Signal asset placed with a fallback', { name: item.name, reason: placed.fallbackReason });
    return placed.clipId;
  }
  const media = useMediaStore.getState().files.find((file) => file.id === item.result.id) ?? item.result;
  const file = await resolveMediaFileForTimelineDrop(media);
  if (!file) throw new Error('its source file is not available in this tab');
  const clipId = await timeline.addClip(
    trackId, file, startTime, duration, media.id, getTimelineDropMediaTypeOverride(media), visualOptions(media),
  );
  return clipId ?? null;
}

async function runPlacementSteps(
  items: readonly PhonePlaceableMedia[],
  requests: readonly PhonePlacementRequest[],
  mode: PhonePlacementMode,
  outcome: PhonePlacementOutcome,
): Promise<void> {
  const state = useTimelineStore.getState();
  const plan = planPhoneMediaPlacement(requests, { tracks: state.tracks, clips: state.clips, playhead: state.playheadPosition }, mode);
  const trackIds: Partial<Record<PhonePlacementLane, string>> = {};
  const cursor: Partial<Record<PhonePlacementLane, number>> = {};
  const laneTrack = (lane: PhonePlacementLane): string => {
    const existing = trackIds[lane];
    if (existing) return existing;
    const target = plan.lanes[lane];
    const id = target.trackId ?? useTimelineStore.getState().addTrack(target.createTrack ?? (lane === 'audio' ? 'audio' : 'video'));
    trackIds[lane] = id;
    return id;
  };

  for (const [index, step] of plan.steps.entries()) {
    const item = items[index];
    const request = requests[index];
    const startTime = cursor[step.lane] ?? step.startTime;
    try {
      const clipId = await placeOne(item, laneTrack(step.lane), startTime, request.duration);
      if (!clipId) throw new Error('the timeline did not accept it');
      const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
      cursor[step.lane] = clip ? clip.startTime + clip.duration : startTime + request.duration;
      outcome.clipIds.push(clipId);
    } catch (error) {
      // A failed item leaves no gap: the next one starts where this one would have.
      cursor[step.lane] = startTime;
      const message = error instanceof Error ? error.message : String(error);
      log.warn('Phone media placement failed', { name: item.name, message });
      outcome.failures.push({ name: item.name, message: `${item.name} could not be placed: ${message}.` });
    }
  }
}

/** Places the imported media in pick order as one undo step; failures are returned, never thrown. */
export async function placePhoneMedia(
  items: readonly PhonePlaceableMedia[],
  mode: PhonePlacementMode,
): Promise<PhonePlacementOutcome> {
  const outcome: PhonePlacementOutcome = { clipIds: [], failures: [] };
  if (items.length === 0) return outcome;
  const requests = items.map((item, index) => ({ key: String(index), ...describePhonePlacement(item.result) }));
  const label = items.length === 1 ? 'Add media' : `Add ${items.length} media`;
  try {
    await runEditorBatch(label, () => runPlacementSteps(items, requests, mode, outcome));
  } catch (error) {
    log.error('Phone media placement batch failed', error);
    outcome.failures.push({
      name: '',
      message: `Adding media to the timeline failed: ${error instanceof Error ? error.message : String(error)}.`,
    });
  }
  return outcome;
}
