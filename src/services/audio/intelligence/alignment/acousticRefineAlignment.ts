import type { TranscriptWord } from '../../../../types/clipMetadata';
import type { AlignedWordTiming } from '../../transcriptTimingManifest';
import type { AudioSpan } from '../../voiceActivityManifest';

export interface EnergyEnvelope {
  values: Float32Array;
  hopSeconds: number;
  startSeconds: number;
}

export interface AcousticRefineInput {
  words: readonly Pick<TranscriptWord, 'id' | 'text' | 'start' | 'end'>[];
  wordSource: 'synthetic' | 'provider';
  vadSegments: readonly AudioSpan[];
  energy: EnergyEnvelope;
  onsets?: readonly number[];
}

interface CandidateTiming extends AlignedWordTiming { inputIndex: number }

const PROVIDER_RANGE = 0.08;
const SYNTHETIC_RANGE = 0.12;
const MIN_DURATION = 0.02;
const EPSILON = 1e-9;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function energyValleys(energy: EnergyEnvelope): number[] {
  if (!Number.isFinite(energy.hopSeconds) || energy.hopSeconds <= 0) return [];
  const valleys: number[] = [];
  for (let index = 1; index < energy.values.length - 1; index += 1) {
    const previous = energy.values[index - 1];
    const current = energy.values[index];
    const next = energy.values[index + 1];
    if (!Number.isFinite(previous) || !Number.isFinite(current) || !Number.isFinite(next)) continue;
    if (current <= previous && current <= next && (current < previous || current < next)) {
      valleys.push(energy.startSeconds + index * energy.hopSeconds);
    }
  }
  return valleys;
}

function sortedUnique(values: readonly number[]): number[] {
  return values
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right)
    .filter((value, index, sorted) =>
      index === 0 || Math.abs(value - (sorted[index - 1] ?? value)) > EPSILON);
}

function nearestTarget(time: number, targets: readonly number[], range: number): number | undefined {
  let nearest: number | undefined;
  let distance = range + EPSILON;
  for (const target of targets) {
    const candidateDistance = Math.abs(target - time);
    if (candidateDistance < distance - EPSILON
      || (Math.abs(candidateDistance - distance) <= EPSILON
        && (nearest === undefined || target < nearest))) {
      nearest = target;
      distance = candidateDistance;
    }
  }
  return distance <= range + EPSILON ? nearest : undefined;
}

function providerTimings(input: AcousticRefineInput, valleys: readonly number[]): CandidateTiming[] {
  const vadEdges = input.vadSegments.flatMap(segment => [segment.start, segment.end]);
  const targets = sortedUnique([...valleys, ...vadEdges, ...(input.onsets ?? [])]);
  return input.words.map((word, inputIndex) => {
    const alignedStart = nearestTarget(word.start, targets, PROVIDER_RANGE) ?? word.start;
    const alignedEnd = nearestTarget(word.end, targets, PROVIDER_RANGE) ?? word.end;
    const movedSeconds = Math.max(
      Math.abs(alignedStart - word.start),
      Math.abs(alignedEnd - word.end),
    );
    return {
      wordId: word.id,
      alignedStart,
      alignedEnd,
      confidence: clamp(1 - movedSeconds / PROVIDER_RANGE, 0.3, 1),
      inputIndex,
    };
  });
}

function distanceToSegment(time: number, segment: AudioSpan): number {
  if (time < segment.start) return segment.start - time;
  if (time > segment.end) return time - segment.end;
  return 0;
}

function segmentForWord(
  word: Pick<TranscriptWord, 'start' | 'end'>,
  segments: readonly AudioSpan[],
): number {
  const midpoint = (word.start + word.end) / 2;
  const containing = segments.findIndex(segment =>
    midpoint >= segment.start && midpoint <= segment.end);
  if (containing >= 0) return containing;
  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;
  segments.forEach((segment, index) => {
    const distance = distanceToSegment(midpoint, segment);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });
  return nearestIndex;
}

function syntheticTimings(input: AcousticRefineInput, valleys: readonly number[]): CandidateTiming[] {
  if (input.vadSegments.length === 0) {
    return input.words.map((word, inputIndex) => ({
      wordId: word.id,
      alignedStart: word.start,
      alignedEnd: word.end,
      confidence: 0.2,
      inputIndex,
    }));
  }
  const groups = input.vadSegments.map(() => [] as number[]);
  input.words.forEach((word, index) => groups[segmentForWord(word, input.vadSegments)].push(index));
  const results: CandidateTiming[] = [];
  groups.forEach((wordIndexes, segmentIndex) => {
    if (wordIndexes.length === 0) return;
    const segment = input.vadSegments[segmentIndex];
    const weights = wordIndexes.map(index => Math.max(1, Array.from(input.words[index].text).length));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    const duration = Math.max(0, segment.end - segment.start);
    const boundaries = [segment.start];
    const snapped = [false];
    let accumulatedWeight = 0;
    for (let index = 0; index < wordIndexes.length - 1; index += 1) {
      accumulatedWeight += weights[index];
      const proportional = segment.start + duration * accumulatedWeight / totalWeight;
      const valley = nearestTarget(proportional, valleys, SYNTHETIC_RANGE);
      boundaries.push(valley ?? proportional);
      snapped.push(valley !== undefined);
    }
    boundaries.push(segment.end);
    snapped.push(false);
    wordIndexes.forEach((wordIndex, groupIndex) => {
      results.push({
        wordId: input.words[wordIndex].id,
        alignedStart: boundaries[groupIndex],
        alignedEnd: boundaries[groupIndex + 1],
        confidence: 0.5 + (snapped[groupIndex] || snapped[groupIndex + 1] ? 0.2 : 0),
        inputIndex: wordIndex,
      });
    });
  });
  return results.toSorted((left, right) => left.inputIndex - right.inputIndex);
}

function enforceMonotonic(timings: readonly CandidateTiming[]): AlignedWordTiming[] {
  let previousEnd = Number.NEGATIVE_INFINITY;
  return timings.map((timing) => {
    const alignedStart = Math.max(timing.alignedStart, previousEnd);
    const alignedEnd = Math.max(timing.alignedEnd, alignedStart + MIN_DURATION);
    previousEnd = alignedEnd;
    return { wordId: timing.wordId, alignedStart, alignedEnd, confidence: timing.confidence };
  });
}

export function refineWordTimings(input: AcousticRefineInput): AlignedWordTiming[] {
  const valleys = energyValleys(input.energy);
  return enforceMonotonic(input.wordSource === 'provider'
    ? providerTimings(input, valleys)
    : syntheticTimings(input, valleys));
}
