import {
  STORYBOARD_SCHEMA_VERSION,
  type JsonValue,
  type StoryboardCandidate,
  type StoryboardCoverage,
  type StoryboardDecision,
  type StoryboardEvidenceRef,
  type StoryboardGenerationBrief,
  type StoryboardPlan,
  type StoryboardProjectState,
  type StoryboardScene,
  type StoryboardTemplate,
  type TimelineFragment,
  type TimelineVariantOption,
  type TimelineVariantSet,
} from './models';

export class StoryboardContractError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${path}: ${message}`);
    this.name = 'StoryboardContractError';
    this.path = path;
  }
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new StoryboardContractError('expected an object', path);
  return value;
}

function requireSchemaVersion(record: Record<string, unknown>, path: string): void {
  if (record.schemaVersion !== STORYBOARD_SCHEMA_VERSION) {
    throw new StoryboardContractError('unsupported or missing schemaVersion', path);
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new StoryboardContractError('expected a non-empty string', path);
  }
  return value;
}

function requireFiniteNumber(
  value: unknown,
  path: string,
  minimum = 0,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new StoryboardContractError(`expected a finite number >= ${minimum}`, path);
  }
  return value;
}

function requireInteger(value: unknown, path: string, minimum = 0): number {
  const number = requireFiniteNumber(value, path, minimum);
  if (!Number.isInteger(number)) {
    throw new StoryboardContractError('expected an integer', path);
  }
  return number;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new StoryboardContractError('expected a boolean', path);
  }
  return value;
}

function requireEnum<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new StoryboardContractError(`expected one of ${allowed.join(', ')}`, path);
  }
  return value as T[number];
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new StoryboardContractError('expected an array', path);
  return value;
}

function requireStringArray(value: unknown, path: string): string[] {
  return requireArray(value, path).map((entry, index) => (
    requireString(entry, `${path}[${index}]`)
  ));
}

function requireOptionalString(record: Record<string, unknown>, key: string, path: string): void {
  if (record[key] !== undefined) requireString(record[key], `${path}.${key}`);
}

function requireOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  path: string,
  minimum = 0,
): void {
  if (record[key] !== undefined) requireFiniteNumber(record[key], `${path}.${key}`, minimum);
}

function requireOptionalBoolean(record: Record<string, unknown>, key: string, path: string): void {
  if (record[key] !== undefined) requireBoolean(record[key], `${path}.${key}`);
}

function assertJsonSafe(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
): asserts value is JsonValue {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
  ) {
    if (typeof value === 'string' && /^data:[^,]*;base64,/i.test(value)) {
      throw new StoryboardContractError('inline binary data is not project content', path);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new StoryboardContractError('expected JSON-safe content', path);
  }
  if (ancestors.has(value)) {
    throw new StoryboardContractError('cyclic content is not supported', path);
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonSafe(entry, `${path}[${index}]`, ancestors));
  } else {
    const record = requireRecord(value, path);
    for (const [key, entry] of Object.entries(record)) {
      if (/url$/i.test(key)) {
        throw new StoryboardContractError('remote URLs are not persisted in storyboard state', `${path}.${key}`);
      }
      assertJsonSafe(entry, `${path}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

function assertFingerprint(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireEnum(record.algorithm, ['sha-256'] as const, `${path}.algorithm`);
  const fingerprint = requireString(record.value, `${path}.value`);
  if (!/^[a-f0-9]{64}$/i.test(fingerprint)) {
    throw new StoryboardContractError('expected a SHA-256 hex digest', `${path}.value`);
  }
}

export function assertStoryboardPlan(value: unknown, path = 'plan'): asserts value is StoryboardPlan {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.title, `${path}.title`);
  requireOptionalString(record, 'description', path);
  requireStringArray(record.sceneIds, `${path}.sceneIds`);
  requireOptionalString(record, 'templateId', path);
  requireOptionalNumber(record, 'targetDurationSeconds', path);
  requireOptionalString(record, 'aspectRatio', path);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
  requireFiniteNumber(record.updatedAt, `${path}.updatedAt`);
}

export function assertStoryboardScene(value: unknown, path = 'scene'): asserts value is StoryboardScene {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.planId, `${path}.planId`);
  requireString(record.title, `${path}.title`);
  if (typeof record.description !== 'string') {
    throw new StoryboardContractError('expected a string', `${path}.description`);
  }
  for (const key of [
    'intent',
    'visualDirection',
    'audioDirection',
    'transitionIntent',
    'sceneKind',
    'beatId',
    'color',
    'generationBriefId',
    'selectedCandidateId',
    'notes',
  ]) {
    requireOptionalString(record, key, path);
  }
  requireFiniteNumber(record.targetDurationSeconds, `${path}.targetDurationSeconds`);
  requireEnum(record.status, [
    'draft',
    'ready',
    'gathering',
    'generating',
    'review',
    'accepted',
    'filled',
    'blocked',
  ] as const, `${path}.status`);
  requireStringArray(record.filledClipIds, `${path}.filledClipIds`);
  requireStringArray(record.evidenceRefIds, `${path}.evidenceRefIds`);
  requireStringArray(record.variantSetIds, `${path}.variantSetIds`);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
  requireFiniteNumber(record.updatedAt, `${path}.updatedAt`);
}

function assertCapabilityPolicy(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireEnum(record.mediaType, ['image', 'video', 'audio'] as const, `${path}.mediaType`);
  requireOptionalBoolean(record, 'needsImageToVideo', path);
  requireOptionalBoolean(record, 'needsStartEndFrames', path);
  requireOptionalBoolean(record, 'needsNativeAudio', path);
  if (record.preferredQuality !== undefined) {
    requireEnum(
      record.preferredQuality,
      ['draft', 'balanced', 'final'] as const,
      `${path}.preferredQuality`,
    );
  }
}

export function assertStoryboardGenerationBrief(
  value: unknown,
  path = 'generationBrief',
): asserts value is StoryboardGenerationBrief {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.sceneId, `${path}.sceneId`);
  requireInteger(record.revision, `${path}.revision`, 1);
  requireString(record.prompt, `${path}.prompt`);
  for (const key of [
    'negativePrompt',
    'visualContinuity',
    'camera',
    'motion',
    'lighting',
    'audioIntent',
    'startFrameMediaFileId',
    'endFrameMediaFileId',
  ]) {
    requireOptionalString(record, key, path);
  }
  requireFiniteNumber(record.durationSeconds, `${path}.durationSeconds`);
  requireString(record.aspectRatio, `${path}.aspectRatio`);
  requireStringArray(record.referenceMediaFileIds, `${path}.referenceMediaFileIds`);
  assertCapabilityPolicy(record.capabilityPolicy, `${path}.capabilityPolicy`);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
}

export function assertStoryboardCandidate(
  value: unknown,
  path = 'candidate',
): asserts value is StoryboardCandidate {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.sceneId, `${path}.sceneId`);
  requireEnum(record.kind, [
    'source-cut',
    'generated-image',
    'generated-video',
    'generated-audio',
    'hybrid',
  ] as const, `${path}.kind`);
  requireEnum(record.state, [
    'proposed',
    'awaiting-approval',
    'queued',
    'processing',
    'ready',
    'rejected',
    'accepted',
    'failed',
    'canceled',
  ] as const, `${path}.state`);
  requireOptionalNumber(record, 'generationBriefRevision', path, 1);
  for (const key of [
    'generationRequestKey',
    'generationRecordId',
    'outputId',
    'mediaFileId',
    'variantSetId',
    'variantOptionId',
    'rationale',
  ]) {
    requireOptionalString(record, key, path);
  }
  requireStringArray(record.sourceMomentHandles, `${path}.sourceMomentHandles`);
  requireOptionalNumber(record, 'durationSeconds', path);
  requireOptionalNumber(record, 'estimatedCredits', path);
  requireOptionalNumber(record, 'actualCredits', path);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
}

export function assertStoryboardEvidenceRef(
  value: unknown,
  path = 'evidenceRef',
): asserts value is StoryboardEvidenceRef {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.sceneId, `${path}.sceneId`);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
  const kind = requireEnum(record.kind, [
    'transcript-moment',
    'source-range',
    'generated-candidate',
    'reference-image',
  ] as const, `${path}.kind`);
  if (kind === 'transcript-moment') {
    requireString(record.handle, `${path}.handle`);
    requireString(record.indexVersion, `${path}.indexVersion`);
  } else if (kind === 'source-range') {
    requireString(record.mediaFileId, `${path}.mediaFileId`);
    const start = requireFiniteNumber(record.start, `${path}.start`);
    const end = requireFiniteNumber(record.end, `${path}.end`);
    if (end <= start) throw new StoryboardContractError('must be after start', `${path}.end`);
  } else if (kind === 'generated-candidate') {
    requireString(record.candidateId, `${path}.candidateId`);
  } else {
    requireString(record.mediaFileId, `${path}.mediaFileId`);
  }
}

export function assertStoryboardCoverage(
  value: unknown,
  path = 'coverage',
): asserts value is StoryboardCoverage {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.sceneId, `${path}.sceneId`);
  requireEnum(record.level, ['red', 'yellow', 'green'] as const, `${path}.level`);
  const sourceScore = requireFiniteNumber(record.sourceScore, `${path}.sourceScore`);
  const generationScore = requireFiniteNumber(
    record.generationReadinessScore,
    `${path}.generationReadinessScore`,
  );
  if (sourceScore > 1 || generationScore > 1) {
    throw new StoryboardContractError('scores must be between 0 and 1', path);
  }
  requireStringArray(record.reasons, `${path}.reasons`);
  assertFingerprint(record.evaluatedAgainstFingerprint, `${path}.evaluatedAgainstFingerprint`);
  requireFiniteNumber(record.evaluatedAt, `${path}.evaluatedAt`);
}

export function assertStoryboardDecision(
  value: unknown,
  path = 'decision',
): asserts value is StoryboardDecision {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireEnum(record.kind, [
    'story',
    'evidence',
    'generation',
    'cut',
    'variant',
    'duration',
  ] as const, `${path}.kind`);
  requireString(record.question, `${path}.question`);
  requireOptionalString(record, 'explanation', path);
  requireEnum(record.state, [
    'pending',
    'resolved',
    'dismissed',
    'stale',
  ] as const, `${path}.state`);
  assertFingerprint(record.baseFingerprint, `${path}.baseFingerprint`);
  requireArray(record.options, `${path}.options`).forEach((option, index) => {
    const optionRecord = requireRecord(option, `${path}.options[${index}]`);
    requireString(optionRecord.id, `${path}.options[${index}].id`);
    requireString(optionRecord.title, `${path}.options[${index}].title`);
    requireString(optionRecord.summary, `${path}.options[${index}].summary`);
    requireOptionalString(optionRecord, 'rationale', `${path}.options[${index}]`);
    requireStringArray(optionRecord.tradeoffs, `${path}.options[${index}].tradeoffs`);
    requireOptionalNumber(optionRecord, 'estimatedCredits', `${path}.options[${index}]`);
    if (optionRecord.preview !== undefined) {
      assertJsonSafe(optionRecord.preview, `${path}.options[${index}].preview`);
    }
  });
  requireBoolean(record.allowMultiple, `${path}.allowMultiple`);
  requireBoolean(record.allowFreeform, `${path}.allowFreeform`);
  requireStringArray(record.selectedOptionIds, `${path}.selectedOptionIds`);
  for (const key of ['freeform', 'sceneId', 'variantSetId', 'parentDecisionId']) {
    requireOptionalString(record, key, path);
  }
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
  requireOptionalNumber(record, 'resolvedAt', path);
}

function assertVariantScope(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  const start = requireFiniteNumber(record.startTime, `${path}.startTime`);
  const end = requireFiniteNumber(record.endTime, `${path}.endTime`);
  if (end <= start) throw new StoryboardContractError('must be after startTime', `${path}.endTime`);
  requireStringArray(record.trackIds, `${path}.trackIds`);
  requireBoolean(record.includeLinked, `${path}.includeLinked`);
}

function assertOwnedPayload(value: unknown, path: string): void {
  const record = requireRecord(value, path);
  requireString(record.ownerClipId, `${path}.ownerClipId`);
  assertJsonSafe(record.payload, `${path}.payload`);
}

export function assertTimelineFragment(
  value: unknown,
  path = 'fragment',
): asserts value is TimelineFragment {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireFiniteNumber(record.durationSeconds, `${path}.durationSeconds`);
  requireArray(record.tracks, `${path}.tracks`).forEach((track, index) => {
    const trackRecord = requireRecord(track, `${path}.tracks[${index}]`);
    requireString(trackRecord.localTrackId, `${path}.tracks[${index}].localTrackId`);
    requireString(trackRecord.sourceTrackId, `${path}.tracks[${index}].sourceTrackId`);
    requireEnum(trackRecord.kind, ['video', 'audio'] as const, `${path}.tracks[${index}].kind`);
  });
  requireArray(record.clips, `${path}.clips`).forEach((clip, index) => {
    const clipRecord = requireRecord(clip, `${path}.clips[${index}]`);
    requireString(clipRecord.localId, `${path}.clips[${index}].localId`);
    requireOptionalString(clipRecord, 'sourceClipId', `${path}.clips[${index}]`);
    requireString(clipRecord.localTrackId, `${path}.clips[${index}].localTrackId`);
    requireFiniteNumber(clipRecord.startOffsetSeconds, `${path}.clips[${index}].startOffsetSeconds`);
    requireFiniteNumber(clipRecord.durationSeconds, `${path}.clips[${index}].durationSeconds`);
    assertJsonSafe(clipRecord.payload, `${path}.clips[${index}].payload`);
  });
  requireArray(record.links, `${path}.links`).forEach((link, index) => {
    const linkRecord = requireRecord(link, `${path}.links[${index}]`);
    requireString(linkRecord.fromClipId, `${path}.links[${index}].fromClipId`);
    requireString(linkRecord.toClipId, `${path}.links[${index}].toClipId`);
  });
  for (const key of ['keyframes', 'effects', 'masks']) {
    requireArray(record[key], `${path}.${key}`).forEach((entry, index) => (
      assertOwnedPayload(entry, `${path}.${key}[${index}]`)
    ));
  }
  requireArray(record.transitions, `${path}.transitions`).forEach((transition, index) => {
    const transitionRecord = requireRecord(transition, `${path}.transitions[${index}]`);
    requireOptionalString(transitionRecord, 'fromClipId', `${path}.transitions[${index}]`);
    requireOptionalString(transitionRecord, 'toClipId', `${path}.transitions[${index}]`);
    assertJsonSafe(transitionRecord.payload, `${path}.transitions[${index}].payload`);
  });
  for (const key of ['markers', 'annotations']) {
    requireArray(record[key], `${path}.${key}`).forEach((entry, index) => (
      assertJsonSafe(entry, `${path}.${key}[${index}]`)
    ));
  }
  requireStringArray(record.sceneIds, `${path}.sceneIds`);
  requireStringArray(record.candidateIds, `${path}.candidateIds`);
  requireStringArray(record.warnings, `${path}.warnings`);
}

export function assertTimelineVariantSet(
  value: unknown,
  path = 'variantSet',
): asserts value is TimelineVariantSet {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.title, `${path}.title`);
  requireString(record.baseCompositionId, `${path}.baseCompositionId`);
  requireStringArray(record.sceneIds, `${path}.sceneIds`);
  assertVariantScope(record.scope, `${path}.scope`);
  assertFingerprint(record.baseFingerprint, `${path}.baseFingerprint`);
  assertFingerprint(record.boundaryFingerprint, `${path}.boundaryFingerprint`);
  requireEnum(record.status, [
    'building',
    'review',
    'stale',
    'committed',
    'archived',
  ] as const, `${path}.status`);
  requireStringArray(record.optionIds, `${path}.optionIds`);
  requireOptionalString(record, 'committedOptionId', path);
  requireFiniteNumber(record.createdAt, `${path}.createdAt`);
}

export function assertTimelineVariantOption(
  value: unknown,
  path = 'variantOption',
): asserts value is TimelineVariantOption {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.variantSetId, `${path}.variantSetId`);
  requireString(record.title, `${path}.title`);
  requireString(record.rationale, `${path}.rationale`);
  requireEnum(record.state, [
    'planned',
    'building',
    'ready',
    'failed',
    'rejected',
    'accepted',
  ] as const, `${path}.state`);
  assertTimelineFragment(record.fragment, `${path}.fragment`);
  requireOptionalString(record, 'materializedCompositionId', path);
  requireStringArray(record.candidateIds, `${path}.candidateIds`);
  if (record.expectedFingerprint !== undefined) {
    assertFingerprint(record.expectedFingerprint, `${path}.expectedFingerprint`);
  }
  if (record.lineage !== undefined) {
    const lineage = requireRecord(record.lineage, `${path}.lineage`);
    requireEnum(lineage.kind, ['refinement', 'hybrid'] as const, `${path}.lineage.kind`);
    requireStringArray(lineage.parentOptionIds, `${path}.lineage.parentOptionIds`);
    requireOptionalString(lineage, 'instruction', `${path}.lineage`);
    requireArray(lineage.lockedSubranges, `${path}.lineage.lockedSubranges`)
      .forEach((range, index) => assertVariantScope({
        ...(requireRecord(range, `${path}.lineage.lockedSubranges[${index}]`)),
        trackIds: [],
        includeLinked: false,
      }, `${path}.lineage.lockedSubranges[${index}]`));
  }
}

export function assertStoryboardTemplate(
  value: unknown,
  path = 'template',
): asserts value is StoryboardTemplate {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  requireString(record.id, `${path}.id`);
  requireString(record.name, `${path}.name`);
  requireInteger(record.version, `${path}.version`, 1);
  requireString(record.description, `${path}.description`);
  requireOptionalNumber(record, 'targetDurationSeconds', path);
  requireOptionalString(record, 'aspectRatio', path);
  requireArray(record.beats, `${path}.beats`).forEach((beat, index) => {
    const beatRecord = requireRecord(beat, `${path}.beats[${index}]`);
    requireString(beatRecord.id, `${path}.beats[${index}].id`);
    requireString(beatRecord.title, `${path}.beats[${index}].title`);
    requireString(beatRecord.purpose, `${path}.beats[${index}].purpose`);
    requireOptionalNumber(beatRecord, 'targetShare', `${path}.beats[${index}]`);
    if (typeof beatRecord.targetShare === 'number' && beatRecord.targetShare > 1) {
      throw new StoryboardContractError('targetShare must be <= 1', `${path}.beats[${index}].targetShare`);
    }
    requireOptionalString(beatRecord, 'defaultSceneKind', `${path}.beats[${index}]`);
    requireStringArray(
      beatRecord.evidenceExpectations,
      `${path}.beats[${index}].evidenceExpectations`,
    );
    if (beatRecord.generationDefaults !== undefined) {
      assertJsonSafe(
        beatRecord.generationDefaults,
        `${path}.beats[${index}].generationDefaults`,
      );
    }
  });
}

function assertRecordCollection<T>(
  value: unknown,
  path: string,
  validate: (entry: unknown, entryPath: string) => asserts entry is T,
  idOf: (entry: T) => string,
): asserts value is Record<string, T> {
  const record = requireRecord(value, path);
  for (const [key, entry] of Object.entries(record)) {
    validate(entry, `${path}.${key}`);
    if (idOf(entry) !== key) {
      throw new StoryboardContractError('record key does not match entity identity', `${path}.${key}`);
    }
  }
}

export function assertStoryboardProjectState(
  value: unknown,
  path = 'storyboard',
): asserts value is StoryboardProjectState {
  const record = requireRecord(value, path);
  requireSchemaVersion(record, path);
  assertRecordCollection(record.plans, `${path}.plans`, assertStoryboardPlan, (entry) => entry.id);
  assertRecordCollection(record.scenes, `${path}.scenes`, assertStoryboardScene, (entry) => entry.id);
  assertRecordCollection(
    record.generationBriefs,
    `${path}.generationBriefs`,
    assertStoryboardGenerationBrief,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.candidates,
    `${path}.candidates`,
    assertStoryboardCandidate,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.evidenceRefs,
    `${path}.evidenceRefs`,
    assertStoryboardEvidenceRef,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.coverageBySceneId,
    `${path}.coverageBySceneId`,
    assertStoryboardCoverage,
    (entry) => entry.sceneId,
  );
  assertRecordCollection(
    record.variantSets,
    `${path}.variantSets`,
    assertTimelineVariantSet,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.variantOptions,
    `${path}.variantOptions`,
    assertTimelineVariantOption,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.decisions,
    `${path}.decisions`,
    assertStoryboardDecision,
    (entry) => entry.id,
  );
  assertRecordCollection(
    record.templates,
    `${path}.templates`,
    assertStoryboardTemplate,
    (entry) => entry.id,
  );
  assertJsonSafe(record, path);
}

export function cloneStoryboardProjectState(value: StoryboardProjectState): StoryboardProjectState {
  assertStoryboardProjectState(value);
  return JSON.parse(JSON.stringify(value)) as StoryboardProjectState;
}

export function parseStoryboardDecision(value: unknown): StoryboardDecision {
  assertStoryboardDecision(value);
  return JSON.parse(JSON.stringify(value)) as StoryboardDecision;
}

export function parseStoryboardGenerationBrief(value: unknown): StoryboardGenerationBrief {
  assertStoryboardGenerationBrief(value);
  return JSON.parse(JSON.stringify(value)) as StoryboardGenerationBrief;
}
