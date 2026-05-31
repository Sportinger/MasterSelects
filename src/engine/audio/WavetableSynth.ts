// General MIDI wavetable synth (issue #193, Phase 3).
//
// IMidiSynth implementation over the shared GmSampleBank: plays a looped/one-shot
// sample per note, pitch-shifted from the zone's root key, shaped by the zone's
// gain envelope (mirroring MidiSynth's envelope shape so GM and the simple synth
// behave consistently in the mixer). Works against both a live AudioContext and an
// export OfflineAudioContext — the bank builds rate-correct buffers either way.

import type { MidiInstrument } from '../../types/midiClip';
import type { IMidiSynth } from './IMidiSynth';
import { getGmSampleBank } from './GmSampleBank';
import { Logger } from '../../services/logger';

const log = Logger.create('WavetableSynth');

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

interface ActiveVoice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  endsAt: number;
}

export class WavetableSynth implements IMidiSynth {
  private readonly context: BaseAudioContext;
  private readonly destination: AudioNode;
  private readonly voices = new Set<ActiveVoice>();
  private readonly bank = getGmSampleBank();

  constructor(context: BaseAudioContext, destination: AudioNode) {
    this.context = context;
    this.destination = destination;
  }

  /** Ensure the bank has the given GM programs decoded before notes are scheduled. */
  async preload(programs: number[]): Promise<void> {
    await this.bank.ensureLoaded(programs);
  }

  scheduleNote(
    instrument: MidiInstrument,
    pitch: number,
    velocity: number,
    when: number,
    duration: number,
  ): void {
    // Only GM instruments reach this synth (via the factory). Narrowing also makes
    // `instrument.program` / `instrument.isDrum` access type-safe.
    if (instrument.kind !== 'gm') return;

    const ctx = this.context;
    const isDrum = instrument.isDrum ?? false;
    const built = this.bank.buildSource(instrument.program, pitch, isDrum, ctx);
    if (!built) {
      // Not loaded yet — kick off a load so subsequent notes sound. Phase 4 makes
      // preload proactive (on scheduler start / instrument change) so this rarely hits.
      void this.bank.ensureLoaded([instrument.program]);
      return;
    }

    const peak = clamp01(velocity) * clamp01(instrument.gain);
    if (peak <= 0) return;

    const { source, zone } = built;
    const env = zone.envelope;
    const startAt = Math.max(when, ctx.currentTime);
    const attack = Math.max(0.001, env.attack);
    const decay = Math.max(0.001, env.decay);
    const release = Math.max(0.005, env.release);
    const sustain = clamp01(env.sustain);
    const sustainLevel = Math.max(0.0001, peak * sustain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    const attackEnd = startAt + attack;
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
    const decayEnd = attackEnd + decay;
    gain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);

    // Hold at sustain until note-off, then release. Drums (no loop) ring out to the
    // sample's natural end; the release just fades whatever remains.
    const noteOff = Math.max(decayEnd, startAt + Math.max(0.02, duration));
    gain.gain.setValueAtTime(sustainLevel, noteOff);
    const releaseEnd = noteOff + release;
    gain.gain.exponentialRampToValueAtTime(0.0001, releaseEnd);

    source.connect(gain);
    gain.connect(this.destination);
    source.start(startAt);
    source.stop(releaseEnd + 0.02);

    const voice: ActiveVoice = { source, gain, endsAt: releaseEnd };
    this.voices.add(voice);
    source.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // node may already be disconnected
      }
      this.voices.delete(voice);
    };
  }

  /** Play an immediate short note (piano-roll draw/click preview). */
  previewNote(instrument: MidiInstrument, pitch: number, velocity = 0.85, duration = 0.3): void {
    if (!('currentTime' in this.context)) return;
    if (instrument.kind === 'gm' && !this.bank.isLoaded(instrument.program)) {
      // Load, then blip once ready so the first preview is audible.
      void this.bank
        .ensureLoaded([instrument.program])
        .then(() => this.scheduleNote(instrument, pitch, velocity, this.context.currentTime, duration));
      return;
    }
    this.scheduleNote(instrument, pitch, velocity, this.context.currentTime, duration);
  }

  stopAll(): void {
    const now = this.context.currentTime;
    for (const voice of this.voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        const current = Math.max(0.0001, voice.gain.gain.value);
        voice.gain.gain.setValueAtTime(current, now);
        voice.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
        voice.source.stop(now + 0.03);
      } catch {
        // ignore voices already stopped
      }
    }
    log.debug('stopAll: flushed voices', { count: this.voices.size });
  }

  get voiceCount(): number {
    return this.voices.size;
  }
}
