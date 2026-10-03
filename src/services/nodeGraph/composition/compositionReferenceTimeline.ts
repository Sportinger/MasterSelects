import type { TimelineClip, TimelineClipDataSource, TimelineTrack } from '../../../types/timeline';

/** Projection fixture, never insert these records into the runtime store. No File/DOM handles. */
export type CompositionReferenceClip = Omit<TimelineClip, 'file' | 'source'> & {
  source: TimelineClipDataSource;
};

export interface CompositionReferenceTimelineOptions {
  /** Number of video pieces; linked audio adds the same number of timeline records. */
  clipCount: number;
  /** Number of video/audio track pairs. */
  trackCount?: number;
  mediaFileId?: string;
  mediaDuration?: number;
  clipDuration?: number;
  idPrefix?: string;
  linkedAudio?: boolean;
  transitionCount?: number;
}

/** Deterministic, JSON-only reference data; no store, clock, random, or runtime dependencies. */
export function createCompositionReferenceTimeline(options: CompositionReferenceTimelineOptions) {
  const { clipCount, trackCount = 3, mediaFileId = 'reference-media', mediaDuration = 60,
    clipDuration = 2, idPrefix = 'reference', linkedAudio = true, transitionCount = 3 } = options;
  if (!Number.isSafeInteger(clipCount) || clipCount < 0
    || !Number.isSafeInteger(trackCount) || trackCount < 1
    || !Number.isSafeInteger(transitionCount) || transitionCount < 0
    || !Number.isFinite(mediaDuration) || mediaDuration <= 0
    || !Number.isFinite(clipDuration) || clipDuration <= 0) {
    throw new RangeError('Reference sizes must be valid integers and durations must be finite and positive.');
  }
  const tracks: TimelineTrack[] = [];
  for (const type of linkedAudio ? ['video', 'audio'] as const : ['video'] as const) {
    for (let index = 0; index < trackCount; index++) tracks.push({
      id: `${idPrefix}-${type}-track-${index}`, name: `${type} ${index + 1}`, type,
      height: 60, muted: false, visible: true, solo: false, locked: false,
    });
  }
  const clips: CompositionReferenceClip[] = [];
  const videoClips: CompositionReferenceClip[] = [];
  const ends = Array<number>(trackCount).fill(0);
  const windowLength = Math.min(clipDuration, mediaDuration / 2);
  for (let index = 0; index < clipCount; index++) {
    const lane = index % trackCount;
    const speed = index % 11 === 5 ? -1 : index % 7 === 3 ? 2 : index % 13 === 7 ? 0.5 : 1;
    const inPoint = (index % 5) / 5 * (mediaDuration - windowLength);
    const duration = windowLength / Math.abs(speed);
    const videoId = `${idPrefix}-video-${index}`;
    const audioId = `${idPrefix}-audio-${index}`;
    const video: CompositionReferenceClip = {
      id: videoId, trackId: `${idPrefix}-video-track-${lane}`, name: `Piece ${index + 1}`,
      mediaFileId, startTime: ends[lane], duration, inPoint, outPoint: inPoint + windowLength,
      speed, reversed: speed < 0, source: { type: 'video', mediaFileId, naturalDuration: mediaDuration },
      transform: { opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 }, rotation: { x: 0, y: 0, z: 0 } },
      effects: [], ...(linkedAudio ? { linkedClipId: audioId } : {}),
    };
    clips.push(video);
    videoClips.push(video);
    if (linkedAudio) clips.push({
      ...video, id: audioId, trackId: `${idPrefix}-audio-track-${lane}`, name: `${video.name} (Audio)`,
      linkedClipId: videoId, followsLinkedVideoSpeed: true,
      source: { type: 'audio', mediaFileId, naturalDuration: mediaDuration },
      transform: { ...video.transform, position: { ...video.transform.position },
        scale: { ...video.transform.scale }, rotation: { ...video.transform.rotation } }, effects: [],
    });
    ends[lane] += duration;
  }
  // Adjacent pieces on each lane; mirrored recipe records, never materialized compositions.
  let transitions = 0;
  for (let index = 0; index + trackCount < videoClips.length && transitions < transitionCount; index++) {
    const outgoing = videoClips[index], incoming = videoClips[index + trackCount];
    if (outgoing.transitionIn || outgoing.transitionOut || incoming.transitionIn) continue;
    const transition = { id: `${idPrefix}-transition-${transitions++}`, type: 'crossfade',
      duration: Math.min(0.25, outgoing.duration / 2, incoming.duration / 2), offset: 0 };
    outgoing.transitionOut = { ...transition, linkedClipId: incoming.id };
    incoming.transitionIn = { ...transition, linkedClipId: outgoing.id };
  }
  return { clips, tracks, duration: Math.max(0, ...ends), videoClipCount: clipCount,
    timelineClipCount: clips.length, transitionCount: transitions, mediaFileId, mediaDuration };
}
