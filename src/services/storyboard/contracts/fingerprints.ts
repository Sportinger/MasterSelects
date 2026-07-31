import {
  STORYBOARD_SCHEMA_VERSION,
  type JsonValue,
  type StoryboardCandidate,
  type StoryboardCoverage,
  type StoryboardDecision,
  type StoryboardEvidenceRef,
  type StoryboardFingerprint,
  type StoryboardGenerationBrief,
  type StoryboardPlan,
  type StoryboardProjectState,
  type StoryboardScene,
  type TimelineVariantOption,
  type TimelineVariantSet,
} from './models';

export interface StoryboardReferencedMediaFingerprint {
  mediaFileId: string;
  contentFingerprint?: string;
}

export interface StoryboardFingerprintSelection {
  planId?: string;
  sceneIds: string[];
  generationBriefIds: string[];
  candidateIds: string[];
  evidenceRefIds: string[];
  variantSetId?: string;
  variantOptionIds: string[];
  decisionIds: string[];
  includeCoverage: boolean;
  referencedMedia: StoryboardReferencedMediaFingerprint[];
}

export interface StoryboardFingerprintInput {
  schemaVersion: 1;
  selection: StoryboardFingerprintSelection;
  plan: StoryboardPlan | null;
  scenes: StoryboardScene[];
  generationBriefs: StoryboardGenerationBrief[];
  candidates: StoryboardCandidate[];
  evidenceRefs: StoryboardEvidenceRef[];
  coverage: StoryboardCoverage[];
  variantSet: TimelineVariantSet | null;
  variantOptions: TimelineVariantOption[];
  decisions: StoryboardDecision[];
}

function canonicalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, JsonValue> = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry !== undefined) sorted[key] = canonicalize(entry);
    }
    return sorted;
  }
  return value;
}

function sortUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function sortRecords<T extends { id: string }>(values: T[]): T[] {
  return values.toSorted((left, right) => left.id.localeCompare(right.id));
}

function selectRecords<T>(
  records: Record<string, T>,
  ids: readonly string[],
): T[] {
  return sortUnique(ids)
    .map((id) => records[id])
    .filter((record): record is T => record !== undefined);
}

export function createStoryboardFingerprintInput(
  state: StoryboardProjectState,
  selection: StoryboardFingerprintSelection,
): StoryboardFingerprintInput {
  const sceneIds = sortUnique(selection.sceneIds);
  const normalizedSelection: StoryboardFingerprintSelection = {
    ...(selection.planId === undefined ? {} : { planId: selection.planId }),
    sceneIds,
    generationBriefIds: sortUnique(selection.generationBriefIds),
    candidateIds: sortUnique(selection.candidateIds),
    evidenceRefIds: sortUnique(selection.evidenceRefIds),
    ...(selection.variantSetId === undefined
      ? {}
      : { variantSetId: selection.variantSetId }),
    variantOptionIds: sortUnique(selection.variantOptionIds),
    decisionIds: sortUnique(selection.decisionIds),
    includeCoverage: selection.includeCoverage,
    referencedMedia: selection.referencedMedia
      .map((entry) => ({ ...entry }))
      .toSorted((left, right) => left.mediaFileId.localeCompare(right.mediaFileId)),
  };

  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    selection: normalizedSelection,
    plan: normalizedSelection.planId
      ? state.plans[normalizedSelection.planId] ?? null
      : null,
    scenes: sortRecords(selectRecords(state.scenes, sceneIds)),
    generationBriefs: selectRecords(
      state.generationBriefs,
      normalizedSelection.generationBriefIds,
    ).toSorted((left, right) => (
      left.id.localeCompare(right.id) || left.revision - right.revision
    )),
    candidates: sortRecords(selectRecords(
      state.candidates,
      normalizedSelection.candidateIds,
    )),
    evidenceRefs: sortRecords(selectRecords(
      state.evidenceRefs,
      normalizedSelection.evidenceRefIds,
    )),
    coverage: normalizedSelection.includeCoverage
      ? sceneIds
        .map((sceneId) => state.coverageBySceneId[sceneId])
        .filter((coverage): coverage is StoryboardCoverage => coverage !== undefined)
        .toSorted((left, right) => left.sceneId.localeCompare(right.sceneId))
      : [],
    variantSet: normalizedSelection.variantSetId
      ? state.variantSets[normalizedSelection.variantSetId] ?? null
      : null,
    variantOptions: sortRecords(selectRecords(
      state.variantOptions,
      normalizedSelection.variantOptionIds,
    )),
    decisions: sortRecords(selectRecords(
      state.decisions,
      normalizedSelection.decisionIds,
    )),
  };
}

export function stableStringifyStoryboardFingerprintInput(
  input: StoryboardFingerprintInput,
): string {
  return JSON.stringify(canonicalize(input as unknown as JsonValue));
}

export async function hashStoryboardFingerprintInput(
  input: StoryboardFingerprintInput,
): Promise<StoryboardFingerprint> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('SHA-256 is unavailable in this runtime.');
  }
  const payload = stableStringifyStoryboardFingerprintInput(input);
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    algorithm: 'sha-256',
    value: Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join(''),
  };
}
