import type { TemporalSampleMetadata } from '../TemporalSampleMetadata';

/** Delay, weighted relative source age, current-input weight, reserved.
 * Subtract in double precision before uploading float ages. Current input is
 * an explicit zero-age reference, not an invented decoded-frame timestamp.
 */
export function geometrySampleTimes(sampling: TemporalSampleMetadata, sourceNow: number): Float32Array<ArrayBuffer> {
  if (!Number.isFinite(sourceNow) || !sampling.samples.length) throw new Error('Geometry needs resolved source samples.');
  const values = new Float32Array(sampling.samples.length * 4);
  let previousDelay = -Infinity;
  sampling.samples.forEach((sample, index) => {
    if (!Number.isFinite(sample.delay) || sample.delay < previousDelay) throw new Error('Geometry sample delays must be ordered.');
    previousDelay = sample.delay;
    let age = 0, total = 0;
    for (const contribution of sample.contributions) {
      if (!Number.isFinite(contribution.sourceTime) || !Number.isFinite(contribution.weight) || contribution.weight < 0) {
        throw new Error('Geometry source contribution is invalid.');
      }
      age += (sourceNow - contribution.sourceTime) * contribution.weight;
      total += contribution.weight;
    }
    if (!sample.currentInput && Math.abs(total - 1) > 1e-5) throw new Error('Geometry source weights must sum to one.');
    values.set([sample.delay, sample.currentInput ? 0 : age, Number(sample.currentInput), 0], index * 4);
  });
  return values;
}

/** Same delay bracket, epsilon and nearest tie as the source color sampler.
 * Reduction to weighted age is linear, including both within-PTS and between-
 * grid interpolation. It does not assert that a blended pixel has one PTS.
 */
export const GEOMETRY_SAMPLE_TIME_WGSL = /* wgsl */`
@group(0) @binding(5) var<storage, read> sourceSamples: array<vec4f>;
fn sampledSourceAge(requestedDelay: f32, count: u32, nearest: bool) -> vec2f {
  if (count <= 1u) { return vec2f(0.0, 1.0); }
  let delay = max(0.0, requestedDelay);
  var lo = 1u; var hi = count - 1u;
  while (lo < hi) {
    let mid = (lo + hi) / 2u;
    if (sourceSamples[mid].x < delay) { lo = mid + 1u; } else { hi = mid; }
  }
  let young = sourceSamples[lo - 1u]; let old = sourceSamples[lo];
  var weight = clamp((delay-young.x)/max(old.x-young.x, .00001), 0.0, 1.0);
  if (nearest) { weight = select(0.0, 1.0, weight >= .5); }
  return mix(young.yz, old.yz, weight);
}
`;
