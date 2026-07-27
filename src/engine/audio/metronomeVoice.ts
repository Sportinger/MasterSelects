// Metronome click voice (issue #299, Packet 5).
//
// One tone per click: an oscillator through a gain with a fast exponential
// decay. Cubase's click is the same idea — pitch and level distinguish the
// downbeat, so no assets and no sample loading are involved.
//
// Pure in the sense that matters here: it owns no state and no singleton. The
// caller supplies the context, the destination and the exact `when`, so the
// scheduler stays in charge of timing and routing.

/** Downbeat vs other beats — distinguished by pitch and level, like Cubase. */
const DOWNBEAT_HZ = 1000;
const BEAT_HZ = 800;
const BEAT_LEVEL_SCALE = 0.7;

const ATTACK_SECONDS = 0.002;
const CLICK_SECONDS = 0.04;
// exponentialRamp cannot reach 0, so decay to an inaudible floor instead.
const SILENCE = 0.0001;

export interface MetronomeClickOptions {
  isDownbeat: boolean;
  /** 0..1 user volume; the beat click is scaled below the downbeat. */
  volume: number;
}

/**
 * Schedule one click at AudioContext time `when`. A `when` already in the past
 * fires immediately rather than being dropped, so a late scheduler tick still
 * makes a sound.
 */
export function scheduleClick(
  context: BaseAudioContext,
  destination: AudioNode,
  when: number,
  { isDownbeat, volume }: MetronomeClickOptions,
): void {
  const level = Math.max(0, Math.min(1, volume)) * (isDownbeat ? 1 : BEAT_LEVEL_SCALE);
  if (level <= 0) return;

  const startAt = Math.max(when, context.currentTime);
  const oscillator = context.createOscillator();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(isDownbeat ? DOWNBEAT_HZ : BEAT_HZ, startAt);

  const gain = context.createGain();
  gain.gain.setValueAtTime(SILENCE, startAt);
  gain.gain.exponentialRampToValueAtTime(level, startAt + ATTACK_SECONDS);
  gain.gain.exponentialRampToValueAtTime(SILENCE, startAt + CLICK_SECONDS);

  oscillator.connect(gain);
  gain.connect(destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + CLICK_SECONDS + 0.02);
  oscillator.onended = () => {
    try {
      oscillator.disconnect();
      gain.disconnect();
    } catch {
      // already torn down
    }
  };
}
