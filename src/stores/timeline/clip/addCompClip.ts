// Composition clip addition - extracted from addCompClip
// Handles nested composition loading, audio mixdown, and linked audio creation

import type { TimelineClip, TimelineTrack, CompositionTimelineData } from '../../../types';
import type { Composition } from '../types';
import { DEFAULT_TRANSFORM, calculateNativeScale } from '../constants';
import { findOrCreateAudioTrack, createCompositionAudioClip } from '../helpers/audioTrackHelpers';
import { generateCompClipId, generateClipId } from '../helpers/idGenerator';
import { Logger } from '../../../services/logger';
// Note: compositionRenderer is used elsewhere for cache invalidation

const log = Logger.create('AddCompClip');

// Store interaction types for composition clip operations
interface CompClipStoreState {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
}

type CompClipStoreGet = () => CompClipStoreState;
type CompClipStoreSet = (state: Partial<CompClipStoreState>) => void;

export interface AddCompClipParams {
  trackId: string;
  composition: Composition;
  startTime: number;
  findNonOverlappingPosition: (clipId: string, startTime: number, trackId: string, duration: number) => number;
}

/**
 * Create a content hash for nested composition change detection.
 */
export function createNestedContentHash(timelineData: CompositionTimelineData | undefined): string {
  if (!timelineData) return '';
  const clipData = timelineData.clips?.map((c) => ({
    id: c.id,
    inPoint: c.inPoint,
    outPoint: c.outPoint,
    startTime: c.startTime,
    effectCount: c.effects?.length ?? 0,
  })) ?? [];
  return JSON.stringify({
    clipCount: timelineData.clips?.length ?? 0,
    duration: timelineData.duration,
    clips: clipData,
  });
}

/**
 * Create placeholder composition clip immediately.
 */
export function createCompClipPlaceholder(params: AddCompClipParams): TimelineClip {
  const { trackId, composition, startTime, findNonOverlappingPosition } = params;

  const clipId = generateCompClipId();
  const compDuration = composition.timelineData?.duration ?? composition.duration;
  const finalStartTime = findNonOverlappingPosition(clipId, startTime, trackId, compDuration);

  // Create content hash for change detection
  const nestedContentHash = createNestedContentHash(composition.timelineData);

  return {
    id: clipId,
    trackId,
    name: composition.name,
    file: new File([], composition.name),
    startTime: finalStartTime,
    duration: compDuration,
    inPoint: 0,
    outPoint: compDuration,
    source: { type: 'video', naturalDuration: compDuration },
    transform: { ...DEFAULT_TRANSFORM, scale: calculateNativeScale(composition.width, composition.height) },
    effects: [],
    isLoading: true,
    isComposition: true,
    compositionId: composition.id,
    nestedClips: [],
    nestedTracks: [],
    nestedContentHash,
  };
}

export interface CreateCompLinkedAudioParams {
  compClipId: string;
  composition: Composition;
  compClipStartTime: number;
  compDuration: number;
  tracks: TimelineTrack[];
  set: CompClipStoreSet;
  get: CompClipStoreGet;
}

/**
 * Create linked audio clip for composition (with or without actual audio).
 * MERGED from 3 duplicate branches in original code.
 */
export async function createCompLinkedAudioClip(params: CreateCompLinkedAudioParams): Promise<void> {
  const { compClipId, composition, compClipStartTime, compDuration, tracks, set, get } = params;

  log.debug('Creating lazy linked audio placeholder for nested comp', {
    composition: composition.name,
    hasTimelineData: Boolean(composition.timelineData),
  });

  // Find or create audio track (with collision check)
  const { trackId: audioTrackId, newTrack } = findOrCreateAudioTrack(tracks, get().clips, compClipStartTime, compDuration);
  if (newTrack) {
    set({ tracks: [...get().tracks, newTrack] });
    log.debug('Created new audio track for nested comp', { composition: composition.name });
  }

  // Create audio clip
  const audioClipId = generateClipId('clip-comp-audio');
  const audioClip = createCompositionAudioClip({
    clipId: audioClipId,
    trackId: audioTrackId,
    compositionName: composition.name,
    compositionId: composition.id,
    startTime: compClipStartTime,
    duration: compDuration,
    hasAudio: false,
    linkedClipId: compClipId,
  });

  // Update comp clip and add audio clip
  const clipsAfter = get().clips;
  set({
    clips: [
      ...clipsAfter.map((c: TimelineClip) =>
        c.id === compClipId
          ? { ...c, linkedClipId: audioClipId, mixdownGenerating: false, hasMixdownAudio: false }
          : c
      ),
      audioClip,
    ],
  });

  log.debug('Created lazy linked audio clip for nested comp', { composition: composition.name });
}
