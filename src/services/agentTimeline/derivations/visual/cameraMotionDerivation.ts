import { AGENT_TIMELINE_EVENT_SCHEMA_VERSION } from '../../../../types/agentTimeline/manifest';
import {
  CAMERA_MOTION_DERIVATION_VERSION,
  type CameraMotionDerivationOptions,
  type CameraMotionReason,
  type CameraMotionSample,
  type CameraMotionThresholds,
  type DerivedCameraMotionData,
  type DerivedCameraMotionEvent,
} from '../../../../types/agentTimeline/visualDerivations';
import { clampUnit, derivationProvenance, stableVisualEventId } from './visualDerivationCore';

export const DEFAULT_CAMERA_MOTION_THRESHOLDS: CameraMotionThresholds = Object.freeze({
  staticMaxGlobalMotion: 0.04,
  staticMaxLocalMotion: 0.04,
  staticMaxMeanMagnitude: 0.25,
  directionalMinMeanMagnitude: 0.4,
  directionalMinCoherence: 0.65,
  directionalMinCoverage: 0.2,
  dominantAxisRatio: 1.5,
  handheldMinLocalMotion: 0.18,
  handheldMaxCoherence: 0.45,
});

interface Classification {
  motion: DerivedCameraMotionData['motion'];
  direction?: DerivedCameraMotionData['direction'];
  reason: CameraMotionReason;
  confidence: number;
}

function hasDirectionalMeasurements(sample: CameraMotionSample): boolean {
  return Number.isFinite(sample.meanMagnitude)
    && Number.isFinite(sample.meanX)
    && Number.isFinite(sample.meanY)
    && Number.isFinite(sample.directionCoherence)
    && Number.isFinite(sample.coverageRatio)
    && Boolean(sample.vectorConvention);
}

function classifySample(sample: CameraMotionSample, thresholds: CameraMotionThresholds): Classification {
  const globalMotion = clampUnit(sample.globalMotion);
  const localMotion = clampUnit(sample.localMotion);
  if (sample.isSceneCut) return { motion: 'unknown', reason: 'scene-cut-excluded', confidence: 0 };
  const belowStaticMagnitude = sample.meanMagnitude === undefined
    || sample.meanMagnitude <= thresholds.staticMaxMeanMagnitude;
  if (globalMotion <= thresholds.staticMaxGlobalMotion
    && localMotion <= thresholds.staticMaxLocalMotion
    && belowStaticMagnitude) {
    const activityRatio = Math.max(
      globalMotion / thresholds.staticMaxGlobalMotion,
      localMotion / thresholds.staticMaxLocalMotion,
      (sample.meanMagnitude ?? 0) / thresholds.staticMaxMeanMagnitude,
    );
    return {
      motion: 'static',
      reason: 'below-static-thresholds',
      confidence: clampUnit(1 - activityRatio * 0.5),
    };
  }
  if (!hasDirectionalMeasurements(sample)) {
    return { motion: 'unknown', reason: 'missing-directional-measurements', confidence: 0 };
  }

  const magnitude = Math.max(0, sample.meanMagnitude!);
  const coherence = clampUnit(sample.directionCoherence!);
  const coverage = clampUnit(sample.coverageRatio!);
  if (localMotion >= thresholds.handheldMinLocalMotion
    && magnitude >= thresholds.directionalMinMeanMagnitude
    && coherence <= thresholds.handheldMaxCoherence) {
    return {
      motion: 'handheld',
      reason: 'low-coherence-local-activity',
      confidence: clampUnit(Math.min(localMotion, 1 - coherence)),
    };
  }
  if (magnitude < thresholds.directionalMinMeanMagnitude
    || coherence < thresholds.directionalMinCoherence
    || coverage < thresholds.directionalMinCoverage) {
    return { motion: 'unknown', reason: 'diagonal-or-weak-global-flow', confidence: 0 };
  }

  const conventionSign = sample.vectorConvention === 'image-flow' ? -1 : 1;
  const cameraX = sample.meanX! * conventionSign;
  const cameraY = sample.meanY! * conventionSign;
  const absoluteX = Math.abs(cameraX);
  const absoluteY = Math.abs(cameraY);
  const directionalConfidence = clampUnit(Math.min(coherence, coverage / thresholds.directionalMinCoverage));
  if (absoluteX >= absoluteY * thresholds.dominantAxisRatio) {
    return {
      motion: 'pan',
      direction: cameraX < 0 ? 'left' : 'right',
      reason: 'horizontal-coherent-flow',
      confidence: directionalConfidence,
    };
  }
  if (absoluteY >= absoluteX * thresholds.dominantAxisRatio) {
    return {
      motion: 'tilt',
      direction: cameraY < 0 ? 'up' : 'down',
      reason: 'vertical-coherent-flow',
      confidence: directionalConfidence,
    };
  }
  return { motion: 'unknown', reason: 'diagonal-or-weak-global-flow', confidence: 0 };
}

function sampleInterval(
  sample: CameraMotionSample,
  next: CameraMotionSample | undefined,
  defaultDuration: number,
  range: CameraMotionDerivationOptions['range'],
): { start: number; end: number } | undefined {
  if (!Number.isFinite(sample.time)) return undefined;
  const naturalEnd = Number.isFinite(sample.end) && sample.end! > sample.time
    ? sample.end!
    : next && next.time > sample.time ? next.time : sample.time + defaultDuration;
  const start = range ? Math.max(sample.time, range.start) : sample.time;
  const end = range ? Math.min(naturalEnd, range.end) : naturalEnd;
  return start < end ? { start, end } : undefined;
}

function measurements(sample: CameraMotionSample): DerivedCameraMotionData['measurements'] {
  return {
    globalMotion: clampUnit(sample.globalMotion),
    localMotion: clampUnit(sample.localMotion),
    meanMagnitude: Number.isFinite(sample.meanMagnitude) ? sample.meanMagnitude : undefined,
    meanX: Number.isFinite(sample.meanX) ? sample.meanX : undefined,
    meanY: Number.isFinite(sample.meanY) ? sample.meanY : undefined,
    coverageRatio: Number.isFinite(sample.coverageRatio) ? clampUnit(sample.coverageRatio!) : undefined,
  };
}

function weighted(left: number, right: number, leftDuration: number, rightDuration: number): number {
  return (left * leftDuration + right * rightDuration) / (leftDuration + rightDuration);
}

function weightedOptional(
  left: number | undefined,
  right: number | undefined,
  leftDuration: number,
  rightDuration: number,
): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return weighted(left, right, leftDuration, rightDuration);
}

export function deriveCameraMotionSpans(
  inputSamples: CameraMotionSample[],
  options: CameraMotionDerivationOptions,
): DerivedCameraMotionEvent[] {
  if (!Number.isFinite(options.defaultSampleDuration) || options.defaultSampleDuration <= 0) {
    throw new TypeError('defaultSampleDuration must be positive');
  }
  const thresholds = { ...DEFAULT_CAMERA_MOTION_THRESHOLDS, ...options.thresholds };
  const samples = inputSamples.toSorted((left, right) => left.time - right.time);
  const provenance = derivationProvenance(
    'camera-motion-derivation',
    CAMERA_MOTION_DERIVATION_VERSION,
    options.provenance,
  );
  const events: DerivedCameraMotionEvent[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const interval = sampleInterval(sample, samples[index + 1], options.defaultSampleDuration, options.range);
    if (!interval) continue;
    const classification = classifySample(sample, thresholds);
    const data: DerivedCameraMotionData = {
      motion: classification.motion,
      direction: classification.direction,
      magnitude: clampUnit(sample.globalMotion),
      coherence: Number.isFinite(sample.directionCoherence) ? clampUnit(sample.directionCoherence!) : undefined,
      reason: classification.reason,
      measurements: measurements(sample),
    };
    const previous = events.at(-1);
    if (previous
      && previous.time.temporalKind === 'interval'
      && previous.time.end === interval.start
      && previous.data.motion === data.motion
      && previous.data.direction === data.direction
      && previous.data.reason === data.reason) {
      const previousDuration = previous.time.end - previous.time.start;
      const duration = interval.end - interval.start;
      previous.confidence = weighted(previous.confidence, classification.confidence, previousDuration, duration);
      previous.data.magnitude = weighted(previous.data.magnitude ?? 0, data.magnitude ?? 0, previousDuration, duration);
      previous.data.coherence = weightedOptional(previous.data.coherence, data.coherence, previousDuration, duration);
      previous.data.measurements.globalMotion = weighted(
        previous.data.measurements.globalMotion,
        data.measurements.globalMotion,
        previousDuration,
        duration,
      );
      previous.data.measurements.localMotion = weighted(
        previous.data.measurements.localMotion,
        data.measurements.localMotion,
        previousDuration,
        duration,
      );
      previous.data.measurements.meanMagnitude = weightedOptional(
        previous.data.measurements.meanMagnitude,
        data.measurements.meanMagnitude,
        previousDuration,
        duration,
      );
      previous.data.measurements.meanX = weightedOptional(
        previous.data.measurements.meanX,
        data.measurements.meanX,
        previousDuration,
        duration,
      );
      previous.data.measurements.meanY = weightedOptional(
        previous.data.measurements.meanY,
        data.measurements.meanY,
        previousDuration,
        duration,
      );
      previous.data.measurements.coverageRatio = weightedOptional(
        previous.data.measurements.coverageRatio,
        data.measurements.coverageRatio,
        previousDuration,
        duration,
      );
      previous.time.end = interval.end;
      previous.id = stableVisualEventId('camera-motion', [
        previous.time.start,
        previous.time.end,
        classification.motion,
        classification.direction ?? 'none',
      ]);
      continue;
    }
    events.push({
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: stableVisualEventId('camera-motion', [interval.start, interval.end, classification.motion, classification.direction ?? 'none']),
      type: 'camera-motion',
      time: { temporalKind: 'interval', timeDomain: 'source', ...interval },
      confidence: classification.confidence,
      provenance: provenance.map((entry) => ({ ...entry })),
      data,
    });
  }
  return events;
}
