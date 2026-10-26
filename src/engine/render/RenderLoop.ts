// Animation loop with idle detection and frame rate limiting

import { Logger } from '../../services/logger';
import { readEditorContentPublication } from '../../services/project/repository/transaction/editorPublication';
import type { PerformanceStats } from '../stats/PerformanceStats';

const log = Logger.create('RenderLoop');

export interface RenderLoopCallbacks {
  isRecovering: () => boolean;
  isExporting: () => boolean;
  onRender: (reason?: RenderLoopFrameReason) => boolean | void;
}

export interface RenderLoopFrameReason {
  newFrameReady: boolean;
}

export class RenderLoop {
  private performanceStats: PerformanceStats;
  private callbacks: RenderLoopCallbacks;
  private animationId: number | null = null;
  private isRunning = false;

  // Idle mode
  private lastActivityTime = 0;
  private isIdle = false;
  private renderRequested = false;
  private deferredRequestReason: string | null = null;
  private lastRenderedPlayhead = -1;

  // When true, idle detection is completely suppressed (engine always renders).
  // Used after page reload: video GPU surfaces need the render loop running
  // so syncClipVideo warmup (play()/RVFC) can complete. Without this, the
  // engine goes idle after 1s and scrubbing produces black frames.
  // Cleared when setIsPlaying(true) is called (first play warms up videos).
  private idleSuppressed = false;
  private idleSuppressedSince = 0;

  // Frame rate limiting
  private hasActiveVideo = false;
  private isPlaying = false;
  private isScrubbing = false;
  private timelineVisualDemand = true;
  private continuousRender = false;
  private newFrameReady = false; // Fresh program frames bypass the sampling deadline
  private lastRenderTime = 0;
  private playbackTargetFps = 60;
  // The browser clock samples at least twice per visual frame. A source-rate
  // limiter alone can phase-lock badly against a 60 Hz display (24 fps is the
  // common case): one source frame is sampled twice and the next is skipped.
  // The render callback cheaply rejects duplicate visual frames, so this is a
  // sampling cadence rather than extra GPU work.
  private playbackFrameInterval = 1000 / 60;
  private playbackNextRenderTime = 0;

  // Health monitoring - detect frozen render loop
  private lastSuccessfulRender = 0;
  private lastCadenceRender = 0;
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private renderCount = 0;
  // Hidden tabs pause requestAnimationFrame, so render gaps accumulated there
  // are expected browser behavior. Stall time is measured against this
  // baseline, which advances while the document is hidden.
  private watchdogStallBaseline = 0;
  private watchdogSawHiddenDocument = false;
  // Last animation frame delivered to the loop. A background or occluded window can stop
  // animation frames while the document still reports visible; that is not a render stall.
  private lastRafTick = 0;
  private rafProbePending = false;

  private readonly IDLE_TIMEOUT = 1000; // 1s before idle
  private readonly IDLE_SUPPRESSION_TIMEOUT = 3000; // bounded reload warmup
  // Requested renders (seek, decoded frame, preview capture) still run at display
  // cadence. Between them a paused view only needs an occasional re-present;
  // full-rate re-renders of heavy effects starved editor interaction after every wake.
  private readonly PAUSED_PREVIEW_HOLD_FRAME_TIME = 250;
  private readonly VIDEO_FRAME_TIME = 15; // ~60fps target with tolerance for 16.6ms display ticks
  private readonly SCRUB_FRAME_TIME = 15; // ~60fps during scrubbing with tolerance for 16.6ms display ticks
  private readonly FRAME_TIME_TOLERANCE = 1.5; // lets a 16.6ms RAF satisfy a nominal 60fps cadence
  private readonly MAX_VISUAL_TARGET_FPS = 60;
  private readonly WATCHDOG_INTERVAL = 2000; // Check every 2s
  private readonly WATCHDOG_STALL_THRESHOLD = 3000; // 3s without render = stalled

  private lastFpsReset = 0;

  constructor(
    performanceStats: PerformanceStats,
    callbacks: RenderLoopCallbacks
  ) {
    this.performanceStats = performanceStats;
    this.callbacks = callbacks;
  }

  setRenderCallback(onRender: () => void): void {
    this.callbacks.onRender = onRender;
  }

  getIsRunning(): boolean {
    return this.isRunning;
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastActivityTime = performance.now();
    this.lastSuccessfulRender = performance.now();
    this.lastCadenceRender = 0;
    this.isIdle = false;
    this.renderCount = 0;
    this.playbackNextRenderTime = 0;
    this.lastRafTick = performance.now();
    log.info('Starting');

    const loop = (timestamp: number) => {
      if (!this.isRunning) return;
      this.lastRafTick = Math.max(timestamp, this.lastRafTick);

      let didRender = false;

      if (
        this.idleSuppressed
        && timestamp - this.idleSuppressedSince > this.IDLE_SUPPRESSION_TIMEOUT
      ) {
        this.idleSuppressed = false;
        log.info('Idle suppression lifted (warmup timeout)');
      }

      const playbackRenderActive = this.isPlaying && this.timelineVisualDemand;
      const scrubRenderActive = this.isScrubbing && this.timelineVisualDemand;
      const measureCadence = (playbackRenderActive || scrubRenderActive || this.continuousRender)
        && (typeof document === 'undefined' || !document.hidden);
      if (!measureCadence) this.lastCadenceRender = 0;
      const pausedPreviewHoldActive =
        !playbackRenderActive &&
        !scrubRenderActive &&
        !this.continuousRender &&
        this.timelineVisualDemand &&
        this.hasActiveVideo;
      const pausedPreviewHoldDue =
        pausedPreviewHoldActive &&
        (
          this.renderRequested ||
          timestamp - this.lastRenderTime >= this.PAUSED_PREVIEW_HOLD_FRAME_TIME
        );
      if (!playbackRenderActive) {
        this.playbackNextRenderTime = 0;
      }

      if (this.continuousRender || playbackRenderActive || scrubRenderActive) {
        this.isIdle = false;
        this.lastActivityTime = timestamp;
      } else if (!this.idleSuppressed) {
        // Idle detection (briefly suppressed after reload to allow video GPU warmup)
        const timeSinceActivity = timestamp - this.lastActivityTime;
        if (!this.isIdle && !this.renderRequested && timeSinceActivity > this.IDLE_TIMEOUT) {
          this.isIdle = true;
          log.debug('Entering idle mode');
        }

        if (this.isIdle && this.renderRequested) {
          this.isIdle = false;
          log.debug('Waking from idle');
        }
      }

      // Text, images and solids have no decoder to settle. A wake needs one
      // frame, not a full second of redundant composites. Periodic UI updates
      // used to keep this grace period alive indefinitely at display cadence.
      if (!playbackRenderActive && !scrubRenderActive && !this.continuousRender
        && !this.idleSuppressed && !this.hasActiveVideo && this.renderCount > 0
        && !this.renderRequested) {
        this.isIdle = true;
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      // A request is consumed only by a frame that reaches the render callback.
      // Frames skipped for recovery, export or a blocked editor publication keep
      // it pending, so the first frame after the gate reopens shows the change.
      const pendingRequest = this.renderRequested;
      this.renderRequested = false;

      // Skip during device recovery
      if (this.callbacks.isRecovering()) {
        this.keepDeferredRequest(pendingRequest, 'recovering');
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      // Skip rendering when idle (but keep RAF loop alive)
      if (this.isIdle) {
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      if (pausedPreviewHoldActive && !pausedPreviewHoldDue) {
        this.animationId = requestAnimationFrame(loop);
        return;
      }

      // Frame rate limiting: during playback always limit to ~60fps even when
      // the current frame comes from the scrubbing cache (isVideo=false).
      // Without this, a 30fps video on a 120Hz display causes hasActiveVideo
      // to oscillate (75% cache-hits → false), disabling the limiter and
      // rendering at 120fps — double the GPU work for zero visual benefit.
      if (this.hasActiveVideo || playbackRenderActive || scrubRenderActive || this.continuousRender) {
        const previousRenderTime = this.lastRenderTime;
        const timeSinceLastRender = timestamp - previousRenderTime;
        // A frame held back by the limiter keeps its request: the next allowed
        // tick must still show the change (seek, decoded frame) it asked for.
        const holdForLimiter = () => {
          this.renderRequested ||= pendingRequest;
          this.animationId = requestAnimationFrame(loop);
        };
        if (playbackRenderActive) {
          // Decoder notifications may beat the sampling clock, but must not turn
          // a high-refresh display into unbounded compositing work.
          if (previousRenderTime > 0 && timeSinceLastRender < this.VIDEO_FRAME_TIME) {
            holdForLimiter();
            return;
          }
          if (
            !this.newFrameReady
            && this.playbackNextRenderTime > 0
            && timestamp + this.FRAME_TIME_TOLERANCE < this.playbackNextRenderTime
          ) {
            holdForLimiter();
            return;
          }
        } else if (this.continuousRender) {
          // Non-playback continuous layers stay responsive at the display cadence.
          if (timeSinceLastRender < this.VIDEO_FRAME_TIME) {
            holdForLimiter();
            return;
          }
        } else if (pausedPreviewHoldActive) {
          // Only the unrequested re-present of the held frame waits for the hold
          // interval. A requested one (paused seek, the decoded frame it asked
          // for) used to be consumed here and wait up to 250 ms for that tick.
          const pausedFrameTime = pendingRequest ? this.VIDEO_FRAME_TIME : this.PAUSED_PREVIEW_HOLD_FRAME_TIME;
          if (timeSinceLastRender < pausedFrameTime) {
            holdForLimiter();
            return;
          }
        } else if (scrubRenderActive) {
          // Scrubbing: ~30fps baseline to avoid wasted renders while video seeks.
          // BUT: if RVFC signaled a new decoded frame is ready, render immediately
          // to minimize latency between decode completion and display.
          if (!this.newFrameReady && timeSinceLastRender < this.SCRUB_FRAME_TIME) {
            holdForLimiter();
            return;
          }
          this.newFrameReady = false;
        }
        if (playbackRenderActive) {
          if (this.playbackNextRenderTime <= 0) {
            this.playbackNextRenderTime = timestamp + this.playbackFrameInterval;
          } else {
            // An asynchronous decoded frame may arrive before the next sampling
            // deadline. Present it now without pushing that future deadline out.
            while (this.playbackNextRenderTime <= timestamp + this.FRAME_TIME_TOLERANCE) {
              this.playbackNextRenderTime += this.playbackFrameInterval;
            }
          }
        }
        this.lastRenderTime = timestamp;
      }

      // Call render callback (unless exporting). Clear the fresh-frame signal
      // before entering the callback so a provider that publishes while this
      // frame is being assembled schedules one more presentation tick.
      const exporting = this.callbacks.isExporting();
      const publicationBlocked = !exporting && readEditorContentPublication().blocked;
      if (exporting || publicationBlocked) {
        this.keepDeferredRequest(pendingRequest, exporting ? 'exporting' : 'publication-blocked');
      } else {
        if (this.deferredRequestReason) {
          log.debug('Deferred render request delivered', { reason: this.deferredRequestReason });
          this.deferredRequestReason = null;
        }
        try {
          const frameReason = { newFrameReady: this.newFrameReady };
          this.newFrameReady = false;
          const rendered = this.callbacks.onRender(frameReason) !== false;
          if (rendered) {
            this.lastSuccessfulRender = timestamp;
            this.renderCount++;
            didRender = true;
          }
        } catch (e) {
          log.error('Error in render callback', e);
          // Continue loop despite error to prevent freeze
        }
      }

      // Record rendered-frame cadence for stats. The RAF loop itself may keep
      // ticking at display rate while playback is intentionally frame-limited.
      if (didRender && measureCadence) {
        if (this.lastCadenceRender > 0) {
          this.performanceStats.recordRafGap(timestamp - this.lastCadenceRender, this.isScrubbing);
        }
        this.lastCadenceRender = timestamp;
      }

      // Reset per-second counters
      if (timestamp - this.lastFpsReset >= 1000) {
        this.performanceStats.resetPerSecondCounters();
        this.lastFpsReset = timestamp;
      }

      this.animationId = requestAnimationFrame(loop);
    };

    this.animationId = requestAnimationFrame(loop);

    // Start watchdog timer to detect stalled render loops
    this.startWatchdog();
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    this.stopWatchdog();
  }

  private startWatchdog(): void {
    this.stopWatchdog();
    this.watchdogTimer = setInterval(() => {
      this.checkHealth();
    }, this.WATCHDOG_INTERVAL);
    // Watchdog ticks can be throttled or frozen entirely while the tab is
    // hidden, so visibility transitions also refresh the stall baseline
    // directly — otherwise the first tick after a restore could measure a
    // render gap that is really just paused-RAF time.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  private readonly handleVisibilityChange = (): void => {
    this.lastCadenceRender = 0;
    this.watchdogStallBaseline = performance.now();
    this.watchdogSawHiddenDocument = document.hidden;
  };

  /**
   * Check render loop health - detect and recover from stalls.
   * When playing, the render loop should be rendering every frame.
   * If it hasn't rendered for WATCHDOG_STALL_THRESHOLD ms, force a wake-up.
   */
  private checkHealth(): void {
    if (!this.isRunning) return;

    const now = performance.now();

    // During recovery, export or a held publication (project switch, editing handed to another
    // tab) frames are skipped on purpose. That time is not a stall either: advance the baseline,
    // or the first check after the hold would report the whole hold as a render stall.
    if (this.callbacks.isRecovering() || this.callbacks.isExporting() || readEditorContentPublication().blocked) {
      this.watchdogStallBaseline = now;
      return;
    }

    // Hidden tab: RAF is paused by the browser, so a growing render gap is
    // not a stall. Warning here would also re-arm renderRequested on every
    // (throttled) tick and spam the log for as long as the tab stays hidden.
    if (typeof document !== 'undefined' && document.hidden) {
      this.watchdogStallBaseline = now;
      this.watchdogSawHiddenDocument = true;
      return;
    }
    if (this.watchdogSawHiddenDocument) {
      // First check after the tab became visible again: give the resumed RAF
      // loop one watchdog interval to produce a frame before stall detection.
      this.watchdogSawHiddenDocument = false;
      this.watchdogStallBaseline = now;
      return;
    }

    if (this.animationId !== null && now - this.lastRafTick > this.WATCHDOG_STALL_THRESHOLD) {
      this.handleSilentAnimationFrames(now);
      return;
    }

    // If nothing is asking the render loop to stay awake, a long gap is the
    // expected idle state. This can happen in background/unfocused tabs before
    // the RAF loop gets a chance to flip `isIdle` itself.
    const hasRenderDemand =
      (this.isPlaying && this.timelineVisualDemand) ||
      (this.isScrubbing && this.timelineVisualDemand) ||
      this.continuousRender ||
      this.renderRequested ||
      this.idleSuppressed ||
      (this.hasActiveVideo && now - this.lastActivityTime <= this.IDLE_TIMEOUT);
    const timeSinceRender = now - Math.max(this.lastSuccessfulRender, this.watchdogStallBaseline);
    if (!hasRenderDemand) {
      // Idle time is not stall time: a request arriving after a long idle period
      // must not be measured against the last render before that period.
      this.watchdogStallBaseline = now;
      if (timeSinceRender > this.WATCHDOG_STALL_THRESHOLD) this.isIdle = true;
      return;
    }

    // Check if we're stalled (no render for too long while we should be rendering)
    if (timeSinceRender > this.WATCHDOG_STALL_THRESHOLD) {
      log.warn(`Render stall detected: ${timeSinceRender.toFixed(0)}ms since last render (idle=${this.isIdle}, playing=${this.isPlaying})`);

      // Force wake from idle
      this.isIdle = false;
      this.renderRequested = true;
      this.lastActivityTime = now;

      // If the RAF loop itself has died (animationId is null but isRunning is true),
      // restart it
      if (this.animationId === null && this.isRunning) {
        log.warn('RAF loop died - restarting');
        this.stop();
        this.start();
      }
    }
  }

  /**
   * No animation frame reached the loop although one is scheduled. Either the browser holds
   * frames for this page (background tab or occluded window that still reports visible: a
   * render gap there is not a stall) or the loop lost its callback. A one-shot probe frame
   * tells them apart: if the probe runs while the loop does not, the loop is restarted.
   */
  private handleSilentAnimationFrames(now: number): void {
    this.watchdogStallBaseline = now;
    if (this.rafProbePending) return;
    this.rafProbePending = true;
    log.debug('No animation frames from the browser; render stall check paused', { sinceLastFrameMs: Math.round(now - this.lastRafTick) });
    requestAnimationFrame(() => {
      this.rafProbePending = false;
      if (!this.isRunning || this.lastRafTick >= now) return;
      log.warn('Render loop stopped receiving animation frames - restarting');
      this.stop();
      this.start();
    });
  }

  private keepDeferredRequest(pendingRequest: boolean, reason: string): void {
    if (!pendingRequest) return;
    if (this.deferredRequestReason !== reason) {
      log.debug('Render request deferred until the frame gate reopens', { reason });
      this.deferredRequestReason = reason;
    }
    this.renderRequested = true;
  }

  requestRender(): void {
    this.lastActivityTime = performance.now();
    this.renderRequested = true;
    if (this.isIdle) {
      this.isIdle = false;
    }
  }

  // Called by RVFC when a new decoded video frame is ready.
  // Bypasses the scrub rate limiter so the fresh frame is displayed immediately.
  requestNewFrameRender(): void {
    this.newFrameReady = true;
    this.requestRender();
  }

  getIsIdle(): boolean {
    return this.isIdle;
  }

  getLastSuccessfulRenderTime(): number {
    return this.lastSuccessfulRender;
  }

  getRenderCount(): number {
    return this.renderCount;
  }

  updatePlayheadTracking(playhead: number): boolean {
    const changed = Math.abs(playhead - this.lastRenderedPlayhead) > 0.0001;
    if (changed) {
      this.lastRenderedPlayhead = playhead;
      this.requestRender();
    }
    return changed;
  }

  setHasActiveVideo(hasVideo: boolean): void {
    this.hasActiveVideo = hasVideo;
  }

  setTimelineVisualDemand(hasDemand: boolean): void {
    if (this.timelineVisualDemand === hasDemand) return;

    this.timelineVisualDemand = hasDemand;
    if (hasDemand && (this.isPlaying || this.isScrubbing)) {
      this.lastRenderTime = 0;
      this.requestRender();
    }
  }

  /**
   * Suppress idle detection — engine renders every frame until unsuppressed.
   * Used after page reload before the first play to keep video GPU surfaces warm.
   */
  suppressIdle(): void {
    this.idleSuppressed = true;
    this.idleSuppressedSince = performance.now();
    this.isIdle = false;
    log.info('Idle suppressed (waiting for first play)');
  }

  getIsPlaying(): boolean {
    return this.isPlaying;
  }

  setIsPlaying(playing: boolean): void {
    if (this.isPlaying !== playing) this.lastCadenceRender = 0;
    this.isPlaying = playing;
    this.playbackNextRenderTime = 0;
    if (playing && this.idleSuppressed) {
      // First play — video GPU surfaces are now warm, enable idle detection
      this.idleSuppressed = false;
      log.info('Idle suppression lifted (first play)');
    }
    if (playing && this.timelineVisualDemand) {
      // Resume should wake idle immediately and bypass the previous frame limiter window.
      this.lastRenderTime = 0;
      this.requestRender();
    }
  }

  setContinuousRender(enabled: boolean): void {
    if (this.continuousRender === enabled) return;

    this.continuousRender = enabled;
    if (enabled) {
      this.lastRenderTime = 0;
      this.requestRender();
    }
  }

  getContinuousRender(): boolean {
    return this.continuousRender;
  }

  getTimelineVisualDemand(): boolean {
    return this.timelineVisualDemand;
  }

  setVisualTargetFps(targetFps: number): void {
    const nextTargetFps = Number.isFinite(targetFps) && targetFps > 0
      ? Math.max(1, Math.min(this.MAX_VISUAL_TARGET_FPS, Math.round(targetFps)))
      : this.MAX_VISUAL_TARGET_FPS;
    if (nextTargetFps === this.playbackTargetFps) {
      return;
    }

    this.playbackTargetFps = nextTargetFps;
    this.performanceStats.setTargetFps(nextTargetFps);
    const samplingFps = Math.min(this.MAX_VISUAL_TARGET_FPS, nextTargetFps * 2);
    this.playbackFrameInterval = 1000 / samplingFps;
    this.playbackNextRenderTime = 0;
    if (this.isPlaying && this.timelineVisualDemand) {
      this.lastRenderTime = 0;
      this.requestRender();
    }
  }

  getIsScrubbing(): boolean {
    return this.isScrubbing;
  }

  setIsScrubbing(scrubbing: boolean): void {
    const wasScrubbing = this.isScrubbing;
    this.isScrubbing = scrubbing;
    if (scrubbing) {
      // Reset render time so first scrub frame renders immediately
      this.lastRenderTime = 0;
      if (this.timelineVisualDemand) {
        this.requestRender();
      }
    }
    // Scrub stopped: ensure at least one more render cycle runs
    // so the settle-seek in VideoSyncManager can fire and the
    // correct frame is displayed after the seek completes.
    if (wasScrubbing && !scrubbing) {
      this.requestRender();
    }
  }
}
