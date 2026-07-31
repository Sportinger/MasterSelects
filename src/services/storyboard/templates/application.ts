import {
  assertStoryboardProjectState,
  cloneStoryboardProjectState,
  type StoryboardGenerationBrief,
  type StoryboardPlan,
  type StoryboardProjectState,
  type StoryboardScene,
} from '../contracts';
import { expandStoryboardTemplateDurationShares } from './durationShares';
import { mapStoryboardScenesToTemplate } from './mapping';
import type {
  PreviewStoryboardTemplateApplicationInput,
  StoryboardExpandedTemplateBeat,
  StoryboardTemplateApplicationPreview,
  StoryboardTemplateDiffEntry,
  StoryboardTemplateSceneMapping,
} from './types';

interface StoredTemplatePreviewTarget {
  readonly state: StoryboardProjectState;
  readonly baseFingerprint: string;
  readonly diffFingerprint: string;
  readonly planId: string;
  readonly previewAuthority: string;
  readonly requiresConfirmation: boolean;
  readonly targetFingerprint: string;
  readonly confirmed: boolean;
}

const previewTargets = new WeakMap<
  StoryboardTemplateApplicationPreview,
  StoredTemplatePreviewTarget
>();

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function canonicalPreviewAuthority(
  preview: StoryboardTemplateApplicationPreview,
): string {
  return JSON.stringify(canonicalize({
    schemaVersion: preview.schemaVersion,
    mode: preview.mode,
    templateId: preview.templateId,
    templateVersion: preview.templateVersion,
    planId: preview.planId,
    baseFingerprint: preview.baseFingerprint,
    targetFingerprint: preview.targetFingerprint,
    diffFingerprint: preview.diffFingerprint,
    differences: preview.differences,
    mappings: preview.mappings,
    requiresConfirmation: preview.requiresConfirmation,
  }));
}

function assertActivePreviewAuthority(
  preview: StoryboardTemplateApplicationPreview,
  target: StoredTemplatePreviewTarget,
): void {
  if (canonicalPreviewAuthority(preview) !== target.previewAuthority) {
    throw new Error('Template preview fingerprint changed after the diff was created.');
  }
}

async function hashValue(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === 'undefined') {
    throw new Error('SHA-256 is unavailable in this runtime.');
  }
  const payload = JSON.stringify(canonicalize(value));
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

function snapshotForPlan(state: StoryboardProjectState, planId: string) {
  const plan = state.plans[planId] ?? null;
  const sceneIds = new Set(plan?.sceneIds ?? []);
  const variantSets = Object.values(state.variantSets)
    .filter(set => set.sceneIds.some(sceneId => sceneIds.has(sceneId)))
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const variantSetIds = new Set(variantSets.map(set => set.id));
  return {
    plan,
    scenes: Object.values(state.scenes)
      .filter(scene => sceneIds.has(scene.id))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    generationBriefs: Object.values(state.generationBriefs)
      .filter(brief => sceneIds.has(brief.sceneId))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    candidates: Object.values(state.candidates)
      .filter(candidate => sceneIds.has(candidate.sceneId))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    evidenceRefs: Object.values(state.evidenceRefs)
      .filter(ref => sceneIds.has(ref.sceneId))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    coverage: Object.values(state.coverageBySceneId)
      .filter(coverage => sceneIds.has(coverage.sceneId))
      .toSorted((left, right) => left.sceneId.localeCompare(right.sceneId)),
    decisions: Object.values(state.decisions)
      .filter(decision => decision.sceneId && sceneIds.has(decision.sceneId))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
    variantSets,
    variantOptions: Object.values(state.variantOptions)
      .filter(option => variantSetIds.has(option.variantSetId))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

function replaceSceneScopedRecords<T>(
  current: Record<string, T>,
  target: Readonly<Record<string, T>>,
  affectedSceneIds: ReadonlySet<string>,
  sceneIdOf: (record: T, id: string) => string | undefined,
): void {
  for (const [id, record] of Object.entries(current)) {
    const sceneId = sceneIdOf(record, id);
    if (sceneId && affectedSceneIds.has(sceneId)) delete current[id];
  }
  for (const [id, record] of Object.entries(target)) {
    const sceneId = sceneIdOf(record, id);
    if (sceneId && affectedSceneIds.has(sceneId)) {
      current[id] = structuredClone(record);
    }
  }
}

function applyPlanSlice(
  currentState: StoryboardProjectState,
  targetState: StoryboardProjectState,
  planId: string,
): StoryboardProjectState {
  const next = cloneStoryboardProjectState(currentState);
  const currentPlan = currentState.plans[planId];
  const targetPlan = targetState.plans[planId];
  const affectedSceneIds = new Set([
    ...(currentPlan?.sceneIds ?? []),
    ...(targetPlan?.sceneIds ?? []),
  ]);
  if (targetPlan) next.plans[planId] = structuredClone(targetPlan);
  else delete next.plans[planId];

  for (const sceneId of affectedSceneIds) {
    const targetScene = targetState.scenes[sceneId];
    if (targetScene) next.scenes[sceneId] = structuredClone(targetScene);
    else delete next.scenes[sceneId];
  }
  replaceSceneScopedRecords(
    next.generationBriefs,
    targetState.generationBriefs,
    affectedSceneIds,
    brief => brief.sceneId,
  );
  replaceSceneScopedRecords(
    next.candidates,
    targetState.candidates,
    affectedSceneIds,
    candidate => candidate.sceneId,
  );
  replaceSceneScopedRecords(
    next.evidenceRefs,
    targetState.evidenceRefs,
    affectedSceneIds,
    ref => ref.sceneId,
  );
  replaceSceneScopedRecords(
    next.coverageBySceneId,
    targetState.coverageBySceneId,
    affectedSceneIds,
    coverage => coverage.sceneId,
  );
  replaceSceneScopedRecords(
    next.decisions,
    targetState.decisions,
    affectedSceneIds,
    decision => decision.sceneId,
  );
  assertStoryboardProjectState(next, 'templateApplication.appliedState');
  return next;
}

function uniqueId(
  desiredId: string,
  usedIds: ReadonlySet<string>,
  entity: string,
): string {
  if (usedIds.has(desiredId)) {
    throw new Error(`${entity} id ${desiredId} already exists.`);
  }
  return desiredId;
}

function createScene(
  planId: string,
  expanded: StoryboardExpandedTemplateBeat,
  sceneId: string,
  now: number,
): StoryboardScene {
  return {
    schemaVersion: 1,
    id: sceneId,
    planId,
    title: expanded.beat.title,
    description: expanded.beat.purpose,
    intent: expanded.beat.purpose,
    ...(expanded.beat.defaultSceneKind
      ? { sceneKind: expanded.beat.defaultSceneKind }
      : {}),
    beatId: expanded.beat.id,
    targetDurationSeconds: expanded.targetDurationSeconds,
    status: 'draft',
    filledClipIds: [],
    evidenceRefIds: [],
    variantSetIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createBrief(
  expanded: StoryboardExpandedTemplateBeat,
  scene: StoryboardScene,
  briefId: string,
  aspectRatio: string | undefined,
  now: number,
): StoryboardGenerationBrief | undefined {
  const defaults = expanded.beat.generationDefaults;
  if (!defaults?.prompt || !defaults.capabilityPolicy || !(defaults.aspectRatio || aspectRatio)) {
    return undefined;
  }
  return {
    ...structuredClone(defaults),
    schemaVersion: 1,
    id: briefId,
    sceneId: scene.id,
    revision: 1,
    prompt: defaults.prompt,
    durationSeconds: defaults.durationSeconds ?? expanded.targetDurationSeconds,
    aspectRatio: defaults.aspectRatio || aspectRatio!,
    referenceMediaFileIds: [...(defaults.referenceMediaFileIds ?? [])],
    capabilityPolicy: { ...defaults.capabilityPolicy },
    createdAt: now,
  };
}

function updateMappedScene(
  scene: StoryboardScene,
  expanded: StoryboardExpandedTemplateBeat,
  mode: PreviewStoryboardTemplateApplicationInput['mode'],
  now: number,
): StoryboardScene {
  const next = mode === 'restructure'
    ? {
        ...scene,
        title: expanded.beat.title,
        description: expanded.beat.purpose,
        intent: expanded.beat.purpose,
        beatId: expanded.beat.id,
        targetDurationSeconds: expanded.targetDurationSeconds,
        ...(expanded.beat.defaultSceneKind
          ? { sceneKind: expanded.beat.defaultSceneKind }
          : {}),
        updatedAt: now,
      }
    : {
        ...scene,
        beatId: expanded.beat.id,
        ...(scene.sceneKind || !expanded.beat.defaultSceneKind
          ? {}
          : { sceneKind: expanded.beat.defaultSceneKind }),
        updatedAt: now,
      };
  const { updatedAt: _oldUpdatedAt, ...oldComparable } = scene;
  const { updatedAt: _newUpdatedAt, ...newComparable } = next;
  return JSON.stringify(oldComparable) === JSON.stringify(newComparable)
    ? scene
    : next;
}

function removeSceneAndDependents(
  state: StoryboardProjectState,
  sceneId: string,
): void {
  const blockingVariant = Object.values(state.variantSets)
    .find(set => set.sceneIds.includes(sceneId));
  if (blockingVariant) {
    throw new Error(
      `Scene ${sceneId} is referenced by variant set ${blockingVariant.id}; archive or resolve it before restructuring.`,
    );
  }
  const sceneCandidateIds = Object.values(state.candidates)
    .filter(candidate => candidate.sceneId === sceneId)
    .map(candidate => candidate.id);
  const blockingOption = Object.values(state.variantOptions)
    .find(option => option.candidateIds.some(id => sceneCandidateIds.includes(id)));
  if (blockingOption) {
    throw new Error(
      `Scene ${sceneId} has a candidate referenced by variant option ${blockingOption.id}; archive or resolve it before restructuring.`,
    );
  }
  delete state.scenes[sceneId];
  delete state.coverageBySceneId[sceneId];
  for (const [id, brief] of Object.entries(state.generationBriefs)) {
    if (brief.sceneId === sceneId) delete state.generationBriefs[id];
  }
  for (const [id, candidate] of Object.entries(state.candidates)) {
    if (candidate.sceneId === sceneId) delete state.candidates[id];
  }
  for (const [id, ref] of Object.entries(state.evidenceRefs)) {
    if (ref.sceneId === sceneId) delete state.evidenceRefs[id];
  }
  for (const [id, decision] of Object.entries(state.decisions)) {
    if (decision.sceneId === sceneId) delete state.decisions[id];
  }
}

function addCreatedBeat(
  input: PreviewStoryboardTemplateApplicationInput,
  state: StoryboardProjectState,
  expanded: StoryboardExpandedTemplateBeat,
  index: number,
  now: number,
  usedSceneIds: Set<string>,
  usedBriefIds: Set<string>,
): StoryboardScene {
  const sceneId = uniqueId(
    input.createSceneId?.(expanded.beat, index) ??
      `${input.planId}:scene:${expanded.beat.id}`,
    usedSceneIds,
    'Storyboard scene',
  );
  usedSceneIds.add(sceneId);
  const scene = createScene(input.planId, expanded, sceneId, now);
  const desiredBriefId = input.createGenerationBriefId?.(expanded.beat, scene, index) ??
    `${sceneId}:brief:1`;
  const brief = createBrief(
    expanded,
    scene,
    desiredBriefId,
    input.template.aspectRatio,
    now,
  );
  if (brief) {
    uniqueId(brief.id, usedBriefIds, 'Generation brief');
    usedBriefIds.add(brief.id);
    state.generationBriefs[brief.id] = brief;
    scene.generationBriefId = brief.id;
  }
  state.scenes[scene.id] = scene;
  return scene;
}

function updatePlan(
  input: PreviewStoryboardTemplateApplicationInput,
  current: StoryboardPlan | undefined,
  sceneIds: string[],
  now: number,
  targetDurationSeconds: number,
): StoryboardPlan {
  const inheritOnly = input.mode === 'merge' || input.mode === 'map';
  const next: StoryboardPlan = {
    schemaVersion: 1,
    id: input.planId,
    title: current?.title || input.planTitle || input.template.name,
    ...(current?.description || input.template.description
      ? { description: current?.description || input.template.description }
      : {}),
    sceneIds,
    templateId: input.template.id,
    targetDurationSeconds: inheritOnly
      ? current?.targetDurationSeconds ?? targetDurationSeconds
      : targetDurationSeconds,
    ...(inheritOnly
      ? current?.aspectRatio || input.template.aspectRatio
        ? { aspectRatio: current?.aspectRatio || input.template.aspectRatio }
        : {}
      : input.template.aspectRatio
        ? { aspectRatio: input.template.aspectRatio }
        : {}),
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
  };
  if (current) {
    const { updatedAt: _currentUpdatedAt, ...currentComparable } = current;
    const { updatedAt: _nextUpdatedAt, ...nextComparable } = next;
    if (comparable(currentComparable) === comparable(nextComparable)) return current;
  }
  return next;
}

function comparable(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function diffStates(
  before: StoryboardProjectState,
  after: StoryboardProjectState,
  planId: string,
  mode: PreviewStoryboardTemplateApplicationInput['mode'],
): StoryboardTemplateDiffEntry[] {
  const differences: StoryboardTemplateDiffEntry[] = [];
  const beforePlan = before.plans[planId];
  const afterPlan = after.plans[planId];
  if (!beforePlan && afterPlan) {
    differences.push({
      id: `plan:add:${planId}`,
      entity: 'plan',
      entityId: planId,
      operation: 'add',
      destructive: false,
      summary: `Create plan “${afterPlan.title}”.`,
      after: afterPlan,
    });
  } else if (beforePlan && afterPlan) {
    const beforeWithoutOrder = { ...beforePlan, sceneIds: [] };
    const afterWithoutOrder = { ...afterPlan, sceneIds: [] };
    if (comparable(beforeWithoutOrder) !== comparable(afterWithoutOrder)) {
      differences.push({
        id: `plan:update:${planId}`,
        entity: 'plan',
        entityId: planId,
        operation: 'update',
        destructive: false,
        summary: `Apply template identity and format constraints to plan “${afterPlan.title}”.`,
        before: beforeWithoutOrder,
        after: afterWithoutOrder,
      });
    }
    if (comparable(beforePlan.sceneIds) !== comparable(afterPlan.sceneIds)) {
      const removed = beforePlan.sceneIds.filter(id => !afterPlan.sceneIds.includes(id));
      differences.push({
        id: `plan:reorder:${planId}`,
        entity: 'plan',
        entityId: planId,
        operation: 'reorder',
        destructive: removed.length > 0 || mode === 'restructure',
        summary: removed.length > 0
          ? `Reorder template beats and remove ${removed.length} scene ${removed.length === 1 ? 'slot' : 'slots'} from the plan.`
          : 'Update scene order to include the template beats.',
        before: beforePlan.sceneIds,
        after: afterPlan.sceneIds,
      });
    }
  }

  const sceneIds = new Set([
    ...Object.keys(before.scenes),
    ...Object.keys(after.scenes),
  ]);
  for (const sceneId of [...sceneIds].sort()) {
    const previous = before.scenes[sceneId];
    const next = after.scenes[sceneId];
    if (!previous && next) {
      differences.push({
        id: `scene:add:${sceneId}`,
        entity: 'scene',
        entityId: sceneId,
        operation: 'add',
        destructive: false,
        summary: `Add beat “${next.title}” (${next.targetDurationSeconds.toFixed(1)}s).`,
        after: next,
      });
    } else if (previous && !next) {
      differences.push({
        id: `scene:remove:${sceneId}`,
        entity: 'scene',
        entityId: sceneId,
        operation: 'remove',
        destructive: true,
        summary: `Remove existing scene “${previous.title}” and its storyboard records.`,
        before: previous,
      });
    } else if (previous && next && comparable(previous) !== comparable(next)) {
      const authoredFieldsChanged = (
        previous.title !== next.title ||
        previous.description !== next.description ||
        previous.intent !== next.intent
      );
      differences.push({
        id: `scene:update:${sceneId}`,
        entity: 'scene',
        entityId: sceneId,
        operation: 'update',
        destructive: authoredFieldsChanged,
        summary: authoredFieldsChanged
          ? `Restructure existing scene “${previous.title}” as beat “${next.title}”.`
          : `Map scene “${previous.title}” to template beat ${next.beatId}.`,
        before: previous,
        after: next,
      });
    }
  }

  const briefIds = new Set([
    ...Object.keys(before.generationBriefs),
    ...Object.keys(after.generationBriefs),
  ]);
  for (const briefId of [...briefIds].sort()) {
    const previous = before.generationBriefs[briefId];
    const next = after.generationBriefs[briefId];
    if (!previous && next) {
      differences.push({
        id: `generation-brief:add:${briefId}`,
        entity: 'generation-brief',
        entityId: briefId,
        operation: 'add',
        destructive: false,
        summary: `Add provider-neutral generation defaults for scene ${next.sceneId}.`,
        after: next,
      });
    } else if (previous && !next) {
      differences.push({
        id: `generation-brief:remove:${briefId}`,
        entity: 'generation-brief',
        entityId: briefId,
        operation: 'remove',
        destructive: true,
        summary: `Remove generation brief ${briefId} with its restructured scene.`,
        before: previous,
      });
    }
  }
  const candidateIds = new Set([
    ...Object.keys(before.candidates),
    ...Object.keys(after.candidates),
  ]);
  for (const candidateId of [...candidateIds].sort()) {
    const previous = before.candidates[candidateId];
    const next = after.candidates[candidateId];
    if (previous && !next) {
      differences.push({
        id: `candidate:remove:${candidateId}`,
        entity: 'candidate',
        entityId: candidateId,
        operation: 'remove',
        destructive: true,
        summary: `Remove candidate ${candidateId} with its restructured scene.`,
        before: previous,
      });
    }
  }
  const evidenceIds = new Set([
    ...Object.keys(before.evidenceRefs),
    ...Object.keys(after.evidenceRefs),
  ]);
  for (const evidenceId of [...evidenceIds].sort()) {
    const previous = before.evidenceRefs[evidenceId];
    const next = after.evidenceRefs[evidenceId];
    if (previous && !next) {
      differences.push({
        id: `evidence:remove:${evidenceId}`,
        entity: 'evidence',
        entityId: evidenceId,
        operation: 'remove',
        destructive: true,
        summary: `Remove evidence reference ${evidenceId} with its restructured scene.`,
        before: previous,
      });
    }
  }
  const coverageSceneIds = new Set([
    ...Object.keys(before.coverageBySceneId),
    ...Object.keys(after.coverageBySceneId),
  ]);
  for (const sceneId of [...coverageSceneIds].sort()) {
    const previous = before.coverageBySceneId[sceneId];
    const next = after.coverageBySceneId[sceneId];
    if (previous && !next) {
      differences.push({
        id: `coverage:remove:${sceneId}`,
        entity: 'coverage',
        entityId: sceneId,
        operation: 'remove',
        destructive: true,
        summary: `Remove the derived coverage snapshot for scene ${sceneId}.`,
        before: previous,
      });
    }
  }
  const decisionIds = new Set([
    ...Object.keys(before.decisions),
    ...Object.keys(after.decisions),
  ]);
  for (const decisionId of [...decisionIds].sort()) {
    const previous = before.decisions[decisionId];
    const next = after.decisions[decisionId];
    if (previous && !next) {
      differences.push({
        id: `decision:remove:${decisionId}`,
        entity: 'decision',
        entityId: decisionId,
        operation: 'remove',
        destructive: true,
        summary: `Remove decision ${decisionId} with its restructured scene.`,
        before: previous,
      });
    }
  }
  return differences.toSorted((left, right) => left.id.localeCompare(right.id));
}

export async function previewStoryboardTemplateApplication(
  input: PreviewStoryboardTemplateApplicationInput,
): Promise<StoryboardTemplateApplicationPreview> {
  const now = input.now ?? Date.now();
  const existingPlan = input.state.plans[input.planId];
  if (input.mode === 'instantiate' && existingPlan?.sceneIds.length) {
    throw new Error('Instantiate requires a new or empty plan; use merge or restructure instead.');
  }
  if (input.mode !== 'instantiate' && !existingPlan) {
    throw new Error(`Template mode ${input.mode} requires an existing plan.`);
  }
  const targetDurationSeconds = input.targetDurationSeconds ??
    input.template.targetDurationSeconds ??
    existingPlan?.targetDurationSeconds;
  const expanded = expandStoryboardTemplateDurationShares(
    input.template,
    targetDurationSeconds,
  );
  const expandedByBeat = new Map(expanded.map(item => [item.beat.id, item]));
  const before = cloneStoryboardProjectState(input.state);
  const next = cloneStoryboardProjectState(input.state);
  const existingScenes = (existingPlan?.sceneIds ?? [])
    .map(sceneId => next.scenes[sceneId])
    .filter(scene => scene !== undefined);
  const mappingResult = input.mode === 'instantiate'
    ? { mappings: [], unmappedSceneIds: [], unmappedBeatIds: expanded.map(item => item.beat.id) }
    : mapStoryboardScenesToTemplate({
        scenes: existingScenes,
        template: input.template,
        explicitMappings: input.explicitMappings,
      });
  const mappings: StoryboardTemplateSceneMapping[] = [...mappingResult.mappings];
  const usedSceneIds = new Set(Object.keys(next.scenes));
  const usedBriefIds = new Set(Object.keys(next.generationBriefs));

  for (const item of mappings) {
    const scene = next.scenes[item.sceneId];
    const beat = expandedByBeat.get(item.beatId);
    if (scene && beat) {
      next.scenes[scene.id] = updateMappedScene(scene, beat, input.mode, now);
    }
  }

  const shouldAddMissing = input.mode === 'instantiate' ||
    input.mode === 'merge' ||
    input.mode === 'restructure';
  const createdByBeat = new Map<string, StoryboardScene>();
  if (shouldAddMissing) {
    for (const beatId of mappingResult.unmappedBeatIds) {
      const item = expandedByBeat.get(beatId)!;
      const index = input.template.beats.findIndex(beat => beat.id === beatId);
      const scene = addCreatedBeat(
        input,
        next,
        item,
        index,
        now,
        usedSceneIds,
        usedBriefIds,
      );
      createdByBeat.set(beatId, scene);
    }
  }

  if (input.mode === 'restructure') {
    for (const sceneId of mappingResult.unmappedSceneIds) {
      removeSceneAndDependents(next, sceneId);
    }
  }

  const mappedSceneByBeat = new Map(mappings.map(item => [item.beatId, item.sceneId]));
  const templateOrderedSceneIds = input.template.beats.flatMap(beat => {
    const sceneId = mappedSceneByBeat.get(beat.id) ?? createdByBeat.get(beat.id)?.id;
    return sceneId ? [sceneId] : [];
  });
  const sceneIds = input.mode === 'merge'
    ? [
        ...(existingPlan?.sceneIds ?? []),
        ...templateOrderedSceneIds.filter(id => !(existingPlan?.sceneIds ?? []).includes(id)),
      ]
    : input.mode === 'map'
      ? [...(existingPlan?.sceneIds ?? [])]
      : templateOrderedSceneIds;
  next.plans[input.planId] = updatePlan(
    input,
    existingPlan,
    sceneIds,
    now,
    targetDurationSeconds!,
  );
  assertStoryboardProjectState(next, 'templateApplication.nextState');

  const differences = diffStates(before, next, input.planId, input.mode);
  const baseFingerprint = await hashValue(snapshotForPlan(before, input.planId));
  const targetFingerprint = await hashValue(snapshotForPlan(next, input.planId));
  const diffFingerprint = await hashValue({
    mode: input.mode,
    templateId: input.template.id,
    templateVersion: input.template.version,
    planId: input.planId,
    baseFingerprint,
    targetFingerprint,
    differences,
  });
  const requiresConfirmation = differences.some(entry => entry.destructive);
  const preview: StoryboardTemplateApplicationPreview = {
    schemaVersion: 1,
    mode: input.mode,
    templateId: input.template.id,
    templateVersion: input.template.version,
    planId: input.planId,
    baseFingerprint,
    targetFingerprint,
    diffFingerprint,
    differences,
    mappings,
    requiresConfirmation,
  };
  previewTargets.set(preview, {
    state: next,
    baseFingerprint,
    diffFingerprint,
    planId: input.planId,
    previewAuthority: canonicalPreviewAuthority(preview),
    requiresConfirmation,
    targetFingerprint,
    confirmed: false,
  });
  return preview;
}

export function confirmStoryboardTemplatePreview(
  preview: StoryboardTemplateApplicationPreview,
): StoryboardTemplateApplicationPreview {
  const target = previewTargets.get(preview);
  if (!target) {
    throw new Error('Template preview is not an active diff-first application preview.');
  }
  assertActivePreviewAuthority(preview, target);
  const confirmed: StoryboardTemplateApplicationPreview = {
    ...structuredClone(preview),
    confirmedDiffFingerprint: target.diffFingerprint,
  };
  previewTargets.set(confirmed, {
    ...target,
    confirmed: true,
  });
  return confirmed;
}

export async function applyStoryboardTemplatePreview(
  currentState: StoryboardProjectState,
  preview: StoryboardTemplateApplicationPreview,
): Promise<StoryboardProjectState> {
  const target = previewTargets.get(preview);
  if (!target) {
    throw new Error('Template preview is not an active diff-first application preview.');
  }
  assertActivePreviewAuthority(preview, target);
  const currentFingerprint = await hashValue(
    snapshotForPlan(currentState, target.planId),
  );
  if (currentFingerprint !== target.baseFingerprint) {
    throw new Error('Storyboard plan changed after the template diff was created; preview it again.');
  }
  if (target.requiresConfirmation && !target.confirmed) {
    throw new Error('Destructive template restructuring requires confirmation of the displayed diff.');
  }
  const targetFingerprint = await hashValue(
    snapshotForPlan(target.state, target.planId),
  );
  if (targetFingerprint !== target.targetFingerprint) {
    throw new Error('Template preview target changed after the diff was created.');
  }
  return applyPlanSlice(currentState, target.state, target.planId);
}
