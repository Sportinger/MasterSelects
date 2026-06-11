import { describe, expect, it, vi } from 'vitest';
import { readRouteMeterSnapshot } from '../../../src/services/audio/routing/meteringSnapshots';

function makeAnalyser(fill: number) {
  return {
    getFloatTimeDomainData: vi.fn((buffer: Float32Array) => {
      buffer.fill(fill);
    }),
    getFloatFrequencyData: vi.fn((buffer: Float32Array) => {
      buffer.fill(-48);
    }),
  };
}

function makeRoute() {
  const analyserNode = makeAnalyser(0.5);
  const leftAnalyserNode = makeAnalyser(0.25);
  const rightAnalyserNode = makeAnalyser(-0.25);

  return {
    route: {
      analyserNode,
      leftAnalyserNode,
      rightAnalyserNode,
      meterBuffer: new Float32Array(8),
      leftMeterBuffer: new Float32Array(8),
      rightMeterBuffer: new Float32Array(8),
      frequencyBuffer: new Float32Array(4),
      processorNodes: [],
    },
    analyserNode,
    leftAnalyserNode,
    rightAnalyserNode,
  };
}

describe('readRouteMeterSnapshot', () => {
  it('reads only the mono analyser for level-only snapshots', () => {
    const { route, analyserNode, leftAnalyserNode, rightAnalyserNode } = makeRoute();

    const snapshot = readRouteMeterSnapshot(route, 1000);

    expect(snapshot.peakLinear).toBeCloseTo(0.5);
    expect(snapshot.channels).toBeUndefined();
    expect(snapshot.phaseCorrelation).toBeUndefined();
    expect(analyserNode.getFloatTimeDomainData).toHaveBeenCalledOnce();
    expect(leftAnalyserNode.getFloatTimeDomainData).not.toHaveBeenCalled();
    expect(rightAnalyserNode.getFloatTimeDomainData).not.toHaveBeenCalled();
  });

  it('reads stereo analysers only when stereo or phase is requested', () => {
    const stereo = makeRoute();
    const stereoSnapshot = readRouteMeterSnapshot(stereo.route, 1000, { includeStereo: true });

    expect(stereoSnapshot.channels?.left.peakLinear).toBeCloseTo(0.25);
    expect(stereoSnapshot.phaseCorrelation).toBeUndefined();
    expect(stereo.leftAnalyserNode.getFloatTimeDomainData).toHaveBeenCalledOnce();
    expect(stereo.rightAnalyserNode.getFloatTimeDomainData).toHaveBeenCalledOnce();

    const phase = makeRoute();
    const phaseSnapshot = readRouteMeterSnapshot(phase.route, 1000, { includePhase: true });

    expect(phaseSnapshot.channels).toBeUndefined();
    expect(phaseSnapshot.phaseCorrelation).toBeCloseTo(-1);
    expect(phase.leftAnalyserNode.getFloatTimeDomainData).toHaveBeenCalledOnce();
    expect(phase.rightAnalyserNode.getFloatTimeDomainData).toHaveBeenCalledOnce();
  });
});
