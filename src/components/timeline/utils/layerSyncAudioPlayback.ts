import type { TimelineClip, TimelineTrack } from '../../../types';
import { audioManager, audioStatusTracker } from '../../../services/audioManager';
import { Logger } from '../../../services/logger';
import { shouldUseInlineCompositionMixdown } from '../../../services/timeline/compositionAudioClipLinks';

const log = Logger.create('useLayerSync');

interface SyncLayerAudioPlaybackParams {
  audioTracks: TimelineTrack[];
  clips: TimelineClip[];
  clipsAtTime: TimelineClip[];
  getInterpolatedSpeed: (clipId: string, localTime: number) => number;
  getSourceTimeForClip: (clipId: string, localTime: number) => number;
  isAudioTrackMuted: (track: TimelineTrack) => boolean;
  isDraggingPlayhead: boolean;
  isPlaying: boolean;
  isVideoTrackVisible: (track: TimelineTrack) => boolean;
  playheadPosition: number;
  videoTracks: TimelineTrack[];
}

function getClipPlaybackTime(
  clip: TimelineClip,
  clipLocalTime: number,
  getInterpolatedSpeed: (clipId: string, localTime: number) => number,
  getSourceTimeForClip: (clipId: string, localTime: number) => number,
): number {
  const sourceTime = getSourceTimeForClip(clip.id, clipLocalTime);
  const initialSpeed = getInterpolatedSpeed(clip.id, 0);
  const startPoint = initialSpeed >= 0 ? clip.inPoint : clip.outPoint;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, startPoint + sourceTime));
}

function syncAudioPlaybackRate(audio: HTMLAudioElement, absSpeed: number): void {
  const targetRate = absSpeed > 0.1 ? absSpeed : 1;
  if (Math.abs(audio.playbackRate - targetRate) > 0.01) {
    audio.playbackRate = Math.max(0.25, Math.min(4, targetRate));
  }
}

function syncPreservesPitch(audio: HTMLAudioElement, clip: TimelineClip): void {
  const shouldPreservePitch = clip.preservesPitch !== false;
  const pitchAwareAudio = audio as HTMLAudioElement & { preservesPitch?: boolean };
  if (pitchAwareAudio.preservesPitch !== shouldPreservePitch) {
    pitchAwareAudio.preservesPitch = shouldPreservePitch;
  }
}

function pauseInactiveAudioClips(clips: TimelineClip[], clipsAtTime: TimelineClip[]): void {
  clips.forEach((clip) => {
    const isAtPlayhead = clipsAtTime.some((currentClip) => currentClip.id === clip.id);
    if (clip.source?.audioElement && !isAtPlayhead && !clip.source.audioElement.paused) {
      clip.source.audioElement.pause();
    }
    if (clip.mixdownAudio && !isAtPlayhead && !clip.mixdownAudio.paused) {
      clip.mixdownAudio.pause();
    }
  });
}

export function syncLayerAudioPlayback({
  audioTracks,
  clips,
  clipsAtTime,
  getInterpolatedSpeed,
  getSourceTimeForClip,
  isAudioTrackMuted,
  isDraggingPlayhead,
  isPlaying,
  isVideoTrackVisible,
  playheadPosition,
  videoTracks,
}: SyncLayerAudioPlaybackParams): void {
  let audioPlayingCount = 0;
  let maxAudioDrift = 0;
  let hasAudioError = false;

  if (isPlaying && !isDraggingPlayhead) {
    audioManager.resume().catch(() => {});
  }

  audioTracks.forEach((track) => {
    const clip = clipsAtTime.find((candidate) => candidate.trackId === track.id);
    if (!clip?.source?.audioElement) return;

    const audio = clip.source.audioElement;
    const clipLocalTime = playheadPosition - clip.startTime;
    const currentSpeed = getInterpolatedSpeed(clip.id, clipLocalTime);
    const absSpeed = Math.abs(currentSpeed);
    const clipTime = getClipPlaybackTime(
      clip,
      clipLocalTime,
      getInterpolatedSpeed,
      getSourceTimeForClip,
    );
    const timeDiff = audio.currentTime - clipTime;

    if (Math.abs(timeDiff) > maxAudioDrift) {
      maxAudioDrift = Math.abs(timeDiff);
    }

    const effectivelyMuted = isAudioTrackMuted(track);
    audio.muted = effectivelyMuted;
    syncAudioPlaybackRate(audio, absSpeed);
    syncPreservesPitch(audio, clip);

    const shouldPlay = isPlaying && !effectivelyMuted && !isDraggingPlayhead && absSpeed > 0.1;
    if (shouldPlay) {
      if (Math.abs(timeDiff) > 0.2) {
        audio.currentTime = clipTime;
      }

      if (audio.paused) {
        audio.currentTime = clipTime;
        audio.play().catch((err) => {
          log.warn('Audio failed to play:', err.message);
          hasAudioError = true;
        });
      }

      if (!audio.paused && !effectivelyMuted) {
        audioPlayingCount++;
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  });

  pauseInactiveAudioClips(clips, clipsAtTime);

  clipsAtTime.forEach((clip) => {
    if (
      !shouldUseInlineCompositionMixdown(clips, clip) ||
      !clip.mixdownAudio ||
      !clip.hasMixdownAudio
    ) {
      return;
    }

    const audio = clip.mixdownAudio;
    const clipLocalTime = playheadPosition - clip.startTime;
    const currentSpeed = getInterpolatedSpeed(clip.id, clipLocalTime);
    const absSpeed = Math.abs(currentSpeed);
    const clipTime = getClipPlaybackTime(
      clip,
      clipLocalTime,
      getInterpolatedSpeed,
      getSourceTimeForClip,
    );
    const track = videoTracks.find(candidate => candidate.id === clip.trackId);
    const effectivelyMuted = track ? !isVideoTrackVisible(track) : false;
    audio.muted = effectivelyMuted;
    syncAudioPlaybackRate(audio, absSpeed);
    syncPreservesPitch(audio, clip);

    const timeDiff = audio.currentTime - clipTime;
    if (Math.abs(timeDiff) > maxAudioDrift) {
      maxAudioDrift = Math.abs(timeDiff);
    }

    const shouldPlay = isPlaying && !effectivelyMuted && !isDraggingPlayhead && absSpeed > 0.1;
    if (shouldPlay) {
      if (Math.abs(timeDiff) > 0.2) {
        audio.currentTime = clipTime;
      }

      if (audio.paused) {
        audio.currentTime = clipTime;
        audio.play().catch((err) => {
          log.warn('Nested Comp Audio failed to play:', err.message);
        });
      }

      if (!audio.paused && !effectivelyMuted) {
        audioPlayingCount++;
      }
    } else if (!audio.paused) {
      audio.pause();
    }
  });

  audioStatusTracker.updateStatus(audioPlayingCount, maxAudioDrift, hasAudioError);
}
