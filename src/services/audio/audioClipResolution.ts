import type { TimelineClip } from '../../types';

const AUDIO_FILE_EXTENSIONS = new Set([
  'wav',
  'mp3',
  'ogg',
  'flac',
  'aac',
  'm4a',
  'wma',
  'aiff',
  'opus',
]);

export interface ResolvedAudibleAudioClip {
  requestedClip: TimelineClip;
  audioClip: TimelineClip;
}

export function isAudioCapableTimelineClip(clip: TimelineClip): boolean {
  const fileName = clip.file?.name || clip.name || '';
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return clip.source?.type === 'audio'
    || clip.file?.type?.startsWith('audio/') === true
    || AUDIO_FILE_EXTENSIONS.has(extension);
}

export function resolveAudibleAudioClip(
  clips: readonly TimelineClip[],
  clipId: string,
): ResolvedAudibleAudioClip | null {
  const requestedClip = clips.find(clip => clip.id === clipId);
  if (!requestedClip) return null;

  const linkedClip = requestedClip.linkedClipId
    ? clips.find(clip => clip.id === requestedClip.linkedClipId)
    : null;
  if (linkedClip && isAudioCapableTimelineClip(linkedClip)) {
    return { requestedClip, audioClip: linkedClip };
  }

  if (isAudioCapableTimelineClip(requestedClip)) {
    return { requestedClip, audioClip: requestedClip };
  }

  const reciprocalLinkedAudioClip = clips.find(clip =>
    clip.linkedClipId === requestedClip.id && isAudioCapableTimelineClip(clip)
  );
  return reciprocalLinkedAudioClip
    ? { requestedClip, audioClip: reciprocalLinkedAudioClip }
    : null;
}

export function resolveAudibleAudioClipId(
  clips: readonly TimelineClip[],
  clipId: string,
): string | null {
  return resolveAudibleAudioClip(clips, clipId)?.audioClip.id ?? null;
}
