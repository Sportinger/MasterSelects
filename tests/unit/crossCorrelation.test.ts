import { describe, it, expect } from 'vitest';
import { crossCorrelate } from '../../src/services/audioSync';

// Helper: create a simple signal
function createSignal(length: number, fn: (i: number) => number): Float32Array {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    arr[i] = fn(i);
  }
  return arr;
}

// ─── crossCorrelate ────────────────────────────────────────────────────────

describe('crossCorrelate', () => {
  it('identical signals → offset=0 with high correlation', () => {
    // Use a larger signal with a mix of frequencies for unambiguous correlation
    const signal = createSignal(1000, (i) => Math.sin(i * 0.05) + 0.5 * Math.sin(i * 0.13));
    const { offset, correlation } = crossCorrelate(signal, signal, 20);
    expect(offset).toBe(0);
    expect(correlation).toBeGreaterThan(0);
  });

  it('shifted signal → correct positive offset', () => {
    // Use mixed frequencies so the correlation peak is unambiguous
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 20);
    expect(offset).toBe(5);
  });

  it('shifted signal → correct negative offset', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i + 5) * 0.05) + 0.5 * Math.cos((i + 5) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 20);
    expect(offset).toBe(-5);
  });

  it('silent signals → correlation ~0', () => {
    const silence = new Float32Array(100); // all zeros
    const { correlation } = crossCorrelate(silence, silence, 10);
    expect(correlation).toBe(0);
  });

  it('uncorrelated signals → low correlation', () => {
    // Two different frequency signals
    const sig1 = createSignal(200, (i) => Math.sin(i * 0.1));
    const sig2 = createSignal(200, (i) => Math.sin(i * 0.37)); // different frequency
    const { correlation: correlated } = crossCorrelate(sig1, sig1, 10);
    const { correlation: uncorrelated } = crossCorrelate(sig1, sig2, 10);
    // Self-correlation should be higher than cross-correlation
    expect(correlated).toBeGreaterThan(uncorrelated);
  });

  it('different lengths work without errors', () => {
    const sig1 = createSignal(100, (i) => Math.sin(i * 0.1));
    const sig2 = createSignal(50, (i) => Math.sin(i * 0.1));
    const result = crossCorrelate(sig1, sig2, 10);
    expect(result).toHaveProperty('offset');
    expect(result).toHaveProperty('correlation');
  });

  // ─── maxOffsetSamples boundary tests ──────────────────────────────────────

  it('maxOffsetSamples=0 → only tests offset=0 (no shifting)', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 0);
    // With maxOffset=0, only offset=0 is tested, so the result offset is 0
    // (algorithm iterates from -0 to 0, i.e. a single iteration)
    expect(offset + 0).toBe(0); // +0 normalizes -0 to 0
    expect(Math.abs(offset)).toBe(0);
  });

  it('offset at exact maxOffsetSamples boundary is found', () => {
    // Shift of exactly 10 samples, search range of 10
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 10) * 0.05) + 0.5 * Math.cos((i - 10) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(offset).toBe(10);
  });

  it('offset beyond maxOffsetSamples is NOT found (clipped)', () => {
    // Shift of 15 samples but only searching ±10
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 15) * 0.05) + 0.5 * Math.cos((i - 15) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(offset).not.toBe(15);
  });

  it('negative offset at exact -maxOffsetSamples boundary is found', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i + 10) * 0.05) + 0.5 * Math.cos((i + 10) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(offset).toBe(-10);
  });

  // ─── Symmetry tests ──────────────────────────────────────────────────────

  it('swapping signals negates the offset', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 7) * 0.05) + 0.5 * Math.cos((i - 7) * 0.13));
    const result1 = crossCorrelate(base, shifted, 20);
    const result2 = crossCorrelate(shifted, base, 20);
    expect(result1.offset).toBe(7);
    expect(result2.offset).toBe(-7);
  });

  it('swapping identical signals → offset=0 both ways', () => {
    const signal = createSignal(300, (i) => Math.sin(i * 0.05) + 0.5 * Math.sin(i * 0.13));
    const r1 = crossCorrelate(signal, signal, 10);
    const r2 = crossCorrelate(signal, signal, 10);
    expect(r1.offset).toBe(0);
    expect(r2.offset).toBe(0);
    expect(r1.correlation).toBeCloseTo(r2.correlation, 10);
  });

  // ─── Signal property tests ────────────────────────────────────────────────

  it('inverted signal → negative correlation at offset=0', () => {
    const signal = createSignal(200, (i) => Math.sin(i * 0.1));
    const inverted = createSignal(200, (i) => -Math.sin(i * 0.1));
    const { offset, correlation } = crossCorrelate(signal, inverted, 10);
    // At offset=0 the product is always negative, so best correlation should be negative or offset chosen to minimize negativity
    // The correlation at offset=0 is the negative of the self-correlation
    const selfCorr = crossCorrelate(signal, signal, 0).correlation;
    // Check that inverted correlation is the negative of self-correlation
    const invertedAtZero = crossCorrelate(signal, inverted, 0).correlation;
    expect(invertedAtZero).toBeCloseTo(-selfCorr, 5);
  });

  it('amplitude scaling does not affect offset detection', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const scaled = createSignal(500, (i) => 3 * (Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13)));
    const { offset } = crossCorrelate(base, scaled, 20);
    expect(offset).toBe(5);
  });

  it('amplitude scaling affects correlation magnitude', () => {
    const signal = createSignal(200, (i) => Math.sin(i * 0.1));
    const scaled = createSignal(200, (i) => 2 * Math.sin(i * 0.1));
    const selfCorr = crossCorrelate(signal, signal, 5).correlation;
    const scaledCorr = crossCorrelate(signal, scaled, 5).correlation;
    // Correlation with 2x signal should be ~2x the self-correlation
    expect(scaledCorr).toBeCloseTo(selfCorr * 2, 1);
  });

  it('DC signal (constant non-zero) → all offsets have equal correlation', () => {
    const dc = createSignal(100, () => 1.0);
    const { offset, correlation } = crossCorrelate(dc, dc, 10);
    // For a DC signal, correlation = sum(1*1)/count = 1.0 at every offset
    // The algorithm picks the first offset that reaches max, which is -maxOffset
    expect(offset).toBe(-10);
    expect(correlation).toBeCloseTo(1.0, 5);
  });

  it('DC signal with different amplitudes → correlation is product of amplitudes', () => {
    const dc1 = createSignal(100, () => 2.0);
    const dc2 = createSignal(100, () => 3.0);
    const { correlation } = crossCorrelate(dc1, dc2, 5);
    // At every offset the product is 2*3=6, normalized by count = 6.0
    expect(correlation).toBeCloseTo(6.0, 5);
  });

  // ─── Impulse / spike tests ────────────────────────────────────────────────

  it('impulse (delta) signal detects correct offset', () => {
    // Single spike at position 50
    const sig1 = createSignal(200, (i) => (i === 50 ? 1.0 : 0.0));
    // Single spike at position 55 (shifted by 5)
    const sig2 = createSignal(200, (i) => (i === 55 ? 1.0 : 0.0));
    const { offset } = crossCorrelate(sig1, sig2, 20);
    expect(offset).toBe(5);
  });

  it('impulse signal → correlation is 1/overlapCount at best offset', () => {
    const sig1 = createSignal(100, (i) => (i === 50 ? 1.0 : 0.0));
    const { offset, correlation } = crossCorrelate(sig1, sig1, 10);
    expect(offset).toBe(0);
    // correlation = (1 * 1) / 100 = 0.01
    expect(correlation).toBeCloseTo(1 / 100, 10);
  });

  it('two impulses at different positions', () => {
    // Two spikes in sig1, shifted version in sig2
    const sig1 = createSignal(200, (i) => (i === 30 || i === 80 ? 1.0 : 0.0));
    const sig2 = createSignal(200, (i) => (i === 33 || i === 83 ? 1.0 : 0.0));
    const { offset } = crossCorrelate(sig1, sig2, 10);
    expect(offset).toBe(3);
  });

  // ─── Edge cases with small signals ────────────────────────────────────────

  it('single-sample signals → offset=0 with correct correlation', () => {
    const sig1 = new Float32Array([5.0]);
    const sig2 = new Float32Array([3.0]);
    const { offset, correlation } = crossCorrelate(sig1, sig2, 0);
    // With maxOffset=0, loop runs once at offset=-0, which is effectively 0
    expect(Math.abs(offset)).toBe(0);
    expect(correlation).toBeCloseTo(15.0, 5); // 5*3 / 1
  });

  it('two-sample signals with shift', () => {
    const sig1 = new Float32Array([0, 1]);
    const sig2 = new Float32Array([1, 0]);
    const result = crossCorrelate(sig1, sig2, 1);
    // At offset=-1: sig1[0]*sig2[-1] invalid, only valid overlap: none meaningful
    // At offset=0: sig1[0]*sig2[0] + sig1[1]*sig2[1] = 0*1 + 1*0 = 0, norm by 2 = 0
    // At offset=1: sig1[0]*sig2[1]=0*0=0, sig1[1]*sig2[2] invalid => only sig1[0]*sig2[1]=0, norm by 1 = 0
    // Actually at offset=-1: i=0,j=-1 invalid; i=1,j=0 => sig1[1]*sig2[0]=1*1=1, norm by 1 = 1
    expect(result.offset).toBe(-1);
    expect(result.correlation).toBeCloseTo(1.0, 5);
  });

  it('empty signals (length 0) → correlation defaults', () => {
    const empty = new Float32Array(0);
    const { offset, correlation } = crossCorrelate(empty, empty, 5);
    // No overlap possible, count stays 0, correlation stays 0
    // bestCorrelation initialized to -Infinity, but no iteration updates it...
    // Actually the loop runs from -5 to 5, but signal1.length = 0 so inner loop never runs
    // correlation stays 0 for each offset, but 0 > -Infinity so bestCorrelation becomes 0
    expect(offset).toBe(-5); // First offset that achieves 0 correlation
    expect(correlation).toBe(0);
  });

  // ─── Correlation value verification ───────────────────────────────────────

  it('self-correlation is maximal (higher than any shifted version)', () => {
    const signal = createSignal(300, (i) => Math.sin(i * 0.05) + 0.5 * Math.sin(i * 0.13));
    const selfResult = crossCorrelate(signal, signal, 20);
    // Self-correlation at offset=0 should be the maximum
    expect(selfResult.offset).toBe(0);
    // Verify that the returned correlation is indeed the max by comparing with an offset
    for (let testOffset = 1; testOffset <= 20; testOffset++) {
      const shifted = createSignal(300, (i) => Math.sin((i - testOffset) * 0.05) + 0.5 * Math.sin((i - testOffset) * 0.13));
      const shiftedResult = crossCorrelate(signal, shifted, 0); // only check offset=0
      expect(selfResult.correlation).toBeGreaterThanOrEqual(shiftedResult.correlation);
    }
  });

  it('correlation is properly normalized by overlap count', () => {
    // For a constant signal of value 1.0, correlation at any offset = 1*1 * count / count = 1.0
    const dc = createSignal(50, () => 1.0);
    const result = crossCorrelate(dc, dc, 10);
    // At offset=0, count=50, sum=50, correlation=50/50=1.0
    expect(result.correlation).toBeCloseTo(1.0, 5);
    // At offset=5, count=45, sum=45, correlation=45/45=1.0 (still 1.0)
    // So offset should be chosen by first max encountered which is -10
    // Actually all offsets give correlation=1.0 for DC signal
    // The best is 1.0, which first occurs at offset=-10
    expect(result.correlation).toBeCloseTo(1.0, 5);
  });

  // ─── Noisy signal tests ───────────────────────────────────────────────────

  it('signal with added noise still detects correct offset', () => {
    // Deterministic pseudo-random noise using a simple LCG
    const seed = 42;
    function pseudoRandom(n: number): number {
      // Simple hash-based noise
      const x = Math.sin(n * 12.9898 + seed * 78.233) * 43758.5453;
      return x - Math.floor(x);
    }

    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const noisy = createSignal(500, (i) =>
      Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13) + 0.1 * (pseudoRandom(i) - 0.5)
    );
    const { offset } = crossCorrelate(base, noisy, 20);
    expect(offset).toBe(5);
  });

  it('moderate noise still yields higher correlation than uncorrelated signals', () => {
    function pseudoRandom(n: number): number {
      const x = Math.sin(n * 12.9898 + 7 * 78.233) * 43758.5453;
      return x - Math.floor(x);
    }

    const base = createSignal(500, (i) => Math.sin(i * 0.05));
    const noisy = createSignal(500, (i) => Math.sin(i * 0.05) + 0.2 * (pseudoRandom(i) - 0.5));
    const unrelated = createSignal(500, (i) => Math.sin(i * 0.37));

    const { correlation: noisyCorr } = crossCorrelate(base, noisy, 10);
    const { correlation: unrelatedCorr } = crossCorrelate(base, unrelated, 10);

    expect(noisyCorr).toBeGreaterThan(unrelatedCorr);
  });

  // ─── Large offset tests ───────────────────────────────────────────────────

  it('detects large offset correctly when maxOffsetSamples is large enough', () => {
    const shift = 50;
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - shift) * 0.05) + 0.5 * Math.cos((i - shift) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 60);
    expect(offset).toBe(shift);
  });

  it('detects large negative offset correctly', () => {
    const shift = 50;
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i + shift) * 0.05) + 0.5 * Math.cos((i + shift) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 60);
    expect(offset).toBe(-shift);
  });

  // ─── Return type / structure tests ────────────────────────────────────────

  it('returns an object with offset (number) and correlation (number)', () => {
    const signal = createSignal(100, (i) => Math.sin(i * 0.1));
    const result = crossCorrelate(signal, signal, 5);
    expect(typeof result.offset).toBe('number');
    expect(typeof result.correlation).toBe('number');
    expect(Number.isFinite(result.offset)).toBe(true);
    expect(Number.isFinite(result.correlation)).toBe(true);
  });

  it('offset is always an integer (sample-level precision)', () => {
    const base = createSignal(300, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(300, (i) => Math.sin((i - 3) * 0.05) + 0.5 * Math.cos((i - 3) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(Number.isInteger(offset)).toBe(true);
  });

  // ─── Multi-frequency / complex signal tests ───────────────────────────────

  it('complex multi-frequency signal with small offset', () => {
    const base = createSignal(1000, (i) =>
      Math.sin(i * 0.03) + 0.7 * Math.cos(i * 0.07) + 0.3 * Math.sin(i * 0.17)
    );
    const shifted = createSignal(1000, (i) =>
      Math.sin((i - 2) * 0.03) + 0.7 * Math.cos((i - 2) * 0.07) + 0.3 * Math.sin((i - 2) * 0.17)
    );
    const { offset } = crossCorrelate(base, shifted, 15);
    expect(offset).toBe(2);
  });

  it('square wave signal detects correct offset', () => {
    // Square wave with period 20
    const base = createSignal(400, (i) => (Math.floor(i / 10) % 2 === 0 ? 1.0 : -1.0));
    const shifted = createSignal(400, (i) => (Math.floor((i - 3) / 10) % 2 === 0 ? 1.0 : -1.0));
    const { offset } = crossCorrelate(base, shifted, 15);
    expect(offset).toBe(3);
  });

  // ─── Signal where sig2 is much shorter than sig1 ─────────────────────────

  it('short sig2 with long sig1 detects approximately correct offset', () => {
    // With different signal lengths, normalization by overlap count introduces slight bias
    // so we allow +-1 sample tolerance
    const sig1 = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const sig2 = createSignal(100, (i) => Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13));
    const { offset } = crossCorrelate(sig1, sig2, 20);
    expect(offset).toBeGreaterThanOrEqual(4);
    expect(offset).toBeLessThanOrEqual(6);
  });

  it('short sig1 with long sig2 detects correct shifted offset', () => {
    const sig1 = createSignal(100, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const sig2 = createSignal(500, (i) => Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13));
    const { offset } = crossCorrelate(sig1, sig2, 20);
    expect(offset).toBe(5);
  });

  // ─── Maximal overlap vs partial overlap ───────────────────────────────────

  it('correlation at offset=0 uses all samples for equal-length signals', () => {
    // With offset=0 and equal lengths, overlap count = signal length
    // Verify indirectly: constant signal should give exactly constant^2
    const dc = createSignal(100, () => 2.0);
    const { correlation } = crossCorrelate(dc, dc, 0);
    // sum = 2*2*100 = 400, count = 100, correlation = 400/100 = 4.0
    expect(correlation).toBeCloseTo(4.0, 5);
  });

  it('positive offset reduces overlap by removing start of sig2', () => {
    // For a DC signal, all offsets should give the same normalized correlation
    const dc = createSignal(100, () => 1.0);
    const result0 = crossCorrelate(dc, dc, 0);
    const result10 = crossCorrelate(dc, dc, 10);
    // Both should give correlation 1.0 since normalization handles count difference
    expect(result0.correlation).toBeCloseTo(1.0, 5);
    expect(result10.correlation).toBeCloseTo(1.0, 5);
  });

  // ─── Additional waveform type tests ───────────────────────────────────────

  it('sawtooth wave signal detects correct offset', () => {
    // Sawtooth with period 20
    const base = createSignal(400, (i) => ((i % 20) / 20) - 0.5);
    const shifted = createSignal(400, (i) => (((i - 4) % 20) / 20) - 0.5);
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(offset).toBe(4);
  });

  it('exponential decay signal detects correct offset', () => {
    const base = createSignal(500, (i) =>
      Math.exp(-i * 0.01) * Math.sin(i * 0.1)
    );
    const shifted = createSignal(500, (i) =>
      Math.exp(-(i - 8) * 0.01) * Math.sin((i - 8) * 0.1)
    );
    const { offset } = crossCorrelate(base, shifted, 20);
    expect(offset).toBe(8);
  });

  // ─── Determinism and consistency tests ────────────────────────────────────

  it('results are deterministic across repeated calls', () => {
    const sig1 = createSignal(300, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const sig2 = createSignal(300, (i) => Math.sin((i - 4) * 0.05) + 0.5 * Math.cos((i - 4) * 0.13));
    const r1 = crossCorrelate(sig1, sig2, 15);
    const r2 = crossCorrelate(sig1, sig2, 15);
    const r3 = crossCorrelate(sig1, sig2, 15);
    expect(r1.offset).toBe(r2.offset);
    expect(r2.offset).toBe(r3.offset);
    expect(r1.correlation).toBe(r2.correlation);
    expect(r2.correlation).toBe(r3.correlation);
  });

  it('increasing maxOffsetSamples does not change correct result', () => {
    const base = createSignal(500, (i) => Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => Math.sin((i - 5) * 0.05) + 0.5 * Math.cos((i - 5) * 0.13));
    const r10 = crossCorrelate(base, shifted, 10);
    const r20 = crossCorrelate(base, shifted, 20);
    const r50 = crossCorrelate(base, shifted, 50);
    // All should find the same offset of 5
    expect(r10.offset).toBe(5);
    expect(r20.offset).toBe(5);
    expect(r50.offset).toBe(5);
  });

  // ─── Overlap at extremes ──────────────────────────────────────────────────

  it('maxOffset larger than signal length still works', () => {
    const sig = createSignal(50, (i) => Math.sin(i * 0.1));
    // maxOffset=100 > signal length=50
    const result = crossCorrelate(sig, sig, 100);
    expect(result.offset).toBe(0);
    expect(Number.isFinite(result.correlation)).toBe(true);
  });

  it('single overlapping sample at extreme offset gives finite correlation', () => {
    // Signal of length 10, at offset=9 only 1 sample overlaps
    const sig1 = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const sig2 = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
    const result = crossCorrelate(sig1, sig2, 9);
    // At offset=9: sig1[0]*sig2[9] = 1*1 = 1, count=1, correlation=1.0
    expect(result.offset).toBe(9);
    expect(result.correlation).toBeCloseTo(1.0, 5);
  });

  // ─── Mixed positive/negative value signals ────────────────────────────────

  it('signal with DC offset still detects correct shift', () => {
    // Signal with a DC component (mean != 0) + oscillation
    const base = createSignal(500, (i) => 2.0 + Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13));
    const shifted = createSignal(500, (i) => 2.0 + Math.sin((i - 6) * 0.05) + 0.5 * Math.cos((i - 6) * 0.13));
    const { offset } = crossCorrelate(base, shifted, 20);
    expect(offset).toBe(6);
  });

  it('purely negative signal works correctly', () => {
    const base = createSignal(500, (i) => -Math.abs(Math.sin(i * 0.05) + 0.5 * Math.cos(i * 0.13)));
    const shifted = createSignal(500, (i) => -Math.abs(Math.sin((i - 3) * 0.05) + 0.5 * Math.cos((i - 3) * 0.13)));
    const { offset } = crossCorrelate(base, shifted, 10);
    expect(offset).toBe(3);
  });
});
