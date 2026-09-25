import type { CanvasTransport } from './nodeCanvasTypes';

type Sample = Pick<CanvasTransport, 'playhead' | 'playing' | 'active' | 'visible' | 'playbackSpeed' | 'timestamp'>;
/** Signal dots appear almost at once when playback or a scrub starts and fade out in place when it stops. */
const FADE_IN_MS = 100;
const FADE_OUT_MS = 260;
const ease = (value: number) => value * value * (3 - 2 * value);
/** Transport speed drives decorative motion; graph direction stays output -> input. */
export class NodeFlowClock {
  private previous: Sample | undefined;
  private lastAdvance = 0;
  private expires = 0;
  private phase = 0;
  private fade = { from: 0, to: 0, start: -Infinity };
  rate = 0;

  /** Opacity of the signal dots, 0 when hidden and 1 while playback or scrubbing runs. */
  level(now: number): number {
    const t = Math.min(1, Math.max(0, (now - this.fade.start) / this.fadeMs()));
    return this.fade.from + (this.fade.to - this.fade.from) * ease(t);
  }
  /** True while a fade still needs frames, including the final frame at its end value. */
  fading(now: number): boolean { return now < this.fade.start + this.fadeMs() + 40; }
  private fadeMs() { return this.fade.to ? FADE_IN_MS : FADE_OUT_MS; }

  update(sample: Sample, now: number) {
    this.advance(now);
    const previous = this.previous;
    if (!sample.active || !sample.visible) { this.rate = 0; this.expires = now; }
    else if (sample.playing) {
      this.rate = Math.abs(sample.playbackSpeed ?? 1);
      this.expires = Infinity;
    } else if (previous && !previous.playing && sample.playhead !== previous.playhead) {
      // Time stamps come from the producer, so worker delivery delays do not
      // change the measured scrub speed. A new gesture starts after 180 ms idle.
      const elapsed = Math.max(1, Math.min(180, (sample.timestamp ?? now) - (previous.timestamp ?? now - 16)));
      this.rate = Math.abs(sample.playhead - previous.playhead) * 1000 / elapsed;
      this.expires = now + 180;
    } else if (previous?.playing) { this.rate = 0; this.expires = now; }
    const target = sample.active && sample.visible ? 1 : 0;
    if (target !== this.fade.to) this.fade = { from: this.level(now), to: target, start: now };
    if (!previous || sample.playhead !== previous.playhead || sample.playing !== previous.playing) this.previous = sample;
    this.lastAdvance = now;
  }

  advance(now: number): number {
    if (this.previous) this.phase += Math.max(0, Math.min(now, this.expires) - this.lastAdvance) * this.rate / 1000;
    this.lastAdvance = now;
    return this.phase;
  }
}
