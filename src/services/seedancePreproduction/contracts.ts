import {
  parseSeedanceOrchestrationEvent,
  parseSeedanceOrchestrationRun,
  parseSeedanceStoryPreferences,
  parseSeedanceScenePlan,
  type SeedanceOrchestrationEvent,
  type SeedanceOrchestrationPublicRun,
  type SeedanceScenePlan,
  type SeedanceStoryPreferences,
} from './orchestrationContracts';
export type SeedancePreproductionPhase =
  | 'idle'
  | 'generating-ideas'
  | 'choosing-idea'
  | 'writing-story'
  | 'planning-assets'
  | 'researching'
  | 'reviewing-media'
  | 'implementing-edit'
  | 'edit-ready'
  | 'generating-masters'
  | 'choosing-master'
  | 'generating-keyframes'
  | 'reviewing-keyframes'
  | 'ready'
  | 'failed';

export interface SeedanceStoryIdea {
  id: string;
  title: string;
  summary: string;
  tone: string;
  targetDurationSeconds?: number;
}

export interface SeedancePlanningSource {
  id: string;
  name: string;
  mimeType: string;
  text: string;
  truncated: boolean;
  pageCount?: number;
}

export interface SeedancePlanningDocument extends SeedancePlanningSource {
  byteLength: number;
  createdAt: number;
  format: 'markdown' | 'pdf' | 'text';
  lastModified: number;
}

export type SeedanceProjectSourceKind =
  | 'analysis'
  | 'document'
  | 'media-metadata'
  | 'scene-descriptions'
  | 'transcript'
  | 'visual-frame-manifest';

export interface SeedanceProjectSourceEntry {
  schemaVersion: 1;
  id: string;
  kind: SeedanceProjectSourceKind;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  sourceMediaId?: string;
}

export interface SeedanceSourceBundleReference {
  schemaVersion: 1;
  id: string;
  fingerprint: string;
  createdAt: number;
  entryCount: number;
}

export interface SeedanceStoryScene {
  id: string;
  title: string;
  summary: string;
  durationSeconds: number;
  narration: string;
  visualIntent: string;
}

export interface SeedanceResearchRequirement {
  id: string;
  query: string;
  purpose: string;
  sceneId: string;
  assetNeedId?: string;
  alternativeQueries?: string[];
}

export interface SeedanceResearchAttempt {
  query: string;
  status: 'succeeded' | 'failed';
  resultCount: number;
  error?: string;
}

export interface SeedanceResearchDiagnostic {
  requirementId: string;
  sceneId: string;
  requestedQuery: string;
  status: 'matched' | 'empty' | 'failed';
  resultCount: number;
  attempts: SeedanceResearchAttempt[];
}

export interface SeedanceStory {
  schemaVersion: 1;
  kind: 'story';
  title: string;
  logline: string;
  summary: string;
  aspectRatio: string;
  totalDurationSeconds: number;
  scenes: SeedanceStoryScene[];
  researchRequirements: SeedanceResearchRequirement[];
}

export type SeedanceAssetSourceKind =
  | 'commons'
  | 'project-source'
  | 'practical-footage'
  | 'generated-image'
  | 'motion-graphic'
  | 'reconstruction'
  | 'designed-visual';

export interface SeedanceAssetNeed {
  id: string;
  sceneId: string;
  description: string;
  cameraDirection: string;
  sourceKind: SeedanceAssetSourceKind;
  priority: 'required' | 'supporting';
  commonsQueries: string[];
}

export interface SeedanceAssetPlan {
  schemaVersion: 1;
  kind: 'asset-plan';
  assetNeeds: SeedanceAssetNeed[];
}

export interface CommonsSourceAsset {
  id: string;
  requirementId: string;
  sceneIds: string[];
  title: string;
  description: string;
  creator: string;
  credit: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
  originalUrl: string;
  thumbnailUrl: string;
  mimeType: string;
  width?: number;
  height?: number;
  pageId: number;
  revisionId?: number;
  retrievedAt: number;
  importToken: string;
  selected: boolean;
  mediaFileId?: string;
}

export interface SeedanceMasterLook {
  id: string;
  title: string;
  description: string;
  prompt: string;
  negativePrompt: string;
  generationRecordId?: string;
  mediaFileId?: string;
  status: 'planned' | 'generating' | 'ready' | 'failed';
  error?: string;
}

export interface SeedanceKeyframeBrief {
  id: string;
  sceneId: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  referenceAssetIds: string[];
  previousKeyframeIds: string[];
}

export interface SeedanceKeyframeVersion {
  id: string;
  briefId: string;
  createdAt: number;
  generationRecordId?: string;
  mediaFileId?: string;
  status: 'planned' | 'generating' | 'ready' | 'failed';
  error?: string;
}

export interface SeedanceShotTiming {
  keyframeId: string;
  startSeconds: number;
  endSeconds: number;
}

export interface SeedanceSegmentPackage {
  id: string;
  title: string;
  durationSeconds: number;
  prompt: string;
  negativePrompt: string;
  keyframeIds: string[];
  shotTimings: SeedanceShotTiming[];
}

export interface SeedancePreproductionRun {
  schemaVersion: 1;
  id: string;
  createdAt: number;
  updatedAt: number;
  prompt: string;
  preferences: SeedanceStoryPreferences;
  /** Legacy project payload retained only for migration from pre-bundle runs. */
  planningSources?: SeedancePlanningSource[];
  /** Explicit project media boundary chosen before this run starts. */
  sourceMediaFileIds?: string[];
  sourceBundle?: SeedanceSourceBundleReference;
  phase: SeedancePreproductionPhase;
  error?: string;
  ideas: SeedanceStoryIdea[];
  orchestration?: SeedanceOrchestrationPublicRun;
  orchestrationCursor: number;
  orchestrationEvents: SeedanceOrchestrationEvent[];
  scenePlans: SeedanceScenePlan[];
  selectedIdeaId?: string;
  story?: SeedanceStory;
  assetPlan?: SeedanceAssetPlan;
  storyExpanded: boolean;
  sourceAssets: CommonsSourceAsset[];
  researchDiagnostics: SeedanceResearchDiagnostic[];
  masterGenerationRound: number;
  masterLooks: SeedanceMasterLook[];
  selectedMasterLookId?: string;
  keyframeBriefs: SeedanceKeyframeBrief[];
  keyframeVersions: SeedanceKeyframeVersion[];
  acceptedVersionByBriefId: Record<string, string>;
  selectedKeyframeIds: string[];
  segments: SeedanceSegmentPackage[];
}

export interface SeedancePreproductionProjectState {
  schemaVersion: 1;
  activeRunId: string | null;
  documents: SeedancePlanningDocument[];
  runs: Record<string, SeedancePreproductionRun>;
  sourceBundle?: SeedanceSourceBundleReference;
}

export interface SeedanceSourceBundleResult extends SeedanceSourceBundleReference {
  kind: 'source-bundle';
}

export interface SeedanceIdeasResult {
  schemaVersion: 1;
  kind: 'ideas';
  ideas: SeedanceStoryIdea[];
}

export interface SeedanceMasterLooksResult {
  schemaVersion: 1;
  kind: 'master-looks';
  imageProviderId: 'nano-banana-2';
  looks: Array<Omit<SeedanceMasterLook, 'status'>>;
}

export interface SeedanceKeyframesResult {
  schemaVersion: 1;
  kind: 'keyframes';
  imageProviderId: 'nano-banana-2';
  keyframes: SeedanceKeyframeBrief[];
  segments: SeedanceSegmentPackage[];
}

export type SeedanceKernelResult =
  | SeedanceSourceBundleResult
  | SeedanceIdeasResult
  | SeedanceStory
  | SeedanceAssetPlan
  | SeedanceMasterLooksResult
  | SeedanceKeyframesResult;

export function createEmptySeedancePreproductionState(): SeedancePreproductionProjectState {
  return { schemaVersion: 1, activeRunId: null, documents: [], runs: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maximum || (!allowEmpty && !value.trim())) {
    throw new Error('The kernel returned invalid Story workflow text.');
  }
  return value;
}

function boundedNumber(value: unknown, maximum: number, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error('The kernel returned an invalid Story workflow number.');
  }
  return value;
}

function boundedStringArray(value: unknown, maximum: number): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Error('The kernel returned an invalid Story workflow list.');
  }
  return value.map((item) => boundedString(item, 180));
}

function parseSavedPlanningDocument(value: unknown): SeedancePlanningDocument | null {
  if (!isRecord(value)) return null;
  const format = value.format;
  if (format !== 'markdown' && format !== 'pdf' && format !== 'text') return null;
  try {
    return {
      id: boundedString(value.id, 160),
      name: boundedString(value.name, 300),
      mimeType: boundedString(value.mimeType, 120),
      text: boundedString(value.text, 300_000),
      truncated: value.truncated === true,
      ...(value.pageCount === undefined
        ? {}
        : { pageCount: boundedNumber(value.pageCount, 20_000, 1) }),
      byteLength: boundedNumber(value.byteLength, 40 * 1024 * 1024),
      createdAt: boundedNumber(value.createdAt, Number.MAX_SAFE_INTEGER),
      format,
      lastModified: boundedNumber(value.lastModified, Number.MAX_SAFE_INTEGER),
    };
  } catch {
    return null;
  }
}

function parseSourceBundleReference(value: unknown): SeedanceSourceBundleReference | undefined {
  if (!isRecord(value)) return undefined;
  try {
    const id = boundedString(value.id, 100);
    const fingerprint = boundedString(value.fingerprint, 64);
    if (
      !/^source-bundle-[a-f0-9]{64}$/u.test(id)
      || !/^[a-f0-9]{64}$/u.test(fingerprint)
    ) return undefined;
    return {
      schemaVersion: 1,
      id,
      fingerprint,
      createdAt: boundedNumber(value.createdAt, Number.MAX_SAFE_INTEGER),
      entryCount: boundedNumber(value.entryCount, 512),
    };
  } catch {
    return undefined;
  }
}

function parseIdea(value: unknown): SeedanceStoryIdea {
  if (!isRecord(value)) throw new Error('The kernel returned an invalid story idea.');
  return {
    id: boundedString(value.id, 80),
    title: boundedString(value.title, 120),
    summary: boundedString(value.summary, 600),
    tone: boundedString(value.tone, 120),
    ...(value.targetDurationSeconds === undefined || value.targetDurationSeconds === null
      ? {}
      : { targetDurationSeconds: boundedNumber(value.targetDurationSeconds, 3_600, Number.EPSILON) }),
  };
}

function parseStory(value: Record<string, unknown>): SeedanceStory {
  if (!Array.isArray(value.scenes) || value.scenes.length < 1 || value.scenes.length > 80) {
    throw new Error('The kernel returned an invalid Story scene list.');
  }
  if (!Array.isArray(value.researchRequirements) || value.researchRequirements.length > 24) {
    throw new Error('The kernel returned invalid Story research requirements.');
  }
  const scenes = value.scenes.map((scene): SeedanceStoryScene => {
    if (!isRecord(scene)) throw new Error('The kernel returned an invalid Story scene.');
    return {
      id: boundedString(scene.id, 100),
      title: boundedString(scene.title, 160),
      summary: boundedString(scene.summary, 1_200),
      durationSeconds: boundedNumber(scene.durationSeconds, 300, Number.EPSILON),
      narration: boundedString(scene.narration, 4_000, true),
      visualIntent: boundedString(scene.visualIntent, 1_500),
    };
  });
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const researchRequirements = value.researchRequirements.map((requirement): SeedanceResearchRequirement => {
    if (!isRecord(requirement)) throw new Error('The kernel returned an invalid research requirement.');
    const sceneId = boundedString(requirement.sceneId, 100);
    if (!sceneIds.has(sceneId)) throw new Error('The kernel returned a research requirement for an unknown scene.');
    return {
      id: boundedString(requirement.id, 100),
      query: boundedString(requirement.query, 240),
      purpose: boundedString(requirement.purpose, 500),
      sceneId,
    };
  });
  return {
    schemaVersion: 1,
    kind: 'story',
    title: boundedString(value.title, 180),
    logline: boundedString(value.logline, 600),
    summary: boundedString(value.summary, 4_000),
    aspectRatio: boundedString(value.aspectRatio, 20),
    totalDurationSeconds: boundedNumber(value.totalDurationSeconds, 3_600, Number.EPSILON),
    scenes,
    researchRequirements,
  };
}

const ASSET_SOURCE_KINDS = new Set<SeedanceAssetSourceKind>([
  'commons',
  'project-source',
  'practical-footage',
  'generated-image',
  'motion-graphic',
  'reconstruction',
  'designed-visual',
]);

function parseAssetPlan(value: Record<string, unknown>): SeedanceAssetPlan {
  if (!Array.isArray(value.assetNeeds) || value.assetNeeds.length < 1 || value.assetNeeds.length > 240) {
    throw new Error('The kernel returned an invalid Story asset plan.');
  }
  const assetNeeds = value.assetNeeds.map((need): SeedanceAssetNeed => {
    if (!isRecord(need)) throw new Error('The kernel returned an invalid Story asset need.');
    const sourceKind = need.sourceKind;
    if (typeof sourceKind !== 'string' || !ASSET_SOURCE_KINDS.has(sourceKind as SeedanceAssetSourceKind)) {
      throw new Error('The kernel returned an invalid Story asset source route.');
    }
    if (need.priority !== 'required' && need.priority !== 'supporting') {
      throw new Error('The kernel returned an invalid Story asset priority.');
    }
    if (!Array.isArray(need.commonsQueries) || need.commonsQueries.length > 3) {
      throw new Error('The kernel returned invalid Commons search queries.');
    }
    const commonsQueries = need.commonsQueries.map((query) => boundedString(query, 240));
    if (sourceKind === 'commons' && commonsQueries.length === 0) {
      throw new Error('The kernel returned inconsistent Commons asset routing.');
    }
    return {
      id: boundedString(need.id, 120),
      sceneId: boundedString(need.sceneId, 100),
      description: boundedString(need.description, 800),
      cameraDirection: boundedString(need.cameraDirection, 500, true),
      sourceKind: sourceKind as SeedanceAssetSourceKind,
      priority: need.priority,
      commonsQueries,
    };
  });
  if (new Set(assetNeeds.map((need) => need.id)).size !== assetNeeds.length) {
    throw new Error('The kernel returned duplicate Story asset-need IDs.');
  }
  return { schemaVersion: 1, kind: 'asset-plan', assetNeeds };
}

function parseMasterLook(value: unknown): Omit<SeedanceMasterLook, 'status'> {
  if (!isRecord(value)) throw new Error('The kernel returned an invalid master look.');
  return {
    id: boundedString(value.id, 100),
    title: boundedString(value.title, 160),
    description: boundedString(value.description, 1_000),
    prompt: boundedString(value.prompt, 8_000),
    negativePrompt: boundedString(value.negativePrompt, 2_000, true),
  };
}

function parseKeyframe(value: unknown): SeedanceKeyframeBrief {
  if (!isRecord(value)) throw new Error('The kernel returned an invalid keyframe.');
  return {
    id: boundedString(value.id, 120),
    sceneId: boundedString(value.sceneId, 100),
    title: boundedString(value.title, 180),
    prompt: boundedString(value.prompt, 8_000),
    negativePrompt: boundedString(value.negativePrompt, 2_000, true),
    referenceAssetIds: boundedStringArray(value.referenceAssetIds, 14),
    previousKeyframeIds: boundedStringArray(value.previousKeyframeIds, 8),
  };
}

function parseSegment(value: unknown, keyframeIds: Set<string>): SeedanceSegmentPackage {
  if (!isRecord(value)) throw new Error('The kernel returned an invalid Story segment.');
  const durationSeconds = boundedNumber(value.durationSeconds, 30, Number.EPSILON);
  const segmentKeyframeIds = boundedStringArray(value.keyframeIds, 20);
  const segmentKeyframeIdSet = new Set(segmentKeyframeIds);
  if (segmentKeyframeIds.length < 1 || segmentKeyframeIds.some((id) => !keyframeIds.has(id))) {
    throw new Error('The kernel returned a Story segment with unknown keyframes.');
  }
  if (!Array.isArray(value.shotTimings) || value.shotTimings.length < 1 || value.shotTimings.length > 20) {
    throw new Error('The kernel returned invalid Story shot timings.');
  }
  const shotTimings = value.shotTimings.map((timing): SeedanceShotTiming => {
    if (!isRecord(timing)) throw new Error('The kernel returned an invalid Story shot timing.');
    const keyframeId = boundedString(timing.keyframeId, 120);
    const startSeconds = boundedNumber(timing.startSeconds, durationSeconds);
    const endSeconds = boundedNumber(timing.endSeconds, durationSeconds, Number.EPSILON);
    if (!segmentKeyframeIdSet.has(keyframeId) || endSeconds <= startSeconds) {
      throw new Error('The kernel returned an inconsistent Story shot timing.');
    }
    return { keyframeId, startSeconds, endSeconds };
  });
  return {
    id: boundedString(value.id, 100),
    title: boundedString(value.title, 180),
    durationSeconds,
    prompt: boundedString(value.prompt, 12_000),
    negativePrompt: boundedString(value.negativePrompt, 3_000, true),
    keyframeIds: segmentKeyframeIds,
    shotTimings,
  };
}

export function parseSeedanceKernelResult(value: unknown): SeedanceKernelResult {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.kind !== 'string') {
    throw new Error('The kernel returned an invalid Story workflow response.');
  }
  if (value.kind === 'source-bundle') {
    const reference = parseSourceBundleReference(value);
    if (!reference) throw new Error('The kernel returned an invalid source bundle.');
    return { ...reference, kind: 'source-bundle' };
  }
  if (value.kind === 'ideas' && Array.isArray(value.ideas) && value.ideas.length === 5) {
    const ideas = value.ideas.map(parseIdea);
    if (new Set(ideas.map((idea) => idea.id)).size !== ideas.length) {
      throw new Error('The kernel returned duplicate Story idea IDs.');
    }
    return { schemaVersion: 1, kind: 'ideas', ideas };
  }
  if (
    value.kind === 'story'
    && Array.isArray(value.scenes)
    && Array.isArray(value.researchRequirements)
  ) return parseStory(value);
  if (value.kind === 'asset-plan' && Array.isArray(value.assetNeeds)) {
    return parseAssetPlan(value);
  }
  if (value.kind === 'master-looks' && Array.isArray(value.looks) && value.looks.length === 4) {
    if (value.imageProviderId !== 'nano-banana-2') {
      throw new Error('The kernel returned an unsupported image provider.');
    }
    const looks = value.looks.map(parseMasterLook);
    if (new Set(looks.map((look) => look.id)).size !== looks.length) {
      throw new Error('The kernel returned duplicate Story master-look IDs.');
    }
    return { schemaVersion: 1, kind: 'master-looks', imageProviderId: value.imageProviderId, looks };
  }
  if (value.kind === 'keyframes' && Array.isArray(value.keyframes) && Array.isArray(value.segments)) {
    if (value.imageProviderId !== 'nano-banana-2') {
      throw new Error('The kernel returned an unsupported image provider.');
    }
    if (value.keyframes.length < 1 || value.keyframes.length > 80 || value.segments.length < 1 || value.segments.length > 120) {
      throw new Error('The kernel returned an invalid Story production package.');
    }
    const keyframes = value.keyframes.map(parseKeyframe);
    const keyframeIds = new Set(keyframes.map((keyframe) => keyframe.id));
    if (keyframeIds.size !== keyframes.length) throw new Error('The kernel returned duplicate keyframe IDs.');
    const segments = value.segments.map((segment) => parseSegment(segment, keyframeIds));
    return {
      schemaVersion: 1,
      kind: 'keyframes',
      imageProviderId: value.imageProviderId,
      keyframes,
      segments,
    };
  }
  throw new Error('The kernel returned an unsupported Story workflow response.');
}

export function parseSeedancePreproductionProjectState(
  value: unknown,
): SeedancePreproductionProjectState {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.runs)) {
    return createEmptySeedancePreproductionState();
  }
  const parsed = JSON.parse(JSON.stringify(value)) as SeedancePreproductionProjectState;
  parsed.documents = Array.isArray(parsed.documents)
    ? parsed.documents.slice(0, 100).flatMap((document) => {
        const normalized = parseSavedPlanningDocument(document);
        return normalized ? [normalized] : [];
      })
    : [];
  parsed.sourceBundle = parseSourceBundleReference(parsed.sourceBundle);
  for (const run of Object.values(parsed.runs)) {
    run.preferences = parseSeedanceStoryPreferences(run.preferences);
    if (!Number.isSafeInteger(run.orchestrationCursor) || run.orchestrationCursor < 0) {
      run.orchestrationCursor = 0;
    }
    if (run.orchestration !== undefined) {
      try {
        run.orchestration = parseSeedanceOrchestrationRun(run.orchestration);
      } catch {
        delete run.orchestration;
      }
    }
    run.orchestrationEvents = Array.isArray(run.orchestrationEvents)
      ? run.orchestrationEvents.flatMap((event) => {
          try {
            return [parseSeedanceOrchestrationEvent(event)];
          } catch {
            return [];
          }
        }).slice(-2_000)
      : [];
    run.scenePlans = Array.isArray(run.scenePlans)
      ? run.scenePlans.flatMap((plan) => {
          try {
            return [parseSeedanceScenePlan(plan)];
          } catch {
            return [];
          }
        })
      : [];
    if (!Number.isFinite(run.masterGenerationRound)) run.masterGenerationRound = 0;
    if (!Array.isArray(run.researchDiagnostics)) run.researchDiagnostics = [];
    if (!Array.isArray(run.planningSources)) delete run.planningSources;
    if (Array.isArray(run.sourceMediaFileIds)) {
      run.sourceMediaFileIds = [...new Set(run.sourceMediaFileIds.filter((id) => (
        typeof id === 'string' && id.trim().length > 0 && id.length <= 200
      )))].slice(0, 512);
    } else {
      delete run.sourceMediaFileIds;
    }
    run.sourceBundle = parseSourceBundleReference(run.sourceBundle);
    if (run.assetPlan !== undefined) {
      try {
        run.assetPlan = isRecord(run.assetPlan) ? parseAssetPlan(run.assetPlan) : undefined;
      } catch {
        delete run.assetPlan;
      }
    }
  }
  return parsed;
}
