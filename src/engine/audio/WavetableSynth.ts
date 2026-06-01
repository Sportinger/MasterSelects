// General MIDI wavetable synth (issue #193, Phase 3).
//
// IMidiSynth implementation over the shared GmSampleBank: plays a looped/one-shot
// sample per note, pitch-shifted from the zone's root key, shaped by the zone's
// gain envelope (mirroring MidiSynth's envelope shape so GM and the simple synth
// behave consistently in the mixer). Works against both a live AudioContext and an
// export OfflineAudioContext — the bank builds rate-correct buffers either way.

import type { MidiInstrument } from '../../types/midiClip';
import type { IMidiSynth } from './IMidiSynth';
import { getGmSampleBank, type GmSoundRef } from './GmSampleBank';
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

  /** Ensure the bank has the given GM sounds decoded before notes are scheduled. */
  async preload(refs: GmSoundRef[]): Promise<void> {
    await this.bank.ensureLoaded(refs);
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
      // Not loaded yet (or, for drums, this note has no mapped sample) — kick off a
      // load so subsequent notes sound. Preload is proactive (Phase 4), so for loaded
      // assets a null here means an unmapped drum note and the load is a cheap no-op.
      void this.bank.ensureLoaded([{ program: instrument.program, isDrum }]);
      return;
    }

    const peak = clamp01(velocity) * clamp01(instrument.gain);
    if (peak <= 0) return;

    const { source, zone } = built;
    const env = zone.envelope;
    const startAt = Math.max(when, ctx.currentTime);
    const attack = Math.max(0.001, env.attack);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startAt);
    const attackEnd = startAt + attack;
    gain.gain.exponentialRampToValueAtTime(peak, attackEnd);

    let endsAt: number;
    if (isDrum) {
      // One-shot percussion: hold peak and let the sample play out fully — the PCM
      // already encodes the decay, and a drum hit isn't gated by note duration. A
      // short tail fade avoids a click if the sample doesn't end exactly at zero.
      const sampleDuration = source.buffer ? source.buffer.duration : 0.5;
      endsAt = startAt + Math.max(attack, sampleDuration);
      gain.gain.setValueAtTime(peak, Math.max(attackEnd, endsAt - 0.01));
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
    } else {
      // Sustained melodic note: attack → decay toward the sustain level, HOLD while the
      // key is down, then release at the actual note-off. The hold must be anchored by
      // an explicit automation event AT noteOff — otherwise the release ramp below is
      // interpolated all the way from the decay's end, so the note bleeds away over its
      // whole length and organs/pads audibly "don't sustain". (cancelAndHoldAtTime is
      // unreliable for this in Chrome; an explicit setValueAtTime is robust.)
      const decay = Math.max(0.001, env.decay);
      const release = Math.max(0.005, env.release);
      const sustain = clamp01(env.sustain);
      const sustainLevel = Math.max(0.0001, peak * sustain);
      const decayEnd = attackEnd + decay;
      gain.gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
      const noteOff = Math.max(attackEnd, startAt + Math.max(0.02, duration));
      // Envelope level at noteOff: the sustain level once decay has completed, else the
      // exponential mid-decay value (a short note can interrupt a long decay) so the
      // hold doesn't click.
      const holdLevel = noteOff >= decayEnd
        ? sustainLevel
        : Math.max(0.0001, peak * Math.pow(sustainLevel / peak, (noteOff - attackEnd) / decay));
      gain.gain.cancelScheduledValues(noteOff);
      gain.gain.setValueAtTime(holdLevel, noteOff);
      endsAt = noteOff + release;
      gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
    }

    source.connect(gain);
    gain.connect(this.destination);
    source.start(startAt);
    source.stop(endsAt + 0.02);

    const voice: ActiveVoice = { source, gain, endsAt };
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
    if (instrument.kind === 'gm' && !this.bank.isLoaded(instrument.program, instrument.isDrum ?? false)) {
      // Load, then blip once ready so the first preview is audible.
      void this.bank
        .ensureLoaded([{ program: instrument.program, isDrum: instrument.isDrum ?? false }])
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
