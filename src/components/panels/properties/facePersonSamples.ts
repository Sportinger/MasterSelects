import type { FacePersonSummary, FrameAnalysisData } from '../../../types/clipMetadata';
import type { FaceCropSample } from './FaceCropThumbnail';

export function collectFacePersonSamples(
  frames: readonly FrameAnalysisData[],
  person: FacePersonSummary,
  maxSupplementalSamples = 8,
): FaceCropSample[] {
  const observations = frames.flatMap(frame => (frame.faces ?? [])
    .filter(face => face.personId === person.id)
    .map(face => ({
      timestamp: frame.timestamp,
      box: face.box,
      confidence: face.confidence,
      manualSourcePersonId: face.manualSourcePersonId,
    })));
  if (observations.length === 0) return [];

  const selected = new Map<string, FaceCropSample>();
  const addSample = (sample: FaceCropSample | undefined) => {
    if (!sample) return;
    const key = `${sample.timestamp}:${sample.box.x}:${sample.box.y}`;
    selected.set(key, sample);
  };
  const bestSample = (samples: readonly FaceCropSample[]) => samples.reduce<FaceCropSample | undefined>(
    (best, sample) => (!best || sample.confidence > best.confidence ? sample : best),
    undefined,
  );

  // Every separated appearance gets a representative. This keeps a newly
  // merged ambient visible instead of allowing broad time sampling to hide it.
  for (const appearance of person.appearances) {
    addSample(bestSample(observations.filter(
      sample => sample.timestamp >= appearance.start && sample.timestamp <= appearance.end,
    )));
  }

  // User corrections remain explicit review samples across project reloads.
  const manualGroups = new Map<string, FaceCropSample[]>();
  for (const sample of observations) {
    if (!sample.manualSourcePersonId) continue;
    const group = manualGroups.get(sample.manualSourcePersonId) ?? [];
    group.push(sample);
    manualGroups.set(sample.manualSourcePersonId, group);
  }
  for (const samples of manualGroups.values()) addSample(bestSample(samples));

  const supplementalCount = Math.min(maxSupplementalSamples, observations.length);
  for (let index = 0; index < supplementalCount; index += 1) {
    const observationIndex = supplementalCount === 1
      ? 0
      : Math.round((index * (observations.length - 1)) / (supplementalCount - 1));
    addSample(observations[observationIndex]);
  }

  return [...selected.values()].toSorted((a, b) => a.timestamp - b.timestamp);
}

export function representativeFacePersonSample(samples: readonly FaceCropSample[]): FaceCropSample | undefined {
  return samples.reduce<FaceCropSample | undefined>(
    (best, sample) => (!best || sample.confidence > best.confidence ? sample : best),
    undefined,
  );
}
