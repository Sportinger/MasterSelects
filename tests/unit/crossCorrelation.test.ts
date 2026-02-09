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
});
