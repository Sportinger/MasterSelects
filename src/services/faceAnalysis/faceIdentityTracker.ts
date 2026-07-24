import type {
  FaceAnalysisBackend,
  FaceAnalysisResult,
  FaceFrameDetection,
  FacePersonSummary,
} from '../../types/clipMetadata';
import { FACE_ANALYSIS_MODEL_VERSION } from './modelCatalog';
import type { FaceRuntimeDetection } from './types';

const IDENTITY_COSINE_THRESHOLD = 0.45;
const ADJACENT_COSINE_THRESHOLD = 0.28;
const MAX_ADJACENT_GAP_SECONDS = 2.5;
const APPEARANCE_GAP_SECONDS = 1.25;

interface IdentityState {
  id: string;
  label: string;
  embedding: Float32Array;
  firstSeen: number;
  lastSeen: number;
  sampleCount: number;
  confidenceSum: number;
  maxConfidence: number;
  lastBox: FaceRuntimeDetection['box'];
  appearances: Array<{ start: number; end: number }>;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denominator = Math.sqrt(normA * normB);
  return denominator > 0 ? dot / denominator : -1;
}

function intersectionOverUnion(a: FaceRuntimeDetection['box'], b: FaceRuntimeDetection['box']): number {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a.width * a.height + b.width * b.height - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizedBlend(current: Float32Array, next: Float32Array, sampleCount: number): Float32Array {
  const weight = Math.min(0.25, 1 / Math.max(2, sampleCount));
  const result = new Float32Array(current.length);
  let norm = 0;
  for (let index = 0; index < result.length; index += 1) {
    const value = (current[index] ?? 0) * (1 - weight) + (next[index] ?? 0) * weight;
    result[index] = value;
    norm += value * value;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let index = 0; index < result.length; index += 1) result[index] /= norm;
  }
  return result;
}

function toPersonSummary(identity: IdentityState): FacePersonSummary {
  return {
    id: identity.id,
    label: identity.label,
    firstSeen: identity.firstSeen,
    lastSeen: identity.lastSeen,
    sampleCount: identity.sampleCount,
    averageConfidence: identity.confidenceSum / identity.sampleCount,
    maxConfidence: identity.maxConfidence,
    appearances: identity.appearances.map(range => ({ ...range })),
  };
}

export class FaceIdentityTracker {
  private readonly identities: IdentityState[] = [];
  private readonly identityPrefix: string;
  private observationIndex = 0;

  constructor(identityPrefix = 'person-') {
    this.identityPrefix = identityPrefix;
  }

  track(timestamp: number, detections: readonly FaceRuntimeDetection[]): FaceFrameDetection[] {
    const usedIdentities = new Set<string>();

    return detections
      .toSorted((a, b) => b.confidence - a.confidence)
      .map((detection) => {
        let best: IdentityState | null = null;
        let bestScore = -Infinity;

        for (const identity of this.identities) {
          if (usedIdentities.has(identity.id)) continue;
          const similarity = cosineSimilarity(identity.embedding, detection.embedding);
          const iou = intersectionOverUnion(identity.lastBox, detection.box);
          const isAdjacent = timestamp - identity.lastSeen <= MAX_ADJACENT_GAP_SECONDS;
          const qualifies = similarity >= IDENTITY_COSINE_THRESHOLD
            || (isAdjacent && similarity >= ADJACENT_COSINE_THRESHOLD && iou >= 0.08);
          if (!qualifies) continue;
          const score = similarity + (isAdjacent ? iou * 0.2 : 0);
          if (score > bestScore) {
            best = identity;
            bestScore = score;
          }
        }

        if (!best) {
          const number = this.identities.length + 1;
          best = {
            id: `${this.identityPrefix}${number}`,
            label: `Person ${number}`,
            embedding: detection.embedding.slice(),
            firstSeen: timestamp,
            lastSeen: timestamp,
            sampleCount: 0,
            confidenceSum: 0,
            maxConfidence: 0,
            lastBox: detection.box,
            appearances: [{ start: timestamp, end: timestamp }],
          };
          this.identities.push(best);
        }

        usedIdentities.add(best.id);
        best.sampleCount += 1;
        best.confidenceSum += detection.confidence;
        best.maxConfidence = Math.max(best.maxConfidence, detection.confidence);
        best.embedding = normalizedBlend(best.embedding, detection.embedding, best.sampleCount);
        best.lastBox = detection.box;
        const lastAppearance = best.appearances[best.appearances.length - 1];
        if (lastAppearance && timestamp - lastAppearance.end <= APPEARANCE_GAP_SECONDS) {
          lastAppearance.end = timestamp;
        } else {
          best.appearances.push({ start: timestamp, end: timestamp });
        }
        best.lastSeen = timestamp;

        this.observationIndex += 1;
        return {
          id: `${best.id}-face-${this.observationIndex}`,
          personId: best.id,
          label: best.label,
          confidence: detection.confidence,
          box: detection.box,
          landmarks: detection.landmarks,
        };
      });
  }

  summarize(backend: FaceAnalysisBackend): FaceAnalysisResult {
    const people = this.identities.map(toPersonSummary);
    return {
      schemaVersion: 1,
      modelVersion: FACE_ANALYSIS_MODEL_VERSION,
      detector: 'YuNet',
      recognizer: 'SFace',
      backend,
      observationCount: people.reduce((sum, person) => sum + person.sampleCount, 0),
      people,
    };
  }
}

export function createFaceIdentityPrefix(scope: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < scope.length; index += 1) {
    hash ^= scope.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `person-${(hash >>> 0).toString(36)}-`;
}

export function summarizeCachedFaces(
  frames: ReadonlyArray<{ timestamp: number; faces?: FaceFrameDetection[] }>,
): FaceAnalysisResult {
  const people = new Map<string, FacePersonSummary & { confidenceSum: number }>();

  for (const frame of frames) {
    for (const face of frame.faces ?? []) {
      const current = people.get(face.personId);
      if (!current) {
        people.set(face.personId, {
          id: face.personId,
          label: face.label,
          firstSeen: frame.timestamp,
          lastSeen: frame.timestamp,
          sampleCount: 1,
          averageConfidence: face.confidence,
          maxConfidence: face.confidence,
          confidenceSum: face.confidence,
          appearances: [{ start: frame.timestamp, end: frame.timestamp }],
        });
        continue;
      }
      current.lastSeen = frame.timestamp;
      current.sampleCount += 1;
      current.confidenceSum += face.confidence;
      current.averageConfidence = current.confidenceSum / current.sampleCount;
      current.maxConfidence = Math.max(current.maxConfidence, face.confidence);
      const last = current.appearances[current.appearances.length - 1];
      if (last && frame.timestamp - last.end <= APPEARANCE_GAP_SECONDS) last.end = frame.timestamp;
      else current.appearances.push({ start: frame.timestamp, end: frame.timestamp });
    }
  }

  return {
    schemaVersion: 1,
    modelVersion: FACE_ANALYSIS_MODEL_VERSION,
    detector: 'YuNet',
    recognizer: 'SFace',
    backend: 'cached',
    observationCount: [...people.values()].reduce((sum, person) => sum + person.sampleCount, 0),
    people: [...people.values()].map(({ confidenceSum: _confidenceSum, ...person }, index) => ({
      ...person,
      label: `Person ${index + 1}`,
    })),
  };
}
