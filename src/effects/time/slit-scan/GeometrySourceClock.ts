import { temporalSourceTime, type TemporalClipSource } from '../temporalClipSource';

/** The clip's source mapping is stable while its playhead moves. Keep a
 * relative lookup table and update only its delay range and current clock. */
export class GeometrySourceClock {
  private signature = '';
  private table = new Float32Array(8193);
  private origin = 0;

  sample(source: TemporalClipSource, factor: number) {
    if (!(factor > 0) || !Number.isFinite(factor)) throw new Error('Invalid geometry time factor.');
    const signature = JSON.stringify({ ...source, localTime: undefined });
    const changed = signature !== this.signature;
    if (changed) {
      this.origin = temporalSourceTime(source, 0);
      for (let i = 0; i <= 8192; i++) {
        this.table[i] = temporalSourceTime(source, source.duration * (1 - i / 8192)) - this.origin;
      }
      this.signature = signature;
    }
    return { changed, table: this.table, range: new Float32Array([
      (source.localTime - source.duration) / factor, Math.max(source.duration / factor, 1e-8),
      8192, temporalSourceTime(source, source.localTime) - this.origin,
    ]) };
  }
}
