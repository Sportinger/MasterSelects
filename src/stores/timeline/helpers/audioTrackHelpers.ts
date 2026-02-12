// Audio track creation helper - eliminates 3x duplication in clip loading
// Handles finding/creating audio tracks and creating audio clips for compositions

import type { TimelineTrack, TimelineClip } from '../../../types';
import { DEFAULT_TRANSFORM } from '../constants';

export interface FindOrCreateAudioTrackResult {
  trackId: string;
  newTrack: TimelineTrack | null;
}

/**
 * Find existing audio track without overlap or create a new one.
 * Used for linked audio clips from video and composition clips.
 */
export function findOrCreateAudioTrack(
  tracks: TimelineTrack[],
  clips: TimelineClip[],
  startTime: number,
  duration: number,
  preferredId?: string
): FindOrCreateAudioTrackResult {
  const endTime = startTime + duration;

  // Try to use preferred track if provided (only if no overlap)
  if (preferredId) {
    const preferred = tracks.find(t => t.id === preferredId && t.type === 'audio');
    if (preferred) {
      const trackClips = clips.filter(c => c.trackId === preferred.id);
      const hasOverlap = trackClips.some(c => {
        const clipEnd = c.startTime + c.duration;
        return !(endTime <= c.startTime || startTime >= clipEnd);
      });
      if (!hasOverlap) {
        return { trackId: preferred.id, newTrack: null };
      }
    }
  }

  // Find first audio track without overlap
  const audioTracks = tracks.filter(t => t.type === 'audio');
  for (const track of audioTracks) {
    const trackClips = clips.filter(c => c.trackId === track.id);
    const hasOverlap = trackClips.some(c => {
      const clipEnd = c.startTime + c.duration;
      return !(endTime <= c.startTime || startTime >= clipEnd);
    });
    if (!hasOverlap) {
      return { trackId: track.id, newTrack: null };
    }
  }

  // All audio tracks have overlap — create new one
  const audioCount = audioTracks.length;
  const newTrackId = `track-${Date.now()}-audio`;
  const newTrack: TimelineTrack = {
    id: newTrackId,
    name: `Audio ${audioCount + 1}`,
    type: 'audio',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  };

  return { trackId: newTrackId, newTrack };
}

export interface CreateCompAudioClipParams {
  clipId: string;
  trackId: string;
  compositionName: string;
  compositionId: string;
  startTime: number;
  duration: number;
  audioElement?: HTMLAudioElement;
  waveform?: number[];
  mixdownBuffer?: AudioBuffer;
  hasAudio?: boolean;
  linkedClipId?: string;
}

/**
 * Create an audio clip from a composition mixdown or as silent placeholder.
 */
export function createCompositionAudioClip(params: CreateCompAudioClipParams): TimelineClip {
  const {
    clipId,
    trackId,
    compositionName,
    compositionId,
    startTime,
    duration,
    audioElement,
    waveform,
    mixdownBuffer,
    linkedClipId,
  } = params;

  return {
    id: clipId,
    trackId,
    name: `${compositionName} (Audio)`,
    file: new File([], `${compositionName}-audio.wav`),
    startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: {
      type: 'audio',
      audioElement: audioElement || document.createElement('audio'),
      naturalDuration: duration,
    },
    linkedClipId,
    waveform: waveform || generateSilentWaveform(duration),
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
    isComposition: true,
    compositionId,
    mixdownBuffer,
  };
}

// Note: generateSilentWaveform is imported from waveformHelpers to avoid duplication
import { generateSilentWaveform } from './waveformHelpers';
