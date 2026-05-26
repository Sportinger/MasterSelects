import { describe, expect, it } from 'vitest';
import {
  aggregateAudioMeterSnapshots,
  calculateAudioMeterSnapshot,
} from '../../../src/services/audio/audioMetering';

describe('audioMetering', () => {
  it('attaches live dynamics reduction snapshots to calculated meters', () => {
    const meter = calculateAudioMeterSnapshot([0.25, -0.5, 0.1], 1000, {
      compressor: {
        effectId: 'compressor',
        processorType: 'compressor',
        gainReductionDb: 4.5,
        updatedAt: 1000,
      },
    });

    expect(meter.peakLinear).toBe(0.5);
    expect(meter.dynamics?.compressor).toEqual({
      effectId: 'compressor',
      processorType: 'compressor',
      gainReductionDb: 4.5,
      updatedAt: 1000,
    });
  });

  it('aggregates master dynamics by strongest reduction per effect id', () => {
    const master = aggregateAudioMeterSnapshots([
      {
        peakLinear: 0.2,
        rmsLinear: 0.1,
        peakDb: -13.98,
        rmsDb: -20,
        clipping: false,
        updatedAt: 1000,
        dynamics: {
          comp: {
            effectId: 'comp',
            processorType: 'compressor',
            gainReductionDb: 2,
            updatedAt: 1000,
          },
        },
      },
      {
        peakLinear: 0.4,
        rmsLinear: 0.2,
        peakDb: -7.96,
        rmsDb: -13.98,
        clipping: false,
        updatedAt: 1008,
        dynamics: {
          comp: {
            effectId: 'comp',
            processorType: 'compressor',
            gainReductionDb: 7,
            updatedAt: 1008,
          },
        },
      },
    ], 1010);

    expect(master.peakLinear).toBe(0.4);
    expect(master.dynamics?.comp).toEqual({
      effectId: 'comp',
      processorType: 'compressor',
      gainReductionDb: 7,
      updatedAt: 1010,
    });
  });
});
