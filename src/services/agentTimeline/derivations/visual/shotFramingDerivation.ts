import { AGENT_TIMELINE_EVENT_SCHEMA_VERSION } from '../../../../types/agentTimeline/manifest';
import {
  SHOT_FRAMING_DERIVATION_VERSION,
  type DerivedShotFramingData,
  type DerivedShotFramingEvent,
  type ShotBoundaryInput,
  type ShotFaceFrameSample,
  type ShotFramingDerivationOptions,
  type ShotFramingThresholds,
  type VisualFaceObservation,
} from '../../../../types/agentTimeline/visualDerivations';
import { clampUnit, derivationProvenance, median, stableVisualEventId } from './visualDerivationCore';

export const DEFAULT_SHOT_FRAMING_THRESHOLDS: ShotFramingThresholds = Object.freeze({
  minimumFaceConfidence: 0.55,
  minimumFaceHeight: 0.03,
  minimumFaceFrameCoverage: 0.5,
  extremeCloseUpMinHeight: 0.65,
  closeUpMinHeight: 0.42,
  mediumMinHeight: 0.24,
  mediumWideMinHeight: 0.1,
  leftMaxCenterX: 0.4,
  rightMinCenterX: 0.6,
});

function validBox(face: VisualFaceObservation, thresholds: ShotFramingThresholds): boolean {
  const box = face.box;
  return face.identityEligible
    && clampUnit(face.confidence) >= thresholds.minimumFaceConfidence
    && [box.x, box.y, box.width, box.height].every(Number.isFinite)
    && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height >= thresholds.minimumFaceHeight
    && box.x + box.width <= 1 && box.y + box.height <= 1;
}

function reliableFaces(frame: ShotFaceFrameSample, thresholds: ShotFramingThresholds): VisualFaceObservation[] {
  const byPerson = new Map<string, VisualFaceObservation>();
  for (const face of frame.faces) {
    if (!validBox(face, thresholds)) continue;
    const previous = byPerson.get(face.sourcePersonId);
    if (!previous || face.confidence > previous.confidence
      || (face.confidence === previous.confidence && face.id.localeCompare(previous.id) < 0)) {
      byPerson.set(face.sourcePersonId, face);
    }
  }
  return [...byPerson.values()].toSorted((left, right) => left.sourcePersonId.localeCompare(right.sourcePersonId));
}

function modalFaceCount(counts: number[]): { count: number; stability: number } {
  const frequencies = new Map<number, number>();
  for (const count of counts) frequencies.set(count, (frequencies.get(count) ?? 0) + 1);
  const ranked = [...frequencies.entries()].toSorted(([leftCount, leftFrequency], [rightCount, rightFrequency]) => (
    rightFrequency - leftFrequency || leftCount - rightCount
  ));
  const [count, frequency] = ranked[0] ?? [0, 0];
  return { count, stability: counts.length > 0 ? frequency / counts.length : 0 };
}

function shotSize(height: number, thresholds: ShotFramingThresholds): DerivedShotFramingData['shotSize'] {
  if (height >= thresholds.extremeCloseUpMinHeight) return 'extreme-close-up';
  if (height >= thresholds.closeUpMinHeight) return 'close-up';
  if (height >= thresholds.mediumMinHeight) return 'medium';
  if (height >= thresholds.mediumWideMinHeight) return 'medium-wide';
  return 'wide';
}

function layout(count: number): DerivedShotFramingData['layout'] {
  if (count === 1) return 'single';
  if (count === 2) return 'two-shot';
  if (count >= 3) return 'group';
  return 'unknown';
}

function position(centerX: number, thresholds: ShotFramingThresholds): DerivedShotFramingData['dominantFacePosition'] {
  if (centerX < thresholds.leftMaxCenterX) return 'left';
  if (centerX > thresholds.rightMinCenterX) return 'right';
  return 'center';
}

function unknownData(shot: ShotBoundaryInput, reason: DerivedShotFramingData['framingReason'], coverage: number): DerivedShotFramingData {
  return {
    shotId: shot.shotId,
    index: shot.index,
    setupId: shot.setupId,
    shotSize: 'unknown',
    layout: 'unknown',
    framingReason: reason,
    dominantFacePosition: 'unknown',
    reliableFaceFrameCoverage: coverage,
  };
}

export function deriveShotFramingEvents(
  inputShots: ShotBoundaryInput[],
  inputFrames: ShotFaceFrameSample[],
  options: ShotFramingDerivationOptions = {},
): DerivedShotFramingEvent[] {
  const thresholds = { ...DEFAULT_SHOT_FRAMING_THRESHOLDS, ...options.thresholds };
  const shots = inputShots.filter((shot) => Number.isFinite(shot.start) && Number.isFinite(shot.end) && shot.start < shot.end)
    .toSorted((left, right) => left.start - right.start || left.end - right.end || left.shotId.localeCompare(right.shotId));
  const frames = inputFrames.filter((frame) => Number.isFinite(frame.time)).toSorted((left, right) => left.time - right.time);
  const provenance = derivationProvenance(
    'shot-framing-derivation',
    SHOT_FRAMING_DERIVATION_VERSION,
    options.provenance,
  );
  return shots.map((shot) => {
    const shotFrames = frames.filter((frame) => shot.start <= frame.time && frame.time < shot.end);
    const faceFrames = shotFrames.map((frame) => reliableFaces(frame, thresholds));
    const coveredFrameCount = faceFrames.filter((faces) => faces.length > 0).length;
    const faceFrameCoverage = shotFrames.length > 0 ? coveredFrameCount / shotFrames.length : 0;
    let data: DerivedShotFramingData;
    let confidence = 0;
    if (coveredFrameCount === 0) {
      data = unknownData(shot, 'no-reliable-face', 0);
    } else if (faceFrameCoverage < thresholds.minimumFaceFrameCoverage) {
      data = unknownData(shot, 'insufficient-face-coverage', faceFrameCoverage);
    } else {
      const dominantFaces = faceFrames.flatMap((faces) => {
        if (faces.length === 0) return [];
        return [faces.toSorted((left, right) => (
          right.box.width * right.box.height - left.box.width * left.box.height || left.id.localeCompare(right.id)
        ))[0]];
      });
      const dominantHeight = median(dominantFaces.map((face) => face.box.height))!;
      const centerX = median(dominantFaces.map((face) => face.box.x + face.box.width / 2))!;
      const headroom = median(dominantFaces.map((face) => face.box.y))!;
      const edgeProximity = median(dominantFaces.map((face) => Math.min(
        face.box.x,
        face.box.y,
        1 - face.box.x - face.box.width,
        1 - face.box.y - face.box.height,
      )))!;
      const count = modalFaceCount(faceFrames.map((faces) => faces.length));
      const averageFaceConfidence = dominantFaces.reduce((sum, face) => sum + clampUnit(face.confidence), 0)
        / dominantFaces.length;
      confidence = clampUnit(Math.min(averageFaceConfidence, faceFrameCoverage, count.stability));
      data = {
        shotId: shot.shotId,
        index: shot.index,
        setupId: shot.setupId,
        shotSize: shotSize(dominantHeight, thresholds),
        layout: layout(count.count),
        framingReason: 'derived-from-face-boxes',
        dominantFacePosition: position(centerX, thresholds),
        dominantFaceHeight: dominantHeight,
        headroom,
        edgeProximity,
        reliableFaceFrameCoverage: faceFrameCoverage,
      };
    }
    return {
      schemaVersion: AGENT_TIMELINE_EVENT_SCHEMA_VERSION,
      id: stableVisualEventId('shot-framing', [shot.shotId, shot.start, shot.end]),
      type: 'shot',
      time: { temporalKind: 'interval', timeDomain: 'source', start: shot.start, end: shot.end },
      confidence,
      provenance: provenance.map((entry) => ({ ...entry })),
      data,
    };
  });
}
