// Playback loop with audio master clock synchronization

import { useEffect } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { engine } from '../../../engine/WebGPUEngine';
import {
  clearInternalPlaybackHold,
  layerBuilder,
  playheadState,
} from '../../../services/layerBuilder';
import { findStopMarkerInPlaybackRange } from '../../../services/timeline/stopMarkers';
import { hasTimelineVisualRenderDemand } from '../../../services/timeline/timelineVisualDemand';

interface UsePlaybackLoopProps {
  isPlaying: boolean;
}

function isInteractiveDockLayoutChangeActive(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector(
    [
      '.dock-split.resizing',
      '.floating-panel.resizing',
      '.dock-container.dragging',
      '.dock-resize-handle.active',
      '.timeline-container.is-track-resizing',
      '.timeline-container.is-header-width-resizing',
      '.timeline-container.is-split-dragging',
      '.track-resize-handle.active',
      '.timeline-layer-divider-resize-handle.active',
    ].join(','),
  ));
}

/**
 * Audio Master Clock playback loop
 * Audio runs freely without correction, playhead follows audio time
 * This eliminates audio drift and clicking from constant seeks
 */
export function usePlaybackLoop({ isPlaying }: UsePlaybackLoopProps) {
  useEffect(() => {
    if (!isPlaying) {
      // Sync store to final internal position before disabling —
      // prevents frame jump-back caused by stale 33ms-throttled store value
      if (playheadState.isUsingInternalPosition) {
        useTimelineStore.setState({ playheadPosition: playheadState.position });
      }
      clearInternalPlaybackHold();
      playheadState.isUsingInternalPosition = false;
      playheadState.hasMasterAudio = false;
      playheadState.masterAudioElement = null;
      playheadState.masterAudioClock = null;
      return;
    }

    let rafId: number;
    let lastTime = performance.now();
    let lastStateUpdate = 0;
    let lastAudioSync = 0;
    const VISUAL_STATE_UPDATE_INTERVAL = 33; // ~30fps while video/visual playback is active
    const AUDIO_ONLY_STATE_UPDATE_INTERVAL = 33; // audio clock stays smooth; UI follows at ~30fps
    const INTERACTIVE_LAYOUT_STATE_UPDATE_INTERVAL = 90;
    const AUDIO_SYNC_INTERVAL = 50;
    const AUDIO_STARTUP_SYNC_INTERVAL = 16;

    // Initialize internal position from store and enable high-frequency mode
    playheadState.position = useTimelineStore.getState().playheadPosition;
    playheadState.isUsingInternalPosition = true;
    playheadState.playbackJustStarted = true; // Signal for initial audio sync

    const stopPlaybackAt = (position: number) => {
      const timelineStore = useTimelineStore.getState();
      timelineStore.pause();
      clearInternalPlaybackHold();
      playheadState.position = position;
      playheadState.isUsingInternalPosition = false;
      playheadState.hasMasterAudio = false;
      playheadState.masterAudioElement = null;
      playheadState.masterAudioClock = null;
      useTimelineStore.setState({
        playheadPosition: position,
        playbackSpeed: 1,
      });
      // Force a render at the final position. Playback stopped on a throttled
      // store update that was still on a clip, so without this the canvas keeps
      // that last frame; at the timeline end / a gap the position has no clip and
      // must clear to black instead of retaining the previous frame.
      engine.requestNewFrameRender();
    };

    const updatePlayhead = (currentTime: number) => {
      try {
        const state = useTimelineStore.getState();
        const {
          duration: dur,
          inPoint: ip,
          outPoint: op,
          loopPlayback: lp,
          pause: ps,
          clips,
          tracks,
          markers,
          playbackSpeed,
          clipDragPreview,
        } = state;
        const effectiveEnd = op !== null ? op : dur;
        const effectiveStart = ip !== null ? ip : 0;
        const previousPosition = playheadState.position;

        let newPosition: number;
        const heldPlaybackPosition = playheadState.heldPlaybackPosition;

        if (heldPlaybackPosition !== null) {
          newPosition = heldPlaybackPosition;
          lastTime = currentTime;
        } else if (playheadState.hasMasterAudio && playheadState.masterAudioElement && playbackSpeed === 1) {
          // AUDIO MASTER CLOCK: If we have an active audio element, derive playhead from its time.
          // Only use audio master for normal forward playback (speed === 1).
          const audio = playheadState.masterAudioElement;
          if (!audio.paused && audio.readyState >= 2) {
            // Calculate timeline position from audio's current time
            // audioTime = clipInPoint + (timelinePosition - clipStartTime) * speed
            // So: timelinePosition = clipStartTime + (audioTime - clipInPoint) / speed
            const audioTime = audio.currentTime;
            const speed = playheadState.masterClipSpeed || 1;
            newPosition =
              playheadState.masterClipStartTime +
              (audioTime - playheadState.masterClipInPoint) / speed;
          } else {
            // Audio paused or not ready, fall back to system time
            const deltaTime = (currentTime - lastTime) / 1000;
            const cappedDelta = Math.min(deltaTime, 0.1);
            newPosition = playheadState.position + cappedDelta * playbackSpeed;
          }
        } else if (playheadState.hasMasterAudio && playheadState.masterAudioClock && playbackSpeed === 1) {
          const audioTime = playheadState.masterAudioClock();
          if (audioTime !== null && Number.isFinite(audioTime)) {
            const speed = playheadState.masterClipSpeed || 1;
            newPosition =
              playheadState.masterClipStartTime +
              (audioTime - playheadState.masterClipInPoint) / speed;
          } else {
            const deltaTime = (currentTime - lastTime) / 1000;
            const cappedDelta = Math.min(deltaTime, 0.1);
            newPosition = playheadState.position + cappedDelta * playbackSpeed;
          }
        } else {
          // No audio master or non-standard speed - use system time with playback speed
          const deltaTime = (currentTime - lastTime) / 1000;
          const cappedDelta = Math.min(deltaTime, 0.1);
          newPosition = playheadState.position + cappedDelta * playbackSpeed;
        }
        lastTime = currentTime;

        const stopMarker = findStopMarkerInPlaybackRange(markers, previousPosition, newPosition);
        if (stopMarker) {
          stopPlaybackAt(stopMarker.time);
          return;
        }

        // Handle end of timeline / looping (forward playback)
        if (newPosition >= effectiveEnd && playbackSpeed > 0) {
          if (lp) {
            newPosition = effectiveStart;
            // Reset audio master - will be re-established by syncAudioElements
            playheadState.hasMasterAudio = false;
            playheadState.masterAudioElement = null;
            playheadState.masterAudioClock = null;
            // Seek all audio/video to start
            clips.forEach((clip) => {
              if (clip.source?.audioElement) {
                clip.source.audioElement.currentTime = clip.inPoint;
              }
              if (clip.source?.videoElement) {
                clip.source.videoElement.currentTime = clip.reversed
                  ? clip.outPoint
                  : clip.inPoint;
              }
            });
          } else {
            newPosition = effectiveEnd;
            ps();
            stopPlaybackAt(newPosition);
            return;
          }
        }

        // Handle start of timeline (reverse playback)
        if (newPosition <= effectiveStart && playbackSpeed < 0) {
          if (lp) {
            newPosition = effectiveEnd;
            // Reset audio master
            playheadState.hasMasterAudio = false;
            playheadState.masterAudioElement = null;
            playheadState.masterAudioClock = null;
            // Seek all audio/video to end
            clips.forEach((clip) => {
              if (clip.source?.audioElement) {
                clip.source.audioElement.currentTime = clip.outPoint;
              }
              if (clip.source?.videoElement) {
                clip.source.videoElement.currentTime = clip.reversed
                  ? clip.inPoint
                  : clip.outPoint;
              }
            });
          } else {
            newPosition = effectiveStart;
            ps();
            stopPlaybackAt(newPosition);
            return;
          }
        }

        // Clamp to bounds (for edge cases)
        if (newPosition < effectiveStart) {
          newPosition = effectiveStart;
        }
        if (newPosition > effectiveEnd) {
          newPosition = effectiveEnd;
        }

        // Update high-frequency position for render loop to read
        playheadState.position = newPosition;

        const hasVisualRenderDemand = hasTimelineVisualRenderDemand({
          clips,
          tracks,
          playheadPosition: newPosition,
          clipDragPreview,
        });

        const audioSyncInterval = playheadState.playbackJustStarted
          ? AUDIO_STARTUP_SYNC_INTERVAL
          : AUDIO_SYNC_INTERVAL;
        if (!hasVisualRenderDemand && currentTime - lastAudioSync >= audioSyncInterval) {
          layerBuilder.syncAudioElements();
          lastAudioSync = currentTime;
        }

        // PERFORMANCE: Only update store at throttled interval
        const stateUpdateInterval = isInteractiveDockLayoutChangeActive()
          ? INTERACTIVE_LAYOUT_STATE_UPDATE_INTERVAL
          : hasVisualRenderDemand
          ? VISUAL_STATE_UPDATE_INTERVAL
          : AUDIO_ONLY_STATE_UPDATE_INTERVAL;
        if (currentTime - lastStateUpdate >= stateUpdateInterval) {
          useTimelineStore.setState({ playheadPosition: newPosition });
          lastStateUpdate = currentTime;
        }
      } catch (e) {
        // Never let the playback RAF chain break - audio would desync
        console.error('[PlaybackLoop] Error in updatePlayhead:', e);
      }

      rafId = requestAnimationFrame(updatePlayhead);
    };

    rafId = requestAnimationFrame(updatePlayhead);

    return () => {
      cancelAnimationFrame(rafId);
      // Sync final position to store before cleanup
      if (playheadState.isUsingInternalPosition) {
        useTimelineStore.setState({ playheadPosition: playheadState.position });
      }
      clearInternalPlaybackHold();
      playheadState.isUsingInternalPosition = false;
      playheadState.hasMasterAudio = false;
      playheadState.masterAudioElement = null;
      playheadState.masterAudioClock = null;
    };
  }, [isPlaying]);
}
