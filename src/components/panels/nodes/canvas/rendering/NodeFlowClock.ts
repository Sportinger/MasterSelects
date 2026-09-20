import type { CanvasTransport } from './nodeCanvasTypes';

type Sample = Pick<CanvasTransport, 'playhead' | 'playing' | 'active' | 'visible' | 'playbackSpeed' | 'timestamp'>;
/** Transport speed drives decorative motion; graph direction stays output -> input. */
export class NodeFlowClock {
  private previous: Sample | undefined;
  private lastAdvance = 0;
  private expires = 0;
  private phase = 0;
  rate = 0;

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
    if (!previous || sample.playhead !== previous.playhead || sample.playing !== previous.playing) this.previous = sample;
    this.lastAdvance = now;
  }

  advance(now: number): number {
    if (this.previous) this.phase += Math.max(0, Math.min(now, this.expires) - this.lastAdvance) * this.rate / 1000;
    this.lastAdvance = now;
    return this.phase;
  }
}
