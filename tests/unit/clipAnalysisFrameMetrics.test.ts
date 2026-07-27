import { describe, expect, it } from 'vitest';
import { classifyMotion } from '../../src/engine/analysis/opticalFlow/flowStatsMath';
import { analyzeFrameVisualMetrics } from '../../src/services/clipAnalysis/frameMetrics';

function solidFrame(value: number): ImageData {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { width: 4, height: 4, data } as ImageData;
}

describe('clip analysis visual metrics', () => {
  it('measures real sampled luma instead of a constant brightness placeholder', () => {
    expect(analyzeFrameVisualMetrics(solidFrame(0))).toEqual({
      sharpness: 0,
      brightness: 0,
    });
    expect(analyzeFrameVisualMetrics(solidFrame(255))).toEqual({
      sharpness: 0,
      brightness: 1,
    });
  });

  it('retains GPU optical-flow direction and coherence in the motion result', () => {
    expect(classifyMotion({
      meanMagnitude: 5,
      magnitudeVariance: 0.2,
      meanVx: -4,
      meanVy: 0.2,
      directionCoherence: 0.9,
      coverageRatio: 0.8,
      maxMagnitude: 8,
    })).toMatchObject({
      meanMagnitude: 5,
      meanX: -4,
      meanY: 0.2,
      directionCoherence: 0.9,
      coverageRatio: 0.8,
      vectorConvention: 'image-flow',
    });
  });
});
