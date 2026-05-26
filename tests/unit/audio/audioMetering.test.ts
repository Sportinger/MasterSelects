import { describe, expect, it } from 'vitest';
import {
  aggregateAudioMeterSnapshots,
  calculateAudioMeterSnapshot,
  calculateStereoPhaseCorrelation,
  calculateStereoWidth,
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

  it('calculates stereo phase and width from matching channels', () => {
    const stereoSamples = {
      left: [0.25, -0.5, 0.75, -0.25],
      right: [0.25, -0.5, 0.75, -0.25],
    };

    const meter = calculateAudioMeterSnapshot(stereoSamples.left, 1000, undefined, stereoSamples);

    expect(calculateStereoPhaseCorrelation(stereoSamples)).toBeCloseTo(1);
    expect(calculateStereoWidth(stereoSamples)).toBeCloseTo(0);
    expect(meter.phaseCorrelation).toBeCloseTo(1);
    expect(meter.stereoWidth).toBeCloseTo(0);
    expect(meter.channels?.left.peakLinear).toBeCloseTo(0.75);
    expect(meter.channels?.right.peakLinear).toBeCloseTo(0.75);
  });

  it('detects inverted stereo channels as negative correlation', () => {
    const stereoSamples = {
      left: [0.25, -0.5, 0.75, -0.25],
      right: [-0.25, 0.5, -0.75, 0.25],
    };

    expect(calculateStereoPhaseCorrelation(stereoSamples)).toBeCloseTo(-1);
    expect(calculateStereoWidth(stereoSamples)).toBeCloseTo(2);
  });

  it('aggregates stereo meter fields from available track snapshots', () => {
    const master = aggregateAudioMeterSnapshots([
      {
        peakLinear: 0.2,
        rmsLinear: 0.1,
        peakDb: -13.98,
        rmsDb: -20,
        clipping: false,
        phaseCorrelation: 1,
        stereoWidth: 0.2,
        channels: {
          left: {
            peakLinear: 0.2,
            rmsLinear: 0.1,
            peakDb: -13.98,
            rmsDb: -20,
          },
          right: {
            peakLinear: 0.1,
            rmsLinear: 0.05,
            peakDb: -20,
            rmsDb: -26.02,
          },
        },
        updatedAt: 1000,
      },
      {
        peakLinear: 0.4,
        rmsLinear: 0.2,
        peakDb: -7.96,
        rmsDb: -13.98,
        clipping: false,
        phaseCorrelation: -0.5,
        stereoWidth: 0.6,
        channels: {
          left: {
            peakLinear: 0.25,
            rmsLinear: 0.1,
            peakDb: -12.04,
            rmsDb: -20,
          },
          right: {
            peakLinear: 0.4,
            rmsLinear: 0.2,
            peakDb: -7.96,
            rmsDb: -13.98,
          },
        },
        updatedAt: 1008,
      },
    ], 1010);

    expect(master.phaseCorrelation).toBeCloseTo(0.25);
    expect(master.stereoWidth).toBeCloseTo(0.4);
    expect(master.channels?.left.peakLinear).toBeCloseTo(0.25);
    expect(master.channels?.right.peakLinear).toBeCloseTo(0.4);
    expect(master.channels?.left.rmsLinear).toBeCloseTo(Math.sqrt(0.02));
    expect(master.channels?.right.rmsLinear).toBeCloseTo(Math.sqrt(0.0425));
  });
});
