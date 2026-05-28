// Playback-related actions slice

import type { PlaybackActions, SliceCreator } from './types';
import { MIN_ZOOM, MAX_ZOOM, MIN_TRACK_HEADER_WIDTH, MAX_TRACK_HEADER_WIDTH } from './constants';
import { useMediaStore } from '../mediaStore';
import { engine } from '../../engine/WebGPUEngine';
import { getRuntimeFrameProvider } from '../../services/mediaRuntime/runtimePlayback';
import { playheadState, sanitizePlayheadPosition } from '../../services/layerBuilder/PlayheadState';
import { resolvePlaybackStartPosition } from './playbackRange';
import { prewarmProxyFramesForTimelinePosition } from '../../services/proxyFramePrewarm';
import { persistAudioLayerAdvancedMode } from './viewPreferences';

function createPlaybackWarmupRequestId(): string {
  return `playback-warmup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getWarmupTimestamp(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// Playback actions only (RAM preview and proxy cache in separate slices)
export const createPlaybackSlice: SliceCreator<PlaybackActions> = (set, get) => ({
  // Playback actions
  setPlayheadPosition: (position) => {
    const safePosition = sanitizePlayheadPosition(position, 0);
    const safeDuration = Math.max(0, sanitizePlayheadPosition(get().duration, safePosition));
    const clampedPosition = Math.max(0, Math.min(safePosition, safeDuration));

    set({ playheadPosition: clampedPosition });

    // Keep the render-path playhead in sync while paused. This also repairs
    // stale internal positions if playback stopped mid-frame.
    if (!get().isPlaying || !playheadState.isUsingInternalPosition) {
      playheadState.position = clampedPosition;
    }

    if (!get().isPlaying && !get().isDraggingPlayhead) {
      engine.requestNewFrameRender();
    }

    const latestState = get();
    if (!latestState.isPlaying) {
      prewarmProxyFramesForTimelinePosition(
        latestState,
        useMediaStore.getState().files,
        clampedPosition
      );
    }
  },

  setDraggingPlayhead: (dragging) => {
    set({ isDraggingPlayhead: dragging });
  },

  play: async () => {
    const { clips, inPoint, outPoint, duration, playbackSpeed } = get();
    set({ playbackWarmup: null });

    const playheadPosition = sanitizePlayheadPosition(
      get().playheadPosition,
      sanitizePlayheadPosition(playheadState.position, 0)
    );
    const playbackStartPosition = resolvePlaybackStartPosition(
      playheadPosition,
      inPoint,
      outPoint,
      duration,
      playbackSpeed,
    );

    if (playbackStartPosition !== playheadPosition) {
      set({ playheadPosition: playbackStartPosition });
      playheadState.position = playbackStartPosition;
    }

    const needsHtmlPlaybackReadiness = (
      source: (typeof clips)[number]['source'] | undefined
    ): source is NonNullable<(typeof clips)[number]['source']> & {
      videoElement: HTMLVideoElement;
    } => {
      if (!source?.videoElement) {
        return false;
      }

      const runtimeProvider = getRuntimeFrameProvider(source);
      const frameProvider =
        runtimeProvider?.isFullMode()
          ? runtimeProvider
          : source.webCodecsPlayer?.isFullMode()
            ? source.webCodecsPlayer
            : null;

      return !frameProvider?.isFullMode();
    };

    // Find all video clips at current playhead position that need to be ready
    const clipsAtPlayhead = clips.filter(clip => {
      const isAtPlayhead = playbackStartPosition >= clip.startTime &&
                           playbackStartPosition < clip.startTime + clip.duration;
      const hasVideo = needsHtmlPlaybackReadiness(clip.source);
      return isAtPlayhead && hasVideo;
    });

    // Also check nested composition clips
    const nestedVideos: HTMLVideoElement[] = [];
    for (const clip of clips) {
      if (clip.isComposition && clip.nestedClips) {
        const isAtPlayhead = playbackStartPosition >= clip.startTime &&
                             playbackStartPosition < clip.startTime + clip.duration;
        if (isAtPlayhead) {
          const compTime = playbackStartPosition - clip.startTime + clip.inPoint;
          for (const nestedClip of clip.nestedClips) {
            if (needsHtmlPlaybackReadiness(nestedClip.source)) {
              const isNestedAtTime = compTime >= nestedClip.startTime &&
                                     compTime < nestedClip.startTime + nestedClip.duration;
              if (isNestedAtTime) {
                nestedVideos.push(nestedClip.source.videoElement);
              }
            }
          }
        }
      }
    }

    // Collect all videos that need to be ready
    const videosToCheck = Array.from(new Set([
      ...clipsAtPlayhead.map(c => c.source!.videoElement!),
      ...nestedVideos
    ]));

    const videosNeedingWarmup = videosToCheck.filter((video) => video.readyState < 3);

    if (videosNeedingWarmup.length > 0) {
      const warmupRequestId = createPlaybackWarmupRequestId();
      set({
        playbackWarmup: {
          requestId: warmupRequestId,
          startedAt: getWarmupTimestamp(),
          targetTime: playbackStartPosition,
          pendingVideoCount: videosNeedingWarmup.length,
          totalVideoCount: videosToCheck.length,
        },
      });

      // Wait for all videos to be ready (readyState >= 3 means HAVE_FUTURE_DATA)
      const waitForReady = async (video: HTMLVideoElement): Promise<void> => {
        if (video.readyState >= 3) return;

        return new Promise((resolve) => {
          const checkReady = () => {
            if (video.readyState >= 3) {
              resolve();
              return;
            }
            // Trigger buffering by briefly playing
            video.play().then(() => {
              setTimeout(() => {
                video.pause();
                if (video.readyState >= 3) {
                  resolve();
                } else {
                  // Check again after a short delay
                  setTimeout(checkReady, 50);
                }
              }, 50);
            }).catch(() => {
              // If play fails, just wait for canplaythrough
              video.addEventListener('canplaythrough', () => resolve(), { once: true });
              setTimeout(resolve, 500); // Timeout fallback
            });
          };
          checkReady();
        });
      };

      // Wait for all videos in parallel with a timeout
      await Promise.race([
        Promise.all(videosNeedingWarmup.map(waitForReady)),
        new Promise(resolve => setTimeout(resolve, 1000)) // Max 1 second wait
      ]);

      if (get().playbackWarmup?.requestId !== warmupRequestId) {
        return;
      }
    }

    set({ playbackWarmup: null, isPlaying: true });
  },

  pause: () => {
    // Reset playback speed to normal when pausing
    // So that Space (play/pause toggle) plays forward again
    set({ isPlaying: false, playbackSpeed: 1, playbackWarmup: null });
  },

  stop: () => {
    set({ isPlaying: false, playheadPosition: 0, playbackWarmup: null });
  },

  // View actions
  setZoom: (zoom) => {
    set({ zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom)) });
  },

  setTrackHeaderWidth: (width) => {
    const nextWidth = Number.isFinite(width)
      ? Math.max(MIN_TRACK_HEADER_WIDTH, Math.min(MAX_TRACK_HEADER_WIDTH, width))
      : get().trackHeaderWidth;
    set({ trackHeaderWidth: nextWidth });
  },

  setTimelineSplitRatio: (ratio) => {
    if (ratio === null) {
      set({ timelineSplitRatio: null });
      return;
    }

    const nextRatio = Number.isFinite(ratio)
      ? Math.max(0, Math.min(1, ratio))
      : get().timelineSplitRatio;
    set({ timelineSplitRatio: nextRatio });
  },

  toggleSnapping: () => {
    set((state) => ({ snappingEnabled: !state.snappingEnabled }));
  },

  setScrollX: (scrollX) => {
    set({ scrollX: Math.max(0, scrollX) });
  },

  // In/Out marker actions
  setInPoint: (time) => {
    const { outPoint, duration } = get();
    if (time === null) {
      set({ inPoint: null });
      return;
    }
    // Ensure in point doesn't exceed out point or duration
    const clampedTime = Math.max(0, Math.min(time, outPoint ?? duration));
    set({ inPoint: clampedTime });
  },

  setOutPoint: (time) => {
    const { inPoint, duration } = get();
    if (time === null) {
      set({ outPoint: null });
      return;
    }
    // Ensure out point doesn't precede in point and doesn't exceed duration
    const clampedTime = Math.max(inPoint ?? 0, Math.min(time, duration));
    set({ outPoint: clampedTime });
  },

  clearInOut: () => {
    set({ inPoint: null, outPoint: null });
  },

  setInPointAtPlayhead: () => {
    const { playheadPosition, setInPoint } = get();
    setInPoint(playheadPosition);
  },

  setOutPointAtPlayhead: () => {
    const { playheadPosition, setOutPoint } = get();
    setOutPoint(playheadPosition);
  },

  setLoopPlayback: (loop) => {
    set({ loopPlayback: loop });
  },

  toggleLoopPlayback: () => {
    set({ loopPlayback: !get().loopPlayback });
  },

  setPlaybackSpeed: (speed: number) => {
    set({ playbackSpeed: speed });
  },

  // JKL playback control - L for forward play
  playForward: () => {
    const { isPlaying, playbackSpeed, play } = get();
    if (!isPlaying) {
      // Start playing forward at normal speed
      set({ playbackSpeed: 1 });
      play();
    } else if (playbackSpeed < 0) {
      // Was playing reverse, switch to forward
      set({ playbackSpeed: 1 });
    } else {
      // Already playing forward, increase speed (1 -> 2 -> 4 -> 8)
      const newSpeed = playbackSpeed >= 8 ? 8 : playbackSpeed * 2;
      set({ playbackSpeed: newSpeed });
    }
  },

  // JKL playback control - J for reverse play
  playReverse: () => {
    const { isPlaying, playbackSpeed, play } = get();
    if (!isPlaying) {
      // Start playing reverse at normal speed
      set({ playbackSpeed: -1 });
      play();
    } else if (playbackSpeed > 0) {
      // Was playing forward, switch to reverse
      set({ playbackSpeed: -1 });
    } else {
      // Already playing reverse, increase reverse speed (-1 -> -2 -> -4 -> -8)
      const newSpeed = playbackSpeed <= -8 ? -8 : playbackSpeed * 2;
      set({ playbackSpeed: newSpeed });
    }
  },

  setDuration: (duration: number) => {
    // Manually set duration and lock it so it won't auto-update
    const clampedDuration = Math.max(1, duration); // Minimum 1 second
    set({ duration: clampedDuration, durationLocked: true });

    // Sync to composition in media store so it persists
    const { activeCompositionId, updateComposition } = useMediaStore.getState();
    if (activeCompositionId) {
      updateComposition(activeCompositionId, { duration: clampedDuration });
    }

    // Clamp playhead if it's beyond new duration
    const { playheadPosition, inPoint, outPoint } = get();
    if (playheadPosition > clampedDuration) {
      set({ playheadPosition: clampedDuration });
    }
    // Clamp in/out points if needed
    if (inPoint !== null && inPoint > clampedDuration) {
      set({ inPoint: clampedDuration });
    }
    if (outPoint !== null && outPoint > clampedDuration) {
      set({ outPoint: clampedDuration });
    }
  },

  // Performance toggles
  toggleThumbnailsEnabled: () => {
    set({ thumbnailsEnabled: !get().thumbnailsEnabled });
  },

  toggleWaveformsEnabled: () => {
    set({ waveformsEnabled: !get().waveformsEnabled });
  },

  setThumbnailsEnabled: (enabled: boolean) => {
    set({ thumbnailsEnabled: enabled });
  },

  setWaveformsEnabled: (enabled: boolean) => {
    set({ waveformsEnabled: enabled });
  },

  setAudioDisplayMode: (mode) => {
    set({ audioDisplayMode: mode });
  },

  setAudioLayerAdvancedMode: (enabled) => {
    persistAudioLayerAdvancedMode(enabled);
    set({ audioLayerAdvancedMode: enabled });
  },

  toggleAudioLayerAdvancedMode: () => {
    set((state) => {
      const audioLayerAdvancedMode = !(state.audioLayerAdvancedMode !== false);
      persistAudioLayerAdvancedMode(audioLayerAdvancedMode);
      return { audioLayerAdvancedMode };
    });
  },

  setAudioFocusMode: (enabled) => {
    set({ audioFocusMode: enabled, trackFocusMode: enabled ? 'audio' : 'balanced' });
  },

  toggleAudioFocusMode: () => {
    set((state) => {
      const nextEnabled = !state.audioFocusMode;
      return {
        audioFocusMode: nextEnabled,
        trackFocusMode: nextEnabled ? 'audio' : 'balanced',
      };
    });
  },

  setTrackFocusMode: (mode) => {
    set({ trackFocusMode: mode, audioFocusMode: mode === 'audio' });
  },

  setAudioRegionSelection: (selection) => {
    if (!selection) {
      set({ audioRegionSelection: null, audioRegionGainPreview: null });
      return;
    }

    const startTime = Math.max(0, Math.min(selection.startTime, selection.endTime));
    const endTime = Math.max(startTime, Math.max(selection.startTime, selection.endTime));
    const sourceInPoint = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const sourceOutPoint = Math.max(selection.sourceInPoint, selection.sourceOutPoint);

    set({
      audioRegionSelection: {
        ...selection,
        startTime,
        endTime,
        sourceInPoint,
        sourceOutPoint,
      },
      audioRegionGainPreview: null,
    });
  },

  clearAudioRegionSelection: () => {
    set({ audioRegionSelection: null, audioRegionGainPreview: null });
  },

  setAudioSpectralRegionSelection: (selection) => {
    if (!selection) {
      set({ audioSpectralRegionSelection: null });
      return;
    }

    const startTime = Math.max(0, Math.min(selection.startTime, selection.endTime));
    const endTime = Math.max(startTime, Math.max(selection.startTime, selection.endTime));
    const sourceInPoint = Math.min(selection.sourceInPoint, selection.sourceOutPoint);
    const sourceOutPoint = Math.max(selection.sourceInPoint, selection.sourceOutPoint);
    const frequencyMinHz = Math.max(0, Math.min(selection.frequencyMinHz, selection.frequencyMaxHz));
    const frequencyMaxHz = Math.max(frequencyMinHz, Math.max(selection.frequencyMinHz, selection.frequencyMaxHz));

    set({
      audioSpectralRegionSelection: {
        ...selection,
        startTime,
        endTime,
        sourceInPoint,
        sourceOutPoint,
        frequencyMinHz,
        frequencyMaxHz,
      },
    });
  },

  clearAudioSpectralRegionSelection: () => {
    set({ audioSpectralRegionSelection: null });
  },

  toggleAudioRegionEditMarkers: () => {
    set({ showAudioRegionEditMarkers: !get().showAudioRegionEditMarkers });
  },

  setShowAudioRegionEditMarkers: (enabled) => {
    set({ showAudioRegionEditMarkers: enabled });
  },

  toggleTranscriptMarkers: () => {
    set({ showTranscriptMarkers: !get().showTranscriptMarkers });
  },

  setShowTranscriptMarkers: (enabled: boolean) => {
    set({ showTranscriptMarkers: enabled });
  },

  // Tool mode actions
  setToolMode: (mode) => {
    get().setActiveTimelineTool(mode === 'cut' ? 'blade' : 'select');
  },

  toggleCutTool: () => {
    const { activeTimelineToolId, toolMode } = get();
    get().setActiveTimelineTool(
      toolMode === 'cut' || activeTimelineToolId === 'blade' || activeTimelineToolId === 'blade-all-tracks'
        ? 'select'
        : 'blade',
    );
  },

  // Clip animation phase for composition transitions
  setClipAnimationPhase: (phase: 'idle' | 'exiting' | 'entering') => {
    set({ clipAnimationPhase: phase });
  },

  setCompositionSwitchDirection: (direction) => {
    set({ compositionSwitchDirection: direction });
  },

  setCompositionSwitchTargetTracks: (tracks) => {
    set({ compositionSwitchTargetTracks: tracks ? tracks.map((track) => ({ ...track })) : null });
  },

  // Slot grid view progress
  setSlotGridProgress: (progress: number) => {
    set({ slotGridProgress: Math.max(0, Math.min(1, progress)) });
  },
});
