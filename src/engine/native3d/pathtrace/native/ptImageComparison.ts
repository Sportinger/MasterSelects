/** Compare untonemapped linear premultiplied radiance; display clipping cannot hide a shader mismatch. */
export function comparePtImages(reference: Float32Array, candidate: Float32Array) {
  if (reference.length !== candidate.length || reference.length % 4) throw new Error('Image dimensions differ');
  let squaredError = 0, squaredReference = 0, coverageError = 0, nonFinite = 0;
  const coverage = [0, 0], luminance = [0, 0];
  for (let i = 0; i < reference.length; i += 4) {
    for (let c = 0; c < 4; c++) if (!Number.isFinite(reference[i + c]) || !Number.isFinite(candidate[i + c])) nonFinite++;
    for (let c = 0; c < 3; c++) { squaredError += (reference[i + c] - candidate[i + c]) ** 2; squaredReference += reference[i + c] ** 2; }
    coverageError += Math.abs(reference[i + 3] - candidate[i + 3]);
    coverage[0] += reference[i + 3]; coverage[1] += candidate[i + 3];
    for (const [c, weight] of [0.2126, 0.7152, 0.0722].entries()) {
      luminance[0] += reference[i + c] * weight; luminance[1] += candidate[i + c] * weight;
    }
  }
  return { relativeRmse: Math.sqrt(squaredError / Math.max(squaredReference, 1e-30)),
    coverageMae: coverageError / Math.max(1, reference.length / 4), nonFinite,
    meanCoverage: coverage.map(value => value / Math.max(1, reference.length / 4)),
    meanLuminance: luminance.map(value => value / Math.max(1, reference.length / 4)) };
}
