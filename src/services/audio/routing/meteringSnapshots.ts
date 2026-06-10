import type { AudioMeterSnapshot } from '../../../types/audio';
import { calculateAudioMeterSnapshot } from '../audioMetering';
import { getRouteDynamicsSnapshot } from './dynamicsSnapshots';
import type { AudioRouteProcessorNode } from './routeGraphTypes';

interface MeteredRoute {
  analyserNode: AnalyserNode;
  leftAnalyserNode: AnalyserNode;
  rightAnalyserNode: AnalyserNode;
  meterBuffer: Float32Array<ArrayBuffer>;
  leftMeterBuffer: Float32Array<ArrayBuffer>;
  rightMeterBuffer: Float32Array<ArrayBuffer>;
  frequencyBuffer: Float32Array<ArrayBuffer>;
  processorNodes: AudioRouteProcessorNode[];
}

export interface ReadRouteMeterSnapshotOptions {
  // Spectrum data costs an analyser FFT read plus a per-snapshot Float32Array
  // copy (snapshots outlive the shared route buffer), so it is only gathered
  // when a spectrum consumer actually demands it.
  includeSpectrum?: boolean;
}

export function readRouteMeterSnapshot(
  route: MeteredRoute,
  updatedAt: number,
  options: ReadRouteMeterSnapshotOptions = {},
): AudioMeterSnapshot {
  route.analyserNode.getFloatTimeDomainData(route.meterBuffer);
  route.leftAnalyserNode.getFloatTimeDomainData(route.leftMeterBuffer);
  route.rightAnalyserNode.getFloatTimeDomainData(route.rightMeterBuffer);

  let spectrumDb: Float32Array | undefined;
  if (options.includeSpectrum) {
    route.analyserNode.getFloatFrequencyData(route.frequencyBuffer);
    spectrumDb = new Float32Array(route.frequencyBuffer);
  }

  return calculateAudioMeterSnapshot(
    route.meterBuffer,
    updatedAt,
    getRouteDynamicsSnapshot(route, updatedAt),
    { left: route.leftMeterBuffer, right: route.rightMeterBuffer },
    spectrumDb,
  );
}
