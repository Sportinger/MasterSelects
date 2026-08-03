import type { ClipAudioEditOperation, TimelineClip } from '../../types';

export const MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS = 0.02;

const AUDIO_JUNCTION_EPSILON = 0.001;
const AUDIO_FILE_EXTENSIONS = new Set([
  'aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma',
]);

export type AutomaticAudioFadeEdge = 'in' | 'out';

export interface AutomaticAudioFadeTarget {
  clipId: string;
  edge: AutomaticAudioFadeEdge;
}

function isAudioClip(clip: TimelineClip): boolean {
  const extension = (clip.file?.name || clip.name || '').split('.').pop()?.toLowerCase() ?? '';
  return clip.source?.type === 'audio'
    || clip.file?.type?.startsWith('audio/') === true
    || AUDIO_FILE_EXTENSIONS.has(extension);
}

export function collectLinkedDeletionIds(
  clips: readonly TimelineClip[],
  clipIds: readonly string[],
  withLinked: boolean,
): Set<string> {
  const ids = new Set(clipIds);
  if (!withLinked) return ids;
  for (const clip of clips) {
    if (ids.has(clip.id) && clip.linkedClipId) ids.add(clip.linkedClipId);
    if (clip.linkedClipId && ids.has(clip.linkedClipId)) ids.add(clip.id);
  }
  return ids;
}

export function collectAutomaticAudioFadeTargets(
  clips: readonly TimelineClip[],
  deletionIds: ReadonlySet<string>,
): AutomaticAudioFadeTarget[] {
  const targets = new Map<string, AutomaticAudioFadeTarget>();
  const deletedAudioClips = clips.filter((clip) => deletionIds.has(clip.id) && isAudioClip(clip));
  for (const deleted of deletedAudioClips) {
    const survivors = clips.filter((candidate) => (
      candidate.trackId === deleted.trackId
      && !deletionIds.has(candidate.id)
      && isAudioClip(candidate)
    ));
    const previous = survivors.find((candidate) => (
      Math.abs(candidate.startTime + candidate.duration - deleted.startTime) <= AUDIO_JUNCTION_EPSILON
    ));
    const next = survivors.find((candidate) => (
      Math.abs(candidate.startTime - (deleted.startTime + deleted.duration)) <= AUDIO_JUNCTION_EPSILON
    ));
    if (previous) targets.set(`${previous.id}:out`, { clipId: previous.id, edge: 'out' });
    if (next) targets.set(`${next.id}:in`, { clipId: next.id, edge: 'in' });
  }
  return [...targets.values()];
}

export function createAutomaticCutDeClickOperation(
  clip: TimelineClip,
  edge: AutomaticAudioFadeEdge,
  requestedDuration: number,
  identity: { createdAt: number; id: string },
): ClipAudioEditOperation | null {
  const timelineDuration = Math.min(
    MAX_AUTOMATIC_DE_CLICK_FADE_SECONDS,
    requestedDuration,
    clip.duration / 2,
  );
  const sourceSpan = Math.max(0, clip.outPoint - clip.inPoint);
  if (timelineDuration <= 0 || sourceSpan <= 0 || clip.duration <= 0) return null;

  const sourceDuration = timelineDuration / clip.duration * sourceSpan;
  const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
  const sourceAtTimelineStart = reversed ? clip.outPoint : clip.inPoint;
  const sourceAtTimelineEnd = reversed ? clip.inPoint : clip.outPoint;
  const range = edge === 'in'
    ? reversed
      ? { start: sourceAtTimelineStart - sourceDuration, end: sourceAtTimelineStart }
      : { start: sourceAtTimelineStart, end: sourceAtTimelineStart + sourceDuration }
    : reversed
      ? { start: sourceAtTimelineEnd, end: sourceAtTimelineEnd + sourceDuration }
      : { start: sourceAtTimelineEnd - sourceDuration, end: sourceAtTimelineEnd };
  const fadeTowardHigherSourceTime = (edge === 'out') !== reversed;
  const clipEnd = clip.startTime + clip.duration;

  return {
    id: identity.id,
    type: 'gain',
    enabled: true,
    params: {
      label: 'Automatic cut de-click',
      timelineStart: edge === 'in' ? clip.startTime : clipEnd - timelineDuration,
      timelineEnd: edge === 'in' ? clip.startTime + timelineDuration : clipEnd,
      preserveClipDuration: true,
      gainDb: -120,
      fadeInSeconds: fadeTowardHigherSourceTime ? sourceDuration : 0,
      fadeOutSeconds: fadeTowardHigherSourceTime ? 0 : sourceDuration,
    },
    timeRange: {
      start: Math.max(clip.inPoint, Math.min(clip.outPoint, Math.min(range.start, range.end))),
      end: Math.max(clip.inPoint, Math.min(clip.outPoint, Math.max(range.start, range.end))),
    },
    createdAt: identity.createdAt,
  };
}
