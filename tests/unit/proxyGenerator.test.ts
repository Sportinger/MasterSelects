import { describe, expect, it } from 'vitest';
import { getDurationSecondsFromSamples } from '../../src/services/proxyGenerator';
import type { Sample } from '../../src/engine/webCodecsTypes';

function sample(overrides: Partial<Sample>): Sample {
  return {
    number: 0,
    track_id: 1,
    data: new ArrayBuffer(0),
    size: 0,
    cts: 0,
    dts: 0,
    duration: 1001,
    is_sync: false,
    timescale: 30000,
    ...overrides,
  };
}

describe('proxyGenerator timing helpers', () => {
  it('derives duration from sample presentation timestamps when track duration is missing', () => {
    const samples = [
      sample({ number: 1, cts: 1001, dts: 0, is_sync: true }),
      sample({ number: 2, cts: 2002, dts: 1001 }),
      sample({ number: 3, cts: 3003, dts: 2002 }),
    ];

    expect(getDurationSecondsFromSamples(samples)).toBeCloseTo(3003 / 30000, 6);
  });

  it('uses presentation order instead of decode order for B-frame samples', () => {
    const samples = [
      sample({ number: 1, cts: 1001, dts: 0, is_sync: true }),
      sample({ number: 2, cts: 4004, dts: 1001 }),
      sample({ number: 3, cts: 2002, dts: 2002 }),
      sample({ number: 4, cts: 3003, dts: 3003 }),
    ];

    expect(getDurationSecondsFromSamples(samples)).toBeCloseTo(4004 / 30000, 6);
  });
});
