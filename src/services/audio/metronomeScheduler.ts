// Metronome click scheduler (issue #299, Packet 5).
//
// Structured on midiPlaybackScheduler — the proven look-ahead pattern (Chris
// Wilson, "A Tale of Two Clocks"): a periodic timer schedules the clicks whose
// start falls in a short window against the AudioContext clock, so timing is
// sample-accurate rather than timer-accurate.
//
// Beat times come straight from `iterateBarBeatLines`, which already returns
// exactly the tick times plus `isBarStart` — including through a tempo RAMP,
// where beats accelerate. No new math here.
//
// ROUTING (plan §3.4): the click owns a GainNode wired DIRECTLY to
// `AudioContext.destination`. It shares the context via
// `audioRoutingManager.ensureSharedContext()` but deliberately does NOT register
// a node route, so it cannot enter master metering, the master FX/limiter chain,
// or any master-bus tap. Export renders through a separate offline path, so a
// live-only node is excluded structurally; the `isExporting` guard is belt and
// braces on top of that.

import { useTimelineStore } from '../../stores/timeline';
import type { TempoMap } from '../../types/timeline';
import { iterateBarBeatLines } from '../../timeline/tempo/TempoMap';
import { scheduleClick } from '../../engine/audio/metronomeVoice';
import { audioRoutingManager } from '../audioRoutingManager';
import { Logger } from '../logger';

const log = Logger.create('Metronome');

const LOOKAHEAD_SECONDS = 0.12;     // schedule clicks up to this far ahead
const SCHEDULER_INTERVAL_MS = 25;   // how often the look-ahead loop runs
const START_DELAY_SECONDS = 0.06;   // small lead-in so the first click is not late
const SEEK_RESYNC_THRESHOLD = 0.25; // playhead drift that triggers a re-anchor
const MAX_SCHEDULED_KEYS = 10_000;  // safety cap on the dedup set

export type MetronomeMode = 'beats' | 'bars';

export interface MetronomeClick {
  time: number;
  isDownbeat: boolean;
}

/**
 * The clicks due in `[from, to]`. Pure, so the schedule can be asserted without
 * an AudioContext.
 */
export function collectMetronomeClicks(
  tempoMap: TempoMap,
  from: number,
  to: number,
  mode: MetronomeMode,
): MetronomeClick[] {
  if (to < from) return [];
  const clicks: MetronomeClick[] = [];
  for (const line of iterateBarBeatLines(tempoMap, Math.max(0, from), to)) {
    if (mode === 'bars' && !line.isBarStart) continue;
    clicks.push({ time: line.time, isDownbeat: line.isBarStart });
  }
  return clicks;
}

class MetronomeScheduler {
  private context: AudioContext | null = null;
  private output: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private initialized = false;
  private needReanchor = false;

  // Mapping anchor between timeline seconds and AudioContext seconds.
  private anchorCtxTime = 0;
  private anchorTimeline = 0;
  // Click times already scheduled in this run, so a beat inside two consecutive
  // look-ahead windows only fires once.
  private scheduled = new Set<string>();

  /** Idempotent: subscribe to the transport and to the enable flag. */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    useTimelineStore.subscribe(
      (state) => state.isPlaying,
      (isPlaying) => {
        if (isPlaying) this.start();
        else this.stop();
      },
    );

    // Toggling mid-playback starts clicking on the next beat / stops at once.
    useTimelineStore.subscribe(
      (state) => state.metronomeEnabled,
      (enabled) => {
        if (enabled && useTimelineStore.getState().isPlaying) this.start();
        else if (!enabled) this.stop();
      },
    );

    log.debug('Metronome scheduler initialized');
  }

  private ensureAudio(): boolean {
    if (this.context && this.context.state !== 'closed' && this.output) return true;

    try {
      this.context = audioRoutingManager.ensureSharedContext();
      // Straight to the destination — never a routed node (see the header).
      this.output = this.context.createGain();
      this.output.gain.value = 1;
      this.output.connect(this.context.destination);
      return true;
    } catch (error) {
      log.error('Failed to obtain shared AudioContext for the metronome', error);
      this.context = null;
      this.output = null;
      return false;
    }
  }

  private start(): void {
    if (this.running) return;
    const state = useTimelineStore.getState();
    if (!state.metronomeEnabled || state.isExporting) return;
    if (!this.ensureAudio() || !this.context) return;

    void this.context.resume?.().catch(() => {});
    this.running = true;
    this.needReanchor = false;
    this.reanchor();
    this.timer = setInterval(() => this.tick(), SCHEDULER_INTERVAL_MS);
    this.tick();
  }

  private stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Clicks are one-shot voices, so there is nothing to silence — only the
    // dedup set needs clearing so a restart re-schedules the current window.
    this.scheduled.clear();
  }

  /** Reset the timeline<->context mapping to the current playhead. */
  private reanchor(): void {
    if (!this.context) return;
    this.anchorCtxTime = this.context.currentTime + START_DELAY_SECONDS;
    this.anchorTimeline = useTimelineStore.getState().playheadPosition;
    this.scheduled.clear();
  }

  private timelineToContextTime(timelineTime: number): number {
    return this.anchorCtxTime + (timelineTime - this.anchorTimeline);
  }

  private contextToTimelineTime(contextTime: number): number {
    return this.anchorTimeline + (contextTime - this.anchorCtxTime);
  }

  private tick(): void {
    if (!this.running || !this.context || !this.output) return;
    const state = useTimelineStore.getState();

    if (!state.isPlaying || !state.metronomeEnabled || state.isExporting) {
      this.stop();
      return;
    }

    // Like MIDI and media audio, the click only sounds at 1x forward; at other
    // speeds it goes quiet and re-anchors once normal speed resumes.
    if (state.playbackSpeed !== 1) {
      this.scheduled.clear();
      this.needReanchor = true;
      return;
    }
    if (this.needReanchor) {
      this.reanchor();
      this.needReanchor = false;
    }

    const ctx = this.context;

    // Seek detection: if the real playhead diverges from where the context clock
    // says we should be, re-anchor (handles scrubbing during playback).
    const expectedTimeline = this.contextToTimelineTime(ctx.currentTime);
    if (Math.abs(expectedTimeline - state.playheadPosition) > SEEK_RESYNC_THRESHOLD) {
      this.reanchor();
    }

    const windowStart = this.contextToTimelineTime(ctx.currentTime);
    const windowEnd = this.contextToTimelineTime(ctx.currentTime + LOOKAHEAD_SECONDS);
    const volume = state.metronomeVolume;
    if (volume <= 0) return;

    for (const click of collectMetronomeClicks(
      state.tempoMap,
      windowStart,
      windowEnd,
      state.metronomeMode,
    )) {
      const key = click.time.toFixed(4);
      if (this.scheduled.has(key)) continue;
      this.scheduled.add(key);
      scheduleClick(ctx, this.output, this.timelineToContextTime(click.time), {
        isDownbeat: click.isDownbeat,
        volume,
      });
    }

    if (this.scheduled.size > MAX_SCHEDULED_KEYS) this.scheduled.clear();
  }
}

let scheduler = new MetronomeScheduler();

/** Start the transport->click subscription (idempotent). */
export function ensureMetronomeScheduler(): void {
  scheduler.init();
}

// Survive HMR so a dev reload does not leave a second scheduler running and
// double-click every beat (CLAUDE.md §9).
if (import.meta.hot) {
  import.meta.hot.accept();
  if (import.meta.hot.data?.metronomeScheduler) {
    scheduler = import.meta.hot.data.metronomeScheduler as MetronomeScheduler;
  }
  import.meta.hot.dispose((data) => {
    data.metronomeScheduler = scheduler;
  });
}
