// In-window score playback (issue #366, phase 4).
//
// Plays the editor's current score through the HOST synth stack: the shared
// AudioContext from audioRoutingManager, a synth from createSynthForInstrument
// (the track's instrument — Wavetable/GM by default for score tracks), and
// one scheduleNote per scoreToEvents event. This is editor-local audition of
// the whole sheet; timeline transport/export playback of score clips is a
// separate later step (extend midiPlaybackScheduler / AudioExportPipeline).

import type { MidiInstrument } from '../../types/midiClip';
import { createDefaultMidiInstrument } from '../../types/midiClip';
import type { Score } from '../../types/scoreClip';
import type { IMidiSynth } from '../../engine/audio/IMidiSynth';
import { createSynthForInstrument } from '../../engine/audio/createSynthForInstrument';
import { audioRoutingManager } from '../../services/audioRoutingManager';
import { scoreToEvents } from '../../services/score/scoreToEvents';
import { Logger } from '../../services/logger';

const log = Logger.create('ScorePlayer');

export type ScorePlaybackState = 'stopped' | 'playing';

/** Small lead-in so the first note isn't clipped by scheduling latency. */
const START_DELAY_S = 0.08;
/** Release tail after the last event before auto-stop. */
const STOP_TAIL_S = 0.4;

export class ScorePlayer {
  private synth: IMidiSynth | null = null;
  private stopTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private state: ScorePlaybackState = 'stopped';
  private playToken = 0;
  private onStateChange: (state: ScorePlaybackState) => void;

  constructor(onStateChange: (state: ScorePlaybackState) => void) {
    this.onStateChange = onStateChange;
  }

  getState(): ScorePlaybackState {
    return this.state;
  }

  /** Play the score from the top. Restarts if already playing. */
  async play(score: Score, instrument: MidiInstrument | undefined): Promise<void> {
    this.stop();
    const token = ++this.playToken;

    const resolved = instrument ?? createDefaultMidiInstrument();
    const ctx = audioRoutingManager.ensureSharedContext();
    try {
      await ctx.resume();
    } catch {
      // A suspended context keeps scheduling; the browser resumes on gesture
    }

    const synth = createSynthForInstrument(resolved, ctx, ctx.destination);

    // GM samples load lazily; wait so the first notes aren't dropped
    if (resolved.kind === 'gm') {
      try {
        await synth.preload([{ program: resolved.program, isDrum: resolved.isDrum ?? false }]);
      } catch (error) {
        log.warn('GM sample preload failed; playing may start silent', { error: String(error) });
      }
    }
    if (token !== this.playToken) {
      // Stopped (or restarted) while samples were loading
      synth.stopAll();
      return;
    }

    const { events, totalDuration } = scoreToEvents(score);
    if (events.length === 0) {
      log.debug('Score has no sounding notes — nothing to play');
      return;
    }

    const startAt = ctx.currentTime + START_DELAY_S;
    for (const event of events) {
      synth.scheduleNote(resolved, event.midi, event.velocity, startAt + event.start, event.duration);
    }

    this.synth = synth;
    this.state = 'playing';
    this.onStateChange(this.state);
    log.debug('Score playback started', { events: events.length, seconds: totalDuration });

    this.stopTimeoutId = setTimeout(() => this.stop(), (START_DELAY_S + totalDuration + STOP_TAIL_S) * 1000);
  }

  /** Stop playback immediately (flushes all scheduled voices). */
  stop(): void {
    this.playToken++;
    if (this.stopTimeoutId !== null) {
      clearTimeout(this.stopTimeoutId);
      this.stopTimeoutId = null;
    }
    if (this.synth) {
      try {
        this.synth.stopAll();
      } catch {
        // Voices may already be gone
      }
      this.synth = null;
    }
    if (this.state !== 'stopped') {
      this.state = 'stopped';
      this.onStateChange(this.state);
    }
  }

  dispose(): void {
    this.stop();
  }
}
