// AudioSyncHandler - Unified audio synchronization for all audio sources
// Consolidates 4 similar 80-line blocks into one reusable handler

import { Logger } from '../logger';
import type { AudioMeterSnapshot, TimelineClip } from '../../types';
import type { FrameContext, AudioSyncState, AudioSyncTarget } from './types';
import { LAYER_BUILDER_CONSTANTS } from './types';
import { playheadState, setMasterAudio } from './PlayheadState';
import { audioManager, audioStatusTracker } from '../audioManager';
import { audioRoutingManager } from '../audioRoutingManager';
import { runtimeAudioMeterBus } from '../audio/runtimeAudioMeterBus';
import { vfPipelineMonitor } from '../vfPipelineMonitor';
import { useTimelineStore } from '../../stores/timeline';
import { createSilentAudioMeterSnapshot } from '../audio/audioMetering';

const log = Logger.create('AudioSyncHandler');
const TAIL_METER_POLL_INTERVAL_MS = 50;
const TAIL_METER_SILENCE_HOLD_MS = 700;
const TAIL_METER_MAX_DURATION_MS = 30_000;
const TAIL_METER_SILENCE_LINEAR = 0.0003; // roughly -70 dBFS
// Cap meter publishing at display rate (~60Hz). Without the cap, high-refresh
// displays publish per render frame (120Hz+), burning analyser reads and
// snapshot allocations per element. Below ~60Hz large mixer meters visibly
// stutter, so this must not be raised without UI-side interpolation.
const METER_PUBLISH_INTERVAL_MS = 16;
// Per-frame default for applyEffects callers; hoisted so the per-frame path
// does not allocate a fresh zero array per element.
const EMPTY_EQ_GAINS: readonly number[] = Object.freeze(new Array(10).fill(0));

function hasActiveRouteEffects(route: AudioSyncTarget['masterRoute']): boolean {
  if (!route) return false;
  return (
    Math.abs(route.volume - 1) > 0.001 ||
    route.eqGains.some(gain => Math.abs(gain) > 0.01) ||
    route.processors.length > 0
  );
}

function hasTailMeterCandidate(
  processors: AudioSyncTarget['processors'] = [],
  masterRoute?: AudioSyncTarget['masterRoute'],
): boolean {
  return processors.length > 0 || (masterRoute?.processors.length ?? 0) > 0;
}

function isTailMeterSilent(snapshot: AudioMeterSnapshot | null | undefined): boolean {
  if (!snapshot) return true;
  return Math.max(snapshot.peakLinear, snapshot.rmsLinear) <= TAIL_METER_SILENCE_LINEAR;
}

interface TailMeterPoll {
  element: HTMLMediaElement;
  trackId: string;
  startedAt: number;
  silentSince: number | null;
  timerId: ReturnType<typeof setInterval>;
}

/**
 * AudioSyncHandler - Manages audio synchronization for all audio sources
 */
export class AudioSyncHandler {
  // Scrub audio state
  private scrubStates = new WeakMap<HTMLMediaElement, { lastPosition: number; lastTime: number; lastSeenPosition: number }>();
  private scrubAudioTimeouts = new Map<HTMLMediaElement, ReturnType<typeof setTimeout>>();
  private tailMeterPolls = new Map<string, TailMeterPoll>();
  // Meter publish gating: per-track publish tick plus once-per-silence-period
  // dedup, so paused/muted elements do not publish identical silent snapshots
  // every render frame.
  private meterPublishAt = new Map<string, number>();
  private silentMeterPublished = new Set<string>();

  /**
   * Sync a single audio element with unified logic
   */
  syncAudioElement(
    target: AudioSyncTarget,
    ctx: FrameContext,
    state: AudioSyncState
  ): void {
    const {
      element,
      clip,
      clipTime,
      absSpeed,
      isMuted,
      canBeMaster,
      type,
      volume = 1,
      eqGains,
      pan = 0,
      processors = [],
      masterRoute,
      meterTrackId,
    } = target;
    const effectivelyMuted = isMuted || volume <= 0.01;

    // Set muted state
    element.muted = effectivelyMuted;
    if (effectivelyMuted) {
      this.cancelTailMeterPolling(meterTrackId);
      this.publishSilentMeterOnce(meterTrackId, ctx.now);
      this.pauseIfPlaying(element);
      return;
    }

    // Set pitch preservation
    this.setPitchPreservation(element, clip.preservesPitch !== false);

    const shouldPlay = ctx.isPlaying && !effectivelyMuted && !ctx.isDraggingPlayhead && absSpeed > 0.1;

    // Handle scrubbing
    if (ctx.isDraggingPlayhead && !effectivelyMuted) {
      this.cancelTailMeterPolling(meterTrackId);
      this.handleScrub(element, clipTime, ctx, volume, eqGains, pan, processors, masterRoute, meterTrackId);
    } else if (shouldPlay) {
      this.cancelTailMeterPolling(meterTrackId);
      this.handlePlayback(element, clipTime, absSpeed, clip, canBeMaster, type, state, volume, eqGains, pan, processors, masterRoute, meterTrackId);
    } else {
      this.pauseIfPlaying(element);
      if (!this.startTailMeterPolling(
        meterTrackId,
        element,
        ctx.now,
        hasTailMeterCandidate(processors, masterRoute) || Boolean(meterTrackId),
      )) {
        this.publishSilentMeterOnce(meterTrackId, ctx.now);
      }
    }
  }

  /**
   * Handle audio scrubbing - play short snippet at current position
   */
  private handleScrub(
    element: HTMLAudioElement | HTMLVideoElement,
    clipTime: number,
    ctx: FrameContext,
    volume: number,
    eqGains?: number[],
    pan = 0,
    processors: AudioSyncTarget['processors'] = [],
    masterRoute?: AudioSyncTarget['masterRoute'],
    meterTrackId?: string
  ): void {
    const scrubState = this.scrubStates.get(element) ?? { lastPosition: -1, lastTime: 0, lastSeenPosition: -1 };
    const timeSinceLastScrub = ctx.now - scrubState.lastTime;
    const positionChanged = Math.abs(ctx.playheadPosition - scrubState.lastPosition) > 0.005;
    // Only play while the playhead is actually moving frame-to-frame. A held
    // (stationary) pointer must not keep replaying the same fragment (#213).
    const movedSinceLastFrame = scrubState.lastSeenPosition < 0
      || Math.abs(ctx.playheadPosition - scrubState.lastSeenPosition) > 0.0005;

    if (movedSinceLastFrame && positionChanged && timeSinceLastScrub > LAYER_BUILDER_CONSTANTS.SCRUB_TRIGGER_INTERVAL) {
      this.scrubStates.set(element, {
        lastPosition: ctx.playheadPosition,
        lastTime: ctx.now,
        lastSeenPosition: ctx.playheadPosition,
      });
      element.playbackRate = 1;
      this.applyScrubEffects(element, volume, eqGains, pan, processors, masterRoute, meterTrackId);
      this.playScrubAudio(element, clipTime);
    } else {
      // Keep tracking position even when we don't trigger, so the next frame can
      // tell whether the pointer actually moved.
      this.scrubStates.set(element, { ...scrubState, lastSeenPosition: ctx.playheadPosition });
    }
  }

  /**
   * Standalone audio clips scrub via their media element fallback, so the
   * element still needs the clip's current volume/EQ applied while dragging.
   */
  private applyScrubEffects(
    element: HTMLAudioElement | HTMLVideoElement,
    volume: number,
    eqGains?: number[],
    pan = 0,
    processors: AudioSyncTarget['processors'] = [],
    masterRoute?: AudioSyncTarget['masterRoute'],
    meterTrackId?: string
  ): void {
    const hasEQ = eqGains?.some(g => Math.abs(g) > 0.01) ?? false;
    const hasPan = Math.abs(pan) > 0.001;
    const hasProcessors = (processors?.length ?? 0) > 0;
    const hasMasterRoute = hasActiveRouteEffects(masterRoute);
    const needsMeter = Boolean(meterTrackId);
    const hasExistingRoute = audioRoutingManager.hasRoute(element);

    if (hasEQ || hasPan || hasProcessors || hasMasterRoute || volume > 1 || needsMeter || hasExistingRoute) {
      const effectiveEqGains = eqGains ?? EMPTY_EQ_GAINS;
      if (
        hasExistingRoute
        && audioRoutingManager.isRouteEffectStateApplied(element, volume, effectiveEqGains, pan, processors, masterRoute)
      ) {
        this.publishRouteMeterGated(meterTrackId, element);
        return;
      }
      void audioRoutingManager
        .applyEffects(element, volume, effectiveEqGains, pan, processors, masterRoute)
        .then((routed) => this.publishRouteMeterGated(meterTrackId, routed ? element : null));
      return;
    }

    const targetVolume = Math.max(0, Math.min(1, volume));
    if (Math.abs(element.volume - targetVolume) > 0.01) {
      element.volume = targetVolume;
    }
  }

  /**
   * Play short audio snippet for scrubbing feedback
   */
  private playScrubAudio(element: HTMLAudioElement | HTMLVideoElement, time: number): void {
    element.currentTime = time;
    element.play().catch(() => {});

    // One timeout per element so stacked audio tracks can scrub together.
    this.clearScrubAudioTimeout(element);
    const timeout = setTimeout(() => {
      element.pause();
      this.scrubAudioTimeouts.delete(element);
    }, LAYER_BUILDER_CONSTANTS.SCRUB_AUDIO_DURATION);
    this.scrubAudioTimeouts.set(element, timeout);
  }

  /**
   * Handle normal audio playback
   */
  private handlePlayback(
    element: HTMLAudioElement | HTMLVideoElement,
    clipTime: number,
    absSpeed: number,
    clip: TimelineClip,
    canBeMaster: boolean,
    type: AudioSyncTarget['type'],
    state: AudioSyncState,
    volume: number = 1,
    eqGains?: number[],
    pan = 0,
    processors: AudioSyncTarget['processors'] = [],
    masterRoute?: AudioSyncTarget['masterRoute'],
    meterTrackId?: string
  ): void {
    this.clearScrubAudioTimeout(element);

    // Base rate from clip speed. The final rate — including a gentle drift
    // correction for non-master elements — is applied below once drift is known.
    const targetRate = absSpeed > 0.1 ? absSpeed : 1;

    // Check if we have EQ to apply (any non-zero gain)
    const hasEQ = eqGains && eqGains.some(g => Math.abs(g) > 0.01);
    const hasPan = Math.abs(pan) > 0.001;
    const hasProcessors = (processors?.length ?? 0) > 0;
    const hasMasterRoute = hasActiveRouteEffects(masterRoute);
    const needsMeter = Boolean(meterTrackId);
    const hasExistingRoute = audioRoutingManager.hasRoute(element);

    if (hasEQ || hasPan || hasProcessors || hasMasterRoute || volume > 1 || needsMeter || hasExistingRoute) {
      const effectiveEqGains = eqGains ?? EMPTY_EQ_GAINS;
      if (
        hasExistingRoute
        && audioRoutingManager.isRouteEffectStateApplied(element, volume, effectiveEqGains, pan, processors, masterRoute)
      ) {
        // Route graph already reflects this frame's state: skip the async
        // applyEffects() round-trip and only service the meter on its tick.
        this.publishRouteMeterGated(meterTrackId, element);
      } else {
        // Use Web Audio routing for volume + EQ
        // This handles both volume and EQ through the audio graph
        audioRoutingManager
          .applyEffects(element, volume, effectiveEqGains, pan, processors, masterRoute)
          .then((routed) => this.publishRouteMeterGated(meterTrackId, routed ? element : null));
      }
    } else {
      // Simple volume-only path (no Web Audio overhead)
      // HTMLMediaElement.volume only accepts [0, 1] range - clamp to prevent errors
      const targetVolume = Math.max(0, Math.min(1, volume));
      if (Math.abs(element.volume - targetVolume) > 0.01) {
        element.volume = targetVolume;
      }
    }

    // Start playback if paused
    if (element.paused) {
      // Only seek before play if the element is significantly out of sync.
      // After a clean pause, the element is already at the correct position —
      // an unnecessary seek forces the browser to re-decode from the last
      // keyframe, causing a 100-400ms startup delay.
      const currentDrift = Math.abs(element.currentTime - clipTime);
      if (currentDrift > 0.1) {
        element.currentTime = clipTime;
      }
      element.play()
        .then(() => {
          const timelineState = useTimelineStore.getState();
          if (!timelineState.isPlaying || timelineState.isDraggingPlayhead) {
            element.pause();
          }
        })
        .catch(err => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          log.warn(`[Audio ${type}] Failed to play: ${err.message}`);
          state.hasAudioError = true;
        });
    }

    // Set as master audio if eligible. The master may still be settling after
    // play(); the playback loop falls back to system time until it is running.
    if (!state.masterSet && canBeMaster) {
      setMasterAudio(element, clip.startTime, clip.inPoint, absSpeed);
      state.masterSet = true;
    }

    // Drift handling + final playback rate.
    // The master element drives the clock, so it is never corrected. Non-master
    // elements converge back to the timeline:
    //   - large drift (> 0.3s): a hard re-sync seek (rare; may briefly click)
    //   - moderate drift: a proportional playbackRate nudge (pitch preserved, so
    //     inaudible) that pulls the element back without a seek — this keeps
    //     stacked audio clips tightly lip-synced instead of drifting toward 0.3s.
    const timeDiff = element.currentTime - clipTime; // + = ahead, - = behind
    const absDrift = Math.abs(timeDiff);
    const isCurrentMaster = playheadState.masterAudioElement === element && canBeMaster;
    let finalRate = targetRate;

    if (!isCurrentMaster && !element.paused && absSpeed > 0.1) {
      if (absDrift > 0.3) {
        vfPipelineMonitor.record('audio_drift_correct', {
          type,
          driftMs: Math.round(timeDiff * 1000),
          clipId: clip.id,
        });
        element.currentTime = clipTime;
      } else if (absDrift > 0.045) {
        // Proportional convergence, capped at ±5% (≈ inaudible with pitch
        // preserved). Ahead → slow down; behind → speed up.
        const correction = Math.max(-0.05, Math.min(0.05, -timeDiff * 0.5));
        finalRate = targetRate + correction;
        vfPipelineMonitor.record('audio_drift', {
          type,
          driftMs: Math.round(timeDiff * 1000),
          clipId: clip.id,
        });
      }
    }

    if (Math.abs(element.playbackRate - finalRate) > 0.004) {
      element.playbackRate = Math.max(0.25, Math.min(4, finalRate));
    }

    if (absDrift > state.maxAudioDrift) {
      state.maxAudioDrift = absDrift;
    }

    // Count playing audio
    if (!element.paused) {
      state.audioPlayingCount++;
    }
  }

  /**
   * Pause element if currently playing
   */
  private pauseIfPlaying(element: HTMLAudioElement | HTMLVideoElement): void {
    this.clearScrubAudioTimeout(element);
    element.pause();
  }

  private clearScrubAudioTimeout(element: HTMLAudioElement | HTMLVideoElement): void {
    const timeout = this.scrubAudioTimeouts.get(element);
    if (!timeout) return;

    clearTimeout(timeout);
    this.scrubAudioTimeouts.delete(element);
  }

  /**
   * Set pitch preservation on audio element
   */
  private setPitchPreservation(element: HTMLAudioElement | HTMLVideoElement, preserve: boolean): void {
    const el = element as HTMLAudioElement & { preservesPitch?: boolean };
    if (el.preservesPitch !== preserve) {
      el.preservesPitch = preserve;
    }
  }

  private startTailMeterPolling(
    trackId: string | undefined,
    element: HTMLMediaElement,
    now: number,
    allowTailMeter: boolean,
  ): boolean {
    if (!allowTailMeter || !trackId || !audioRoutingManager.hasRoute(element)) return false;

    // An active poll already services this track on its own interval — bail
    // before reading the analysers so paused frames stay free of meter work.
    const existing = this.tailMeterPolls.get(trackId);
    if (existing?.element === element) return true;

    const firstSnapshot = this.publishRouteMeter(trackId, element);
    if (!firstSnapshot) return false;

    this.cancelTailMeterPolling(trackId);

    const poll: TailMeterPoll = {
      element,
      trackId,
      startedAt: now,
      silentSince: isTailMeterSilent(firstSnapshot.trackSnapshot) && isTailMeterSilent(firstSnapshot.masterSnapshot)
        ? now
        : null,
      timerId: setInterval(() => {
        const timestamp = performance.now();
        const snapshots = this.publishRouteMeter(trackId, element);

        if (!snapshots) {
          this.cancelTailMeterPolling(trackId);
          this.publishMeter(trackId, createSilentAudioMeterSnapshot(timestamp));
          return;
        }

        const tailIsSilent = isTailMeterSilent(snapshots.trackSnapshot) && isTailMeterSilent(snapshots.masterSnapshot);
        if (tailIsSilent) {
          poll.silentSince ??= timestamp;
        } else {
          poll.silentSince = null;
        }

        const silenceHeld = poll.silentSince !== null && timestamp - poll.silentSince >= TAIL_METER_SILENCE_HOLD_MS;
        const timedOut = timestamp - poll.startedAt >= TAIL_METER_MAX_DURATION_MS;
        if (silenceHeld || timedOut) {
          this.cancelTailMeterPolling(trackId);
          const silent = createSilentAudioMeterSnapshot(timestamp);
          this.publishMeter(trackId, silent, silent);
        }
      }, TAIL_METER_POLL_INTERVAL_MS),
    };

    this.tailMeterPolls.set(trackId, poll);
    return true;
  }

  private cancelTailMeterPolling(trackId: string | undefined): void {
    if (!trackId) return;
    const poll = this.tailMeterPolls.get(trackId);
    if (!poll) return;
    clearInterval(poll.timerId);
    this.tailMeterPolls.delete(trackId);
  }

  /**
   * Per-frame meter publishing funnel: rate-limited to METER_PUBLISH_INTERVAL_MS
   * per track so render-frame callers (playback/scrub sync) cannot exceed the
   * meter tick regardless of display refresh rate.
   */
  private publishRouteMeterGated(
    trackId: string | undefined,
    element: HTMLMediaElement | null,
    now = performance.now(),
  ): void {
    if (!trackId || !element) return;
    const last = this.meterPublishAt.get(trackId);
    if (last !== undefined && now - last < METER_PUBLISH_INTERVAL_MS) return;
    if (this.meterPublishAt.size > 256) this.meterPublishAt.clear();
    this.meterPublishAt.set(trackId, now);
    this.publishRouteMeter(trackId, element);
  }

  private publishSilentMeterOnce(trackId: string | undefined, now: number): void {
    if (!trackId || this.silentMeterPublished.has(trackId)) return;
    this.publishMeter(trackId, createSilentAudioMeterSnapshot(now));
    this.silentMeterPublished.add(trackId);
  }

  private publishRouteMeter(
    trackId: string | undefined,
    element: HTMLMediaElement | null,
  ): { trackSnapshot: AudioMeterSnapshot; masterSnapshot: AudioMeterSnapshot | null } | null {
    if (!trackId || !element) return null;
    const snapshot = audioRoutingManager.getMeterSnapshot(element, performance.now(), {
      includeSpectrum: runtimeAudioMeterBus.hasDemand({ kind: 'track', trackId }, 'spectrum'),
    });
    const masterSnapshot = audioRoutingManager.getMasterMeterSnapshot(snapshot?.updatedAt, {
      includeSpectrum: runtimeAudioMeterBus.hasDemand({ kind: 'master' }, 'spectrum'),
    });
    if (snapshot) {
      this.publishMeter(trackId, snapshot, masterSnapshot ?? undefined);
      return { trackSnapshot: snapshot, masterSnapshot };
    }
    return null;
  }

  private publishMeter(
    trackId: string | undefined,
    snapshot: AudioMeterSnapshot,
    masterSnapshot?: AudioMeterSnapshot,
  ): void {
    if (!trackId) return;
    // Any explicit publish ends the per-track silence period; the next silent
    // frame is allowed to publish one fresh silent snapshot again.
    this.silentMeterPublished.delete(trackId);
    useTimelineStore.getState().updateRuntimeAudioMeter(trackId, snapshot, masterSnapshot);
  }

  /**
   * Reset scrub state (call when not scrubbing)
   */
  resetScrubState(): void {
    this.scrubStates = new WeakMap<HTMLMediaElement, { lastPosition: number; lastTime: number; lastSeenPosition: number }>();
  }

  /**
   * Stop scrub audio (call when scrubbing ends)
   */
  stopScrubAudio(): void {
    for (const [element, timeout] of this.scrubAudioTimeouts) {
      clearTimeout(timeout);
      element.pause();
    }
    this.scrubAudioTimeouts.clear();
  }
}

/**
 * Create initial audio sync state for a frame
 */
export function createAudioSyncState(): AudioSyncState {
  return {
    audioPlayingCount: 0,
    maxAudioDrift: 0,
    hasAudioError: false,
    masterSet: false,
  };
}

/**
 * Finalize audio sync state (call at end of sync)
 */
export function finalizeAudioSync(state: AudioSyncState, isPlaying: boolean): void {
  // Clear master audio if no master was set during playback
  if (!state.masterSet && isPlaying) {
    playheadState.hasMasterAudio = false;
    playheadState.masterAudioElement = null;
    playheadState.masterAudioClock = null;
  }

  // Update audio status tracker
  audioStatusTracker.updateStatus(
    state.audioPlayingCount,
    state.maxAudioDrift,
    state.hasAudioError
  );

  // Record to VF pipeline monitor
  const audioStatus = audioStatusTracker.getStatus();
  vfPipelineMonitor.record('audio_status', {
    status: audioStatus.status,
    playing: audioStatus.playing,
    driftMs: audioStatus.drift,
  });
}

/**
 * Resume audio context if needed (browser autoplay policy)
 */
export async function resumeAudioContextIfNeeded(isPlaying: boolean, isDraggingPlayhead: boolean): Promise<void> {
  if (isPlaying && !isDraggingPlayhead) {
    await audioManager.resume().catch(() => {});
  }
}
