// MIDI playback scheduler + per-track synth routing (issue #182, Phase 4 / 4b).
//
// Drives the internal MidiSynth from the timeline transport AND routes each MIDI
// track's synth through the shared audio routing graph so the track behaves like
// a normal mixer channel with FULL parity: volume, pan, mute/solo, 10-band EQ,
// the audio effect stack, sends and the master bus + live meter.
//
//   MidiSynth voices -> bus.sourceGain --> audioRoutingManager node route
//                                          (gain -> FX -> EQ -> pan -> meter)
//                                          -> shared master bus -> destination
//
// The synth shares the AudioRoutingManager's AudioContext, so MIDI and media
// tracks mix through the same master chain. The node route reuses the exact same
// processor/EQ/meter engine as media tracks (see audioRoutingManager.applyNodeEffects).
//
// The look-ahead scheduler is the standard WebAudio pattern (Chris Wilson,
// "A Tale of Two Clocks"): a periodic timer schedules notes whose start falls in
// a small window against the AudioContext clock, so timing stays sample-accurate.
// MIDI only sounds at 1x forward (mirrors AudioTrackSyncManager muting media audio
// at non-standard speeds). Voices flush on stop/pause/seek.

import { useTimelineStore } from '../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../types';
import type { IMidiSynth } from '../../engine/audio/IMidiSynth';
import { createSynthForInstrument } from '../../engine/audio/createSynthForInstrument';
import { getGmSampleBank, type GmSoundRef } from '../../engine/audio/GmSampleBank';
import { createDefaultMidiInstrument, type MidiInstrument } from '../../types/midiClip';
import { isNoteStartInWindow, noteAbsoluteStart } from '../midi/midiClipTiming';
import { audioRoutingManager } from '../audioRoutingManager';
import {
  createTrackLiveAudioRouteSettings,
  getTrackAudioMuted,
  getTrackAudioSolo,
} from './audioGraphRouteSettings';
import { runtimeAudioMeterBus } from './runtimeAudioMeterBus';
import { Logger } from '../logger';

const log = Logger.create('MidiPlayback');

const LOOKAHEAD_SECONDS = 0.12;       // schedule notes up to this far ahead
const SCHEDULER_INTERVAL_MS = 25;     // how often the look-ahead loop runs
const START_DELAY_SECONDS = 0.06;     // small lead-in so the first notes are not late
const SEEK_RESYNC_THRESHOLD = 0.25;   // playhead drift that triggers a re-anchor
const MAX_SCHEDULED_KEYS = 10_000;    // safety cap on the dedup set

/**
 * Per-MIDI-track synth bus. The synth feeds a single source gain node which is
 * handed to audioRoutingManager as a node route, so volume/pan/EQ/FX/sends/master
 * + metering are all owned by the shared routing graph (mixer-channel parity).
 */
interface TrackBus {
  synth: IMidiSynth;
  sourceGain: GainNode;
  /** Instrument kind the synth was built for; a change rebuilds the synth. */
  kind: MidiInstrument['kind'];
}

class MidiPlaybackScheduler {
  private context: AudioContext | null = null;
  private buses = new Map<string, TrackBus>();
  private previewSynth: IMidiSynth | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private initialized = false;
  private needReanchor = false;

  // Mapping anchor between timeline seconds and AudioContext seconds.
  private anchorCtxTime = 0;
  private anchorTimeline = 0;
  // Notes already scheduled in the current run, keyed to avoid double-trigger.
  private scheduled = new Set<string>();
  // GM sounds already requested from the bank (keyed melodic/drum + program), so
  // preload runs once per distinct sound.
  private preloadedSounds = new Set<string>();

  /** Idempotent: subscribe to transport state so playback drives the synth. */
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
    // Preload GM samples as soon as a track's instrument is set/changed (before the
    // user hits play), so the first note isn't dropped while the asset loads.
    useTimelineStore.subscribe(
      (state) => state.tracks,
      (tracks) => this.preloadGmSounds(tracks),
    );
    log.debug('MIDI playback scheduler initialized');
  }

  /** Fetch samples for any GM sound (melodic program or drum kit) not yet requested. */
  private preloadGmSounds(tracks: TimelineTrack[]): void {
    const refs: GmSoundRef[] = [];
    for (const track of tracks) {
      const instrument = track.type === 'midi' ? track.midiInstrument : undefined;
      if (instrument?.kind !== 'gm') continue;
      const isDrum = instrument.isDrum ?? false;
      const key = `${isDrum ? 'd' : 'm'}${instrument.program}`;
      if (this.preloadedSounds.has(key)) continue;
      this.preloadedSounds.add(key);
      refs.push({ program: instrument.program, isDrum });
    }
    if (refs.length > 0) void getGmSampleBank().ensureLoaded(refs);
  }

  private hasPlayableMidiContent(tracks: TimelineTrack[], clips: TimelineClip[]): boolean {
    const midiTrackIds = new Set(tracks.filter((track) => track.type === 'midi').map((track) => track.id));
    if (midiTrackIds.size === 0) return false;
    return clips.some((clip) =>
      midiTrackIds.has(clip.trackId) &&
      clip.source?.type === 'midi' &&
      (clip.midiData?.notes?.length ?? 0) > 0
    );
  }

  /**
   * Play an immediate short note (piano-roll draw/click preview). Routes through
   * the track bus when a trackId is given so preview respects the full channel
   * (volume/pan/EQ/FX/master).
   */
  preview(
    instrument: MidiInstrument | undefined,
    pitch: number,
    velocity = 0.85,
    trackId?: string,
  ): void {
    if (!this.ensureAudio() || !this.context) return;
    void this.context.resume?.().catch(() => {});
    const resolved = instrument ?? createDefaultMidiInstrument();

    const track = trackId
      ? useTimelineStore.getState().tracks.find((t) => t.id === trackId && t.type === 'midi')
      : undefined;
    if (track) {
      const bus = this.getOrCreateBus(track.id, resolved);
      if (bus) {
        this.routeBus(track.id, bus, track, false);
        bus.synth.previewNote(resolved, pitch, velocity, 0.35);
        return;
      }
    }

    if (!this.previewSynth) {
      this.previewSynth = createSynthForInstrument(resolved, this.context, this.context.destination);
    }
    this.previewSynth.previewNote(resolved, pitch, velocity, 0.35);
  }

  private ensureAudio(): boolean {
    if (this.context && this.context.state !== 'closed') return true;

    // Share the AudioRoutingManager's context + master bus so MIDI mixes through
    // the same master chain as media tracks and gets full per-track routing.
    try {
      this.context = audioRoutingManager.ensureSharedContext();
      return true;
    } catch (error) {
      log.error('Failed to obtain shared AudioContext for MIDI synth', error);
      this.context = null;
      return false;
    }
  }

  // The instrument picks the synth implementation (oscillator vs GM wavetable). When
  // the track's instrument *kind* changes, rebuild the synth onto the same source
  // gain so the bus keeps its routing/meter while the audio source swaps.
  private getOrCreateBus(trackId: string, instrument: MidiInstrument): TrackBus | null {
    if (!this.context) return null;
    const existing = this.buses.get(trackId);
    if (existing) {
      if (existing.kind === instrument.kind) return existing;
      existing.synth.stopAll();
      existing.synth = createSynthForInstrument(instrument, this.context, existing.sourceGain);
      existing.kind = instrument.kind;
      return existing;
    }

    const ctx = this.context;
    const sourceGain = ctx.createGain();
    const bus: TrackBus = {
      synth: createSynthForInstrument(instrument, ctx, sourceGain),
      sourceGain,
      kind: instrument.kind,
    };
    this.buses.set(trackId, bus);
    return bus;
  }

  /** Push the track's live mixer settings into the shared node route. */
  private routeBus(trackId: string, bus: TrackBus, track: TimelineTrack, silenced: boolean): void {
    const masterAudioState = useTimelineStore.getState().masterAudioState ?? undefined;
    const settings = createTrackLiveAudioRouteSettings({ track, masterAudioState });
    const volume = silenced || settings.muted ? 0 : settings.volume;
    audioRoutingManager.applyNodeEffects(
      trackId,
      bus.sourceGain,
      volume,
      settings.eqGains,
      settings.pan,
      settings.processors,
      settings.master,
    );
  }

  private publishBusMeter(trackId: string): void {
    const trackScope = { kind: 'track' as const, trackId };
    const masterScope = { kind: 'master' as const };
    const snapshot = audioRoutingManager.getNodeMeterSnapshot(trackId, performance.now(), {
      includeStereo: runtimeAudioMeterBus.hasDemand(trackScope, 'stereo'),
      includePhase: runtimeAudioMeterBus.hasDemand(trackScope, 'phase'),
      includeSpectrum: runtimeAudioMeterBus.hasDemand(trackScope, 'spectrum'),
    });
    if (!snapshot) return;

    const masterSnapshot = audioRoutingManager.getMasterMeterSnapshot(snapshot.updatedAt, {
      includeStereo: runtimeAudioMeterBus.hasDemand(masterScope, 'stereo'),
      includePhase: runtimeAudioMeterBus.hasDemand(masterScope, 'phase'),
      includeSpectrum: runtimeAudioMeterBus.hasDemand(masterScope, 'spectrum'),
    });
    useTimelineStore.getState().updateRuntimeAudioMeter(trackId, snapshot, masterSnapshot ?? undefined);
  }

  private disposeBus(trackId: string): void {
    const bus = this.buses.get(trackId);
    if (!bus) return;
    bus.synth.stopAll();
    audioRoutingManager.removeNodeRoute(trackId);
    try {
      bus.sourceGain.disconnect();
    } catch {
      // already disconnected
    }
    this.buses.delete(trackId);
  }

  private start(): void {
    if (this.running) return;
    const state = useTimelineStore.getState();
    if (!this.hasPlayableMidiContent(state.tracks, state.clips)) return;
    if (!this.ensureAudio() || !this.context) return;
    void this.context.resume?.().catch(() => {});
    // Preload GM samples for current tracks (covers a freshly loaded project where no
    // instrument-change event fired since init).
    this.preloadGmSounds(state.tracks);
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
    for (const bus of this.buses.values()) bus.synth.stopAll();
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
    if (!this.running || !this.context) return;
    const state = useTimelineStore.getState();
    if (!state.isPlaying) {
      this.stop();
      return;
    }
    if (!this.hasPlayableMidiContent(state.tracks, state.clips)) {
      this.stop();
      return;
    }

    // MIDI only sounds at 1x forward (matches audio behavior). At other speeds,
    // silence and re-anchor once normal speed resumes.
    if (state.playbackSpeed !== 1) {
      for (const bus of this.buses.values()) bus.synth.stopAll();
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
    // says we should be, flush and re-anchor (handles scrubbing during play).
    const expectedTimeline = this.contextToTimelineTime(ctx.currentTime);
    if (Math.abs(expectedTimeline - state.playheadPosition) > SEEK_RESYNC_THRESHOLD) {
      for (const bus of this.buses.values()) bus.synth.stopAll();
      this.reanchor();
    }

    const windowStartTimeline = this.contextToTimelineTime(ctx.currentTime);
    const windowEndTimeline = this.contextToTimelineTime(ctx.currentTime + LOOKAHEAD_SECONDS);

    const midiTracks = state.tracks.filter((track) => track.type === 'midi');

    // Tear down buses for tracks that are gone / no longer MIDI.
    if (this.buses.size > 0) {
      const liveIds = new Set(midiTracks.map((t) => t.id));
      for (const trackId of [...this.buses.keys()]) {
        if (!liveIds.has(trackId)) this.disposeBus(trackId);
      }
    }
    if (midiTracks.length === 0) return;

    const hasSolo = midiTracks.some((track) => getTrackAudioSolo(track));

    for (const track of midiTracks) {
      const instrument = track.midiInstrument ?? createDefaultMidiInstrument();
      const bus = this.getOrCreateBus(track.id, instrument);
      if (!bus) continue;

      const silenced = getTrackAudioMuted(track) || (hasSolo && !getTrackAudioSolo(track));
      this.routeBus(track.id, bus, track, silenced);
      this.publishBusMeter(track.id);

      if (silenced) continue;

      for (const clip of state.clips) {
        if (clip.trackId !== track.id || clip.source?.type !== 'midi') continue;
        const notes = clip.midiData?.notes;
        if (!notes || notes.length === 0) continue;

        const clipEnd = clip.startTime + clip.duration;
        for (const note of notes) {
          // Notes outside the clip's in/out window are silent but preserved (#232).
          if (!isNoteStartInWindow(clip, note)) continue;
          const absStart = noteAbsoluteStart(clip, note);
          if (absStart < windowStartTimeline - 0.001 || absStart >= windowEndTimeline) continue;

          // Clamp the playable length to the clip boundary, then skip empties.
          const maxDuration = clipEnd - absStart;
          if (maxDuration <= 0) continue;
          const duration = Math.min(note.duration, maxDuration);

          const key = `${clip.id}:${note.id}:${absStart.toFixed(3)}`;
          if (this.scheduled.has(key)) continue;
          this.scheduled.add(key);

          const when = this.timelineToContextTime(absStart);
          bus.synth.scheduleNote(instrument, note.pitch, note.velocity, when, duration);
        }
      }
    }

    if (this.scheduled.size > MAX_SCHEDULED_KEYS) {
      // Bounded growth guard for very long sessions; clearing may re-trigger a
      // note currently inside the window in rare cases, which is acceptable.
      this.scheduled.clear();
    }
  }
}

const scheduler = new MidiPlaybackScheduler();

/** Start the transport->synth subscription (idempotent). */
export function ensureMidiPlaybackScheduler(): void {
  scheduler.init();
}

/** Play a short preview note (piano-roll draw/click feedback). */
export function previewMidiNote(
  instrument: MidiInstrument | undefined,
  pitch: number,
  velocity = 0.85,
  trackId?: string,
): void {
  scheduler.preview(instrument, pitch, velocity, trackId);
}
