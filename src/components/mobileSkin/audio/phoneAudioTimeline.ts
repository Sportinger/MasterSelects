// Pure timeline rules of the phone Audio sheet (tested in phoneAudioTimeline.test.ts):
// which audio track a voiceover records onto, and which video clip "Extract audio" separates.

import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

const EPSILON = 1e-6;

type LaneTrack = Pick<TimelineTrack, 'id' | 'type' | 'locked' | 'visible'>;
type LaneClip = Pick<TimelineClip, 'id' | 'name' | 'trackId' | 'startTime' | 'duration' | 'linkedClipId'>;

/**
 * Voiceover target: the first unlocked audio track that is empty from `time` to the end, so the
 * take (whose length is unknown while recording) never lands on another clip. Null = add a track.
 */
export function findVoiceoverTrackId(tracks: readonly LaneTrack[], clips: readonly LaneClip[], time: number): string | null {
  const free = tracks.find((track) => track.type === 'audio' && !track.locked
    && !clips.some((clip) => clip.trackId === track.id && clip.startTime + clip.duration > time + EPSILON));
  return free?.id ?? null;
}

export interface PhoneExtractTarget {
  videoClipId: string;
  audioClipId: string;
  name: string;
}

export type PhoneExtractResolution =
  | { kind: 'ready'; target: PhoneExtractTarget }
  | { kind: 'none'; reason: string };

function linkedAudio(clip: LaneClip, clips: readonly LaneClip[], tracks: readonly LaneTrack[]): LaneClip | null {
  if (!clip.linkedClipId) return null;
  const audio = clips.find((candidate) => candidate.id === clip.linkedClipId);
  const track = audio ? tracks.find((candidate) => candidate.id === audio.trackId) : undefined;
  return audio && track?.type === 'audio' ? audio : null;
}

/**
 * "Extract audio" works on the selected video clip, or (nothing selected, the Audio sheet's root
 * scope) on the video clip under the playhead on the top-most visible video track.
 */
export function resolvePhoneExtractTarget(
  tracks: readonly LaneTrack[],
  clips: readonly LaneClip[],
  selectedIds: readonly string[],
  playhead: number,
): PhoneExtractResolution {
  const isVideoClip = (clip: LaneClip) => tracks.find((track) => track.id === clip.trackId)?.type === 'video';
  const selectedVideo = clips.filter((clip) => selectedIds.includes(clip.id) && isVideoClip(clip));
  const candidates = selectedVideo.length > 0
    ? selectedVideo
    : tracks
      .filter((track) => track.type === 'video' && track.visible !== false)
      .flatMap((track) => clips.filter((clip) => clip.trackId === track.id
        && playhead >= clip.startTime - EPSILON && playhead < clip.startTime + clip.duration - EPSILON));
  if (candidates.length === 0) {
    return { kind: 'none', reason: 'Move the playhead onto a video clip with sound, then extract its audio.' };
  }
  for (const clip of candidates) {
    const audio = linkedAudio(clip, clips, tracks);
    if (!audio) continue;
    const audioTrack = tracks.find((track) => track.id === audio.trackId);
    const videoTrack = tracks.find((track) => track.id === clip.trackId);
    if (audioTrack?.locked || videoTrack?.locked) {
      return { kind: 'none', reason: `${clip.name} is on a locked track. Unlock it in the full editor first.` };
    }
    return { kind: 'ready', target: { videoClipId: clip.id, audioClipId: audio.id, name: clip.name } };
  }
  return {
    kind: 'none',
    reason: `${candidates[0].name} has no linked sound to extract: its audio is already a separate clip, or the video has no sound.`,
  };
}

/** m:ss.cc for the sheet's status lines. */
export function formatPhoneAudioTime(seconds: number): string {
  const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(value / 60);
  const rest = value - minutes * 60;
  return `${minutes}:${rest.toFixed(2).padStart(5, '0')}`;
}
