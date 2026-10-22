import { describe, expect, it } from 'vitest';
import { nodeValueDecimals, nodeValueText } from '../../src/components/panels/nodes/previews/nodeValueFormat';

describe('node value card numbers', () => {
  it('shows tiny constants exactly instead of rounding them to 0', () => {
    expect(nodeValueText(0.000001)).toBe('0.000001');
    expect(nodeValueText(-0.0000123456)).toBe('-0.0000123');
    expect(nodeValueText(1.5e-9)).toBe('1.5e-9');
    expect(nodeValueText(0)).toBe('0');
  });

  it('keeps four decimals for ordinary values', () => {
    expect(nodeValueText(0.5)).toBe('0.5');
    expect(nodeValueText(1 / 3)).toBe('0.3333');
    expect(nodeValueText(0.0123456)).toBe('0.0123');
    expect(nodeValueText(-1e30)).toBe('-1e+30');
  });

  it('gives a number field enough decimals for a tiny value', () => {
    expect(nodeValueDecimals(0.5, 3)).toBe(3);
    expect(nodeValueDecimals(0.000001, 3)).toBe(6);
    expect((0.000001).toFixed(nodeValueDecimals(0.000001, 3))).toBe('0.000001');
    expect((1.5e-9).toFixed(nodeValueDecimals(1.5e-9, 3))).toBe('0.0000000015');
  });
});
