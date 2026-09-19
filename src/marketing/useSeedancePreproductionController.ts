import { useCallback, useEffect, useMemo, useRef } from 'react';

import {
  searchCommonsForRequirement,
} from '../services/seedancePreproduction/commonsClient';
import {
  type SeedanceAssetPlan,
  type CommonsSourceAsset,
  type SeedanceKeyframeBrief,
  type SeedanceKeyframeVersion,
  type SeedanceMasterLook,
  type SeedancePreproductionPhase,
  type SeedancePreproductionRun,
  type SeedanceSourceBundleReference,
  type SeedanceStory,
  type SeedanceStoryIdea,
} from '../services/seedancePreproduction/contracts';
import {
  researchRequirementsForRun,
  researchRequirementsFromAssetPlan,
} from '../services/seedancePreproduction/assetPlan';
import { runSeedanceKernelStage } from '../services/seedancePreproduction/kernelClient';
import {
  cancelSeedanceOrchestration,
  followSeedanceOrchestration,
  followSeedanceSceneOrchestration,
  readSeedanceOrchestrationEvents,
  resumeSeedanceOrchestration,
  selectSeedanceOrchestrationConcept,
  startSeedanceOrchestration,
} from '../services/seedancePreproduction/orchestrationClient';
import {
  reduceSeedanceOrchestrationEvent,
  DEFAULT_SEEDANCE_STORY_PREFERENCES,
  parseSeedanceStoryPreferences,
  type FinalVisualStoryConcept,
  type SeedanceOrchestrationEvent,
  type SeedanceOrchestrationPhase,
  type SeedanceOrchestrationPublicRun,
  type SeedanceScenePlan,
  type SeedanceStoryPreferences,
} from '../services/seedancePreproduction/orchestrationContracts';
import { generateSeedanceImage } from '../services/seedancePreproduction/imageGeneration';
import {
  importSeedanceGenerationAssets,
  selectSeedanceGenerationAssets,
} from '../services/seedancePreproduction/referenceSelection';
import { createSeedanceSourceBundleSnapshot } from '../services/seedancePreproduction/sourceBundle';
import { ensureSeedanceSourceTranscripts } from '../services/seedancePreproduction/sourceTranscriptPreflight';
import { ensureSeedanceSourceVisualFrames } from '../services/seedancePreproduction/sourceVisualFramePreflight';
import {
  readSeedanceMediaStore,
  readSeedancePreproductionStore,
} from '../services/seedancePreproduction/storeRuntime';
import { useSeedancePreproductionStore } from '../stores/seedancePreproductionStore';

const COMMONS_RESEARCH_BATCH_SIZE = 4;

function activeRun(): SeedancePreproductionRun | undefined {
  const state = readSeedancePreproductionStore();
  return state.activeRunId ? state.runs[state.activeRunId] : undefined;
}

export type SeedancePreproductionStartOutcome = 'completed' | 'failed' | 'stopped';

export interface SeedanceDirectEditRequest {
  idempotencyKey: string;
  prompt: string;
  runId: string;
  sourceFileIds: string[];
}

export interface SeedancePreproductionControllerOptions {
  enabled?: boolean;
  executeDirectEdit(request: SeedanceDirectEditRequest): Promise<void>;
  stopDirectEdit?(): boolean | void;
}

async function ensureSourceBundle(
  sourceMediaFileIds?: readonly string[],
  signal?: AbortSignal,
): Promise<SeedanceSourceBundleReference> {
  signal?.throwIfAborted();
  const selectedIds = sourceMediaFileIds === undefined ? null : new Set(sourceMediaFileIds);
  const selectedMediaFiles = () => readSeedanceMediaStore().files.filter((file) => (
    selectedIds === null || selectedIds.has(file.id)
  ));
  if (selectedIds && selectedMediaFiles().length !== selectedIds.size) {
    throw new Error('One or more selected Story source files are unavailable.');
  }
  await ensureSeedanceSourceTranscripts(signal, undefined, selectedIds ?? undefined);
  signal?.throwIfAborted();
  const mediaFiles = selectedMediaFiles();
  if (selectedIds && mediaFiles.length !== selectedIds.size) {
    throw new Error('One or more selected Story source files became unavailable.');
  }
  const state = readSeedancePreproductionStore();
  const snapshot = await createSeedanceSourceBundleSnapshot({
    documents: selectedIds === null ? state.documents : [],
    mediaFiles,
  });
  signal?.throwIfAborted();
  if (state.sourceBundle?.fingerprint === snapshot.fingerprint) {
    await ensureSeedanceSourceVisualFrames(state.sourceBundle, signal);
    return state.sourceBundle;
  }
  const result = await runSeedanceKernelStage({
    operation: 'ingest-sources',
    input: snapshot,
  }, signal);
  if (result.kind !== 'source-bundle') {
    throw new Error('The kernel returned the wrong source-ingestion result.');
  }
  const reference: SeedanceSourceBundleReference = {
    schemaVersion: 1,
    id: result.id,
    fingerprint: result.fingerprint,
    createdAt: result.createdAt,
    entryCount: result.entryCount,
  };
  readSeedancePreproductionStore().setSourceBundle(reference);
  await ensureSeedanceSourceVisualFrames(reference, signal);
  return reference;
}

async function sourceBundleForRun(
  run: SeedancePreproductionRun,
  signal?: AbortSignal,
): Promise<SeedanceSourceBundleReference> {
  if (run.sourceBundle) return run.sourceBundle;
  const sourceBundle = await ensureSourceBundle(run.sourceMediaFileIds, signal);
  patchRun(run.id, { sourceBundle });
  return sourceBundle;
}

function createRun(
  prompt: string,
  sourceMediaFileIds?: readonly string[],
  preferences: SeedanceStoryPreferences = DEFAULT_SEEDANCE_STORY_PREFERENCES,
): SeedancePreproductionRun {
  const now = Date.now();
  return {
    schemaVersion: 1,
    id: `seedance-preproduction-${now.toString(36)}-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    prompt,
    preferences: parseSeedanceStoryPreferences(preferences),
    ...(sourceMediaFileIds === undefined
      ? {}
      : { sourceMediaFileIds: [...sourceMediaFileIds] }),
    phase: 'generating-ideas',
    ideas: [],
    orchestrationCursor: 0,
    orchestrationEvents: [],
    scenePlans: [],
    storyExpanded: false,
    sourceAssets: [],
    researchDiagnostics: [],
    masterGenerationRound: 0,
    masterLooks: [],
    keyframeBriefs: [],
    keyframeVersions: [],
    acceptedVersionByBriefId: {},
    selectedKeyframeIds: [],
    segments: [],
  };
}

function patchRun(runId: string, patch: Partial<SeedancePreproductionRun>): void {
  readSeedancePreproductionStore().patchRun(runId, patch);
}

function ideaFromFinalConcept(concept: FinalVisualStoryConcept): SeedanceStoryIdea {
  return {
    id: concept.id,
    title: concept.title,
    summary: concept.visualSummary?.join(' ') ?? concept.visualCohesion,
    tone: concept.visualCohesion,
    targetDurationSeconds: concept.targetDurationSeconds,
  };
}

function localPhaseForOrchestration(
  orchestration: SeedanceOrchestrationPublicRun,
  current: SeedancePreproductionPhase,
): SeedancePreproductionPhase {
  if (orchestration.phase === 'awaiting-selection') return 'choosing-idea';
  if (orchestration.phase === 'writing-story') return 'writing-story';
  if (
    orchestration.phase === 'planning-scenes'
    || orchestration.phase === 'reviewing-media'
    || orchestration.phase === 'completed'
  ) {
    return ['researching', 'reviewing-media', 'implementing-edit', 'edit-ready',
      'generating-masters', 'choosing-master', 'generating-keyframes',
      'reviewing-keyframes', 'ready'].includes(current)
      ? current
      : 'planning-assets';
  }
  if (orchestration.phase === 'failed' || orchestration.phase === 'cancelled') return 'failed';
  return current === 'choosing-idea' ? current : 'generating-ideas';
}

function patchOrchestrationSnapshot(
  runId: string,
  orchestration: SeedanceOrchestrationPublicRun,
): void {
  const current = readSeedancePreproductionStore().runs[runId];
  if (!current) return;
  patchRun(runId, {
    orchestration,
    ideas: orchestration.finalConcepts.map(ideaFromFinalConcept),
    ...(orchestration.story === undefined ? {} : { story: orchestration.story }),
    ...(orchestration.error === undefined ? {} : { error: orchestration.error }),
    phase: localPhaseForOrchestration(orchestration, current.phase),
  });
}

function patchOrchestrationEvents(
  runId: string,
  events: SeedanceOrchestrationEvent[],
  cursor: number,
): void {
  const current = readSeedancePreproductionStore().runs[runId];
  if (!current?.orchestration) return;
  const knownIds = new Set(current.orchestrationEvents.map((event) => event.eventId));
  const fresh = events.filter((event) => !knownIds.has(event.eventId));
  if (fresh.length === 0 && cursor <= current.orchestrationCursor) return;
  const reducedOrchestration = fresh.reduce(reduceSeedanceOrchestrationEvent, current.orchestration);
  const scenePlans = fresh.reduce<SeedanceScenePlan[]>((plans, event) => (
    event.kind !== 'scene.plan'
      ? plans
      : [...plans.filter((plan) => plan.sceneId !== event.payload.sceneId), event.payload]
  ), current.scenePlans);
  const orchestration = { ...reducedOrchestration, scenePlanCount: scenePlans.length };
  patchRun(runId, {
    orchestration,
    orchestrationCursor: Math.max(current.orchestrationCursor, cursor),
    orchestrationEvents: [...current.orchestrationEvents, ...fresh]
      .toSorted((left, right) => left.sequence - right.sequence)
      .slice(-2_000),
    scenePlans,
    ideas: orchestration.finalConcepts.map(ideaFromFinalConcept),
    ...(orchestration.story === undefined ? {} : { story: orchestration.story }),
    ...(orchestration.error === undefined ? {} : { error: orchestration.error }),
    phase: localPhaseForOrchestration(orchestration, current.phase),
  });
}

async function followRunUntil(
  runId: string,
  stopPhases: ReadonlySet<SeedanceOrchestrationPhase>,
  signal: AbortSignal,
): Promise<SeedanceOrchestrationPublicRun> {
  const current = readSeedancePreproductionStore().runs[runId];
  if (!current?.orchestration) throw new Error('The Story workflow snapshot is unavailable.');
  return followSeedanceOrchestration({
    runId,
    afterSequence: current.orchestrationCursor,
    stopPhases,
    signal,
    onEvents: (events, cursor) => patchOrchestrationEvents(runId, events, cursor),
    onSnapshot: (snapshot) => patchOrchestrationSnapshot(runId, snapshot),
  });
}

function assetPlanFromScenePlans(plans: readonly SeedanceScenePlan[]): SeedanceAssetPlan {
  return {
    schemaVersion: 1,
    kind: 'asset-plan',
    assetNeeds: plans.map((plan, index) => ({
      id: `scene-plan-${String(index + 1).padStart(3, '0')}`,
      sceneId: plan.sceneId,
      description: `${plan.visualProposal}\n${plan.sourcePlan}`.slice(0, 800),
      cameraDirection: plan.cameraDirection.slice(0, 500),
      sourceKind: plan.sourceRoute,
      priority: 'required',
      commonsQueries: plan.commonsQueries,
    })),
  };
}

function needsSourceReview(
  orchestration: SeedanceOrchestrationPublicRun,
  plans: readonly SeedanceScenePlan[],
): boolean {
  if (orchestration.treatment?.sourceReview !== undefined) {
    return orchestration.treatment.sourceReview.required;
  }
  return orchestration.treatment?.visualWorlds.some((world) => world.requiresNewReferences) === true
    || plans.some((plan) => plan.sourceRoute === 'commons' || plan.commonsQueries.length > 0);
}

async function loadAllScenePlans(
  runId: string,
  story: SeedanceStory,
  signal: AbortSignal,
): Promise<SeedanceScenePlan[]> {
  await Promise.all(story.scenes.map(async (scene) => {
    const batch = await readSeedanceOrchestrationEvents({
      runId,
      sceneId: scene.id,
      afterSequence: 0,
      signal,
    });
    patchOrchestrationEvents(runId, batch.events, batch.nextSequence);
  }));
  const plans = readSeedancePreproductionStore().runs[runId]?.scenePlans ?? [];
  if (story.scenes.some((scene) => !plans.some((plan) => plan.sceneId === scene.id))) {
    throw new Error('The kernel did not publish a complete scene plan.');
  }
  return plans;
}

async function finishSelectedOrchestration(
  runId: string,
  orchestration: SeedanceOrchestrationPublicRun,
  signal: AbortSignal,
  executeDirectEdit: SeedancePreproductionControllerOptions['executeDirectEdit'],
): Promise<void> {
  if (!orchestration.story) throw new Error('The selected orchestration has no story.');
  const plans = await loadAllScenePlans(runId, orchestration.story, signal);
  const assetPlan = assetPlanFromScenePlans(plans);
  if (
    orchestration.treatment?.aiGeneration?.required === false
    && !needsSourceReview(orchestration, plans)
  ) {
    const current = readSeedancePreproductionStore().runs[runId];
    if (!current) throw new Error('The selected Story run is unavailable.');
    patchRun(runId, {
      assetPlan,
      error: undefined,
      phase: 'implementing-edit',
      story: orchestration.story,
    });
    signal.throwIfAborted();
    await executeDirectEdit({
      idempotencyKey: `seedance-direct-edit:${runId}`,
      prompt: current.prompt,
      runId,
      sourceFileIds: [...(current.sourceMediaFileIds ?? [])],
    });
    signal.throwIfAborted();
    patchRun(runId, { phase: 'edit-ready' });
    return;
  }
  if (!needsSourceReview(orchestration, plans)) {
    patchRun(runId, { assetPlan, story: orchestration.story });
    await generateMasterLooksForRun(runId, signal);
    return;
  }
  patchRun(runId, { assetPlan, story: orchestration.story, phase: 'researching' });
  await researchStorySources(runId, researchRequirementsFromAssetPlan(assetPlan), signal);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Story workflow step failed.';
}

function mergeCommonsAssets(groups: CommonsSourceAsset[][]): CommonsSourceAsset[] {
  const byPage = new Map<number, CommonsSourceAsset>();
  for (const asset of groups.flat()) {
    const existing = byPage.get(asset.pageId);
    if (!existing) {
      byPage.set(asset.pageId, asset);
      continue;
    }
    byPage.set(asset.pageId, {
      ...existing,
      sceneIds: [...new Set([...existing.sceneIds, ...asset.sceneIds])],
    });
  }
  return [...byPage.values()];
}

async function researchStorySources(
  runId: string,
  requirements: SeedanceStory['researchRequirements'],
  signal: AbortSignal,
): Promise<void> {
  const current = activeRun();
  const requirementIds = new Set(requirements.map((requirement) => requirement.id));
  const diagnosticsByRequirement = new Map((current?.researchDiagnostics ?? [])
    .filter((diagnostic) => requirementIds.has(diagnostic.requirementId))
    .map((diagnostic) => [diagnostic.requirementId, diagnostic]));
  const preservedAssets = (current?.sourceAssets ?? []).filter((asset) => (
    requirementIds.has(asset.requirementId)
  ));
  const remainingRequirements = requirements.filter((requirement) => (
    diagnosticsByRequirement.get(requirement.id)?.status !== 'matched'
  ));
  const searches: Awaited<ReturnType<typeof searchCommonsForRequirement>>[] = [];
  const progressPatch = (phase: SeedancePreproductionPhase) => ({
    researchDiagnostics: requirements.flatMap((requirement) => {
      const diagnostic = diagnosticsByRequirement.get(requirement.id);
      return diagnostic ? [diagnostic] : [];
    }),
    sourceAssets: mergeCommonsAssets([
      preservedAssets,
      ...searches.map((search) => search.assets),
    ]),
    phase,
  });
  for (let index = 0; index < remainingRequirements.length; index += COMMONS_RESEARCH_BATCH_SIZE) {
    signal.throwIfAborted();
    const batch = remainingRequirements.slice(index, index + COMMONS_RESEARCH_BATCH_SIZE);
    const completedBatch = await Promise.all(batch.map((requirement) => (
      searchCommonsForRequirement(requirement, signal)
    )));
    searches.push(...completedBatch);
    completedBatch.forEach((search) => {
      diagnosticsByRequirement.set(search.diagnostic.requirementId, search.diagnostic);
    });
    patchRun(runId, progressPatch('researching'));
  }
  patchRun(runId, progressPatch('reviewing-media'));
}

function stablePhaseAfterStop(run: SeedancePreproductionRun): SeedancePreproductionPhase {
  if (run.phase === 'generating-ideas') return run.ideas.length > 0 ? 'choosing-idea' : 'failed';
  if (run.phase === 'writing-story') return run.ideas.length > 0 ? 'choosing-idea' : 'failed';
  if (run.phase === 'planning-assets' || run.phase === 'researching') {
    return run.story ? 'reviewing-media' : run.ideas.length > 0 ? 'choosing-idea' : 'failed';
  }
  if (run.phase === 'generating-masters') {
    return run.masterLooks.some((look) => look.status === 'ready')
      ? 'choosing-master'
      : 'reviewing-media';
  }
  if (run.phase === 'generating-keyframes') {
    return run.keyframeBriefs.length > 0 ? 'reviewing-keyframes' : 'choosing-master';
  }
  if (run.phase === 'implementing-edit') return run.story ? 'planning-assets' : 'failed';
  return run.phase;
}

async function planStoryAssets(
  run: SeedancePreproductionRun,
  story: SeedanceStory,
  sourceBundleId: string,
  signal: AbortSignal,
): Promise<SeedanceAssetPlan> {
  const result = await runSeedanceKernelStage({
    operation: 'asset-plan',
    input: {
      prompt: run.prompt,
      story,
      sourceBundleId,
    },
  }, signal);
  if (result.kind !== 'asset-plan') {
    throw new Error('The kernel returned the wrong asset-planning step.');
  }
  return result;
}

function selectedImportedAssets(run: SeedancePreproductionRun): CommonsSourceAsset[] {
  return selectSeedanceGenerationAssets(
    run.sourceAssets.filter((asset) => Boolean(asset.mediaFileId)),
  );
}

function selectedMaster(run: SeedancePreproductionRun): SeedanceMasterLook | undefined {
  return run.masterLooks.find((look) => look.id === run.selectedMasterLookId);
}

async function generateMasterLooksForRun(runId: string, signal: AbortSignal): Promise<void> {
  const current = readSeedancePreproductionStore().runs[runId];
  if (!current?.story) return;
  const masterGenerationRound = (current.masterGenerationRound ?? 0) + 1;
  patchRun(runId, {
    error: undefined,
    masterGenerationRound,
    masterLooks: [],
    selectedMasterLookId: undefined,
    phase: 'generating-masters',
  });
  const sourceBundle = await sourceBundleForRun(current, signal);
  const selectedReferences = selectSeedanceGenerationAssets(current.sourceAssets);
  const importedSelections = await importSeedanceGenerationAssets(selectedReferences, signal);
  signal.throwIfAborted();
  const importedById = new Map(importedSelections.map((asset) => [asset.id, asset]));
  const sourceAssets = current.sourceAssets.map((asset) => importedById.get(asset.id) ?? asset);
  patchRun(runId, { sourceAssets });
  const withImports = { ...current, sourceAssets };
  const result = await runSeedanceKernelStage({
    operation: 'master-looks',
    input: {
      prompt: current.prompt,
      story: current.story,
      selectedAssets: selectedImportedAssets(withImports),
      sourceBundleId: sourceBundle.id,
    },
  }, signal);
  if (result.kind !== 'master-looks') throw new Error('The kernel returned the wrong workflow step.');
  const masterLooks: SeedanceMasterLook[] = result.looks.map((look) => ({
    ...look,
    status: 'generating',
  }));
  patchRun(runId, { masterLooks });
  await Promise.all(masterLooks.map(async (look) => {
    const key = `kernel-media-generation:seedance:${runId}:master:${masterGenerationRound}:${look.id}`;
    try {
      const generated = await generateSeedanceImage({
        idempotencyKey: key,
        negativePrompt: look.negativePrompt,
        prompt: look.prompt,
        providerId: result.imageProviderId,
        referenceMediaFileIds: selectedImportedAssets(withImports)
          .flatMap((asset) => asset.mediaFileId ? [asset.mediaFileId] : []),
        signal,
      });
      const latest = readSeedancePreproductionStore().runs[runId];
      if (!latest) return;
      patchRun(runId, {
        masterLooks: latest.masterLooks.map((candidate) => candidate.id === look.id
          ? { ...candidate, generationRecordId: generated.recordId, mediaFileId: generated.mediaFileId, status: 'ready' }
          : candidate),
      });
    } catch (error) {
      if (signal.aborted) throw error;
      const latest = readSeedancePreproductionStore().runs[runId];
      if (!latest) return;
      patchRun(runId, {
        masterLooks: latest.masterLooks.map((candidate) => candidate.id === look.id
          ? { ...candidate, error: errorMessage(error), status: 'failed' }
          : candidate),
      });
    }
  }));
  const completed = readSeedancePreproductionStore().runs[runId];
  const hasReadyLook = completed?.masterLooks.some((look) => look.status === 'ready') === true;
  patchRun(runId, {
    phase: hasReadyLook ? 'choosing-master' : 'failed',
    ...(hasReadyLook ? {} : { error: 'No master look could be generated.' }),
  });
}

function referenceIdsForKeyframe(
  run: SeedancePreproductionRun,
  brief: SeedanceKeyframeBrief,
): string[] {
  const master = selectedMaster(run);
  const assetMediaIds = brief.referenceAssetIds.flatMap((assetId) => {
    const mediaFileId = run.sourceAssets.find((asset) => asset.id === assetId)?.mediaFileId;
    return mediaFileId ? [mediaFileId] : [];
  });
  const previousMediaIds = brief.previousKeyframeIds.flatMap((briefId) => {
    const versionId = run.acceptedVersionByBriefId[briefId];
    const mediaFileId = run.keyframeVersions.find((version) => version.id === versionId)?.mediaFileId;
    return mediaFileId ? [mediaFileId] : [];
  });
  return [...new Set([
    ...(master?.mediaFileId ? [master.mediaFileId] : []),
    ...assetMediaIds,
    ...previousMediaIds,
  ])];
}

export function useSeedancePreproductionController(
  options: SeedancePreproductionControllerOptions,
) {
  const { enabled = true, executeDirectEdit, stopDirectEdit } = options;
  const state = useSeedancePreproductionStore();
  const run = state.activeRunId ? state.runs[state.activeRunId] : undefined;
  const abortRef = useRef<AbortController | null>(null);
  const sceneStreamControllersRef = useRef(new Map<string, AbortController>());

  const beginOperation = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    return controller;
  }, []);

  const start = useCallback(async (
    prompt: string,
    sourceMediaFileIds?: readonly string[],
    preferences: SeedanceStoryPreferences = DEFAULT_SEEDANCE_STORY_PREFERENCES,
  ): Promise<SeedancePreproductionStartOutcome> => {
    const visiblePrompt = prompt.trim();
    if (!visiblePrompt) return 'failed';
    const controller = beginOperation();
    const nextRun = createRun(visiblePrompt, sourceMediaFileIds, preferences);
    state.putRun(nextRun);
    try {
      const sourceBundle = await ensureSourceBundle(sourceMediaFileIds, controller.signal);
      patchRun(nextRun.id, { sourceBundle });
      const orchestration = await startSeedanceOrchestration({
        runId: nextRun.id,
        prompt: visiblePrompt,
        sourceBundleId: sourceBundle.id,
        preferences: nextRun.preferences,
        signal: controller.signal,
      });
      patchRun(nextRun.id, { orchestration });
      const completed = await followRunUntil(
        nextRun.id,
        new Set(['awaiting-selection', 'reviewing-media', 'completed', 'failed', 'cancelled']),
        controller.signal,
      );
      if (completed.phase === 'failed' || completed.phase === 'cancelled') {
        throw new Error(completed.error || 'Story concept orchestration stopped.');
      }
      if (completed.phase === 'reviewing-media' || completed.phase === 'completed') {
        await finishSelectedOrchestration(
          nextRun.id,
          completed,
          controller.signal,
          executeDirectEdit,
        );
      }
      return 'completed';
    } catch (error) {
      if (controller.signal.aborted) return 'stopped';
      patchRun(nextRun.id, { error: errorMessage(error), phase: 'failed' });
      return 'failed';
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [beginOperation, executeDirectEdit, state]);

  const moreIdeas = useCallback(async (idea: SeedanceStoryIdea) => {
    const current = activeRun();
    if (!current) return;
    const controller = beginOperation();
    patchRun(current.id, { error: undefined, phase: 'generating-ideas' });
    try {
      const sourceBundle = await sourceBundleForRun(current, controller.signal);
      const result = await runSeedanceKernelStage({
        operation: 'ideas',
        input: {
          prompt: current.prompt,
          inspiration: idea,
          sourceBundleId: sourceBundle.id,
        },
      }, controller.signal);
      if (result.kind !== 'ideas') throw new Error('The kernel returned the wrong workflow step.');
      patchRun(current.id, { ideas: result.ideas, phase: 'choosing-idea' });
    } catch (error) {
      if (controller.signal.aborted) return;
      patchRun(current.id, { error: errorMessage(error), phase: 'choosing-idea' });
    }
  }, [beginOperation]);

  const chooseIdea = useCallback(async (idea: SeedanceStoryIdea) => {
    const current = activeRun();
    if (!current) return;
    const controller = beginOperation();
    patchRun(current.id, {
      error: undefined,
      selectedIdeaId: idea.id,
      phase: 'writing-story',
    });
    try {
      if (!current.orchestration) throw new Error('The concept orchestration is unavailable.');
      const orchestration = await selectSeedanceOrchestrationConcept({
        runId: current.id,
        selectedConceptId: idea.id,
        signal: controller.signal,
      });
      patchOrchestrationSnapshot(current.id, orchestration);
      const completed = await followRunUntil(
        current.id,
        new Set(['reviewing-media', 'completed', 'failed', 'cancelled']),
        controller.signal,
      );
      if (completed.phase === 'failed' || completed.phase === 'cancelled') {
        throw new Error(completed.error || 'The selected concept could not be planned.');
      }
      await finishSelectedOrchestration(
        current.id,
        completed,
        controller.signal,
        executeDirectEdit,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const latest = activeRun();
      patchRun(current.id, {
        error: errorMessage(error),
        phase: latest?.story ? 'failed' : 'choosing-idea',
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [beginOperation, executeDirectEdit]);

  const retrySourceResearch = useCallback(async () => {
    const current = activeRun();
    if (!current?.story) return;
    const controller = beginOperation();
    patchRun(current.id, { error: undefined, phase: 'researching' });
    try {
      await researchStorySources(
        current.id,
        researchRequirementsForRun(current),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
    }
  }, [beginOperation]);

  const replanAssets = useCallback(async () => {
    const current = activeRun();
    if (!current?.story) return;
    const controller = beginOperation();
    const previous = {
      assetPlan: current.assetPlan,
      researchDiagnostics: current.researchDiagnostics,
      sourceAssets: current.sourceAssets,
    };
    patchRun(current.id, { error: undefined, phase: 'planning-assets' });
    try {
      const sourceBundle = await sourceBundleForRun(current, controller.signal);
      const assetPlan = await planStoryAssets(
        current,
        current.story,
        sourceBundle.id,
        controller.signal,
      );
      patchRun(current.id, {
        assetPlan,
        researchDiagnostics: [],
        sourceAssets: [],
        phase: 'researching',
      });
      await researchStorySources(
        current.id,
        researchRequirementsFromAssetPlan(assetPlan),
        controller.signal,
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      patchRun(current.id, {
        ...previous,
        error: errorMessage(error),
        phase: 'reviewing-media',
      });
    }
  }, [beginOperation]);

  const toggleSourceAsset = useCallback((assetId: string) => {
    const current = activeRun();
    if (!current || current.phase !== 'reviewing-media') return;
    patchRun(current.id, {
      sourceAssets: current.sourceAssets.map((asset) => (
        asset.id === assetId ? { ...asset, selected: !asset.selected } : asset
      )),
    });
  }, []);

  const continueFromMedia = useCallback(async () => {
    const current = activeRun();
    if (!current?.story) return;
    const controller = beginOperation();
    try {
      if (current.orchestration?.treatment?.aiGeneration?.required === false) {
        patchRun(current.id, { error: undefined, phase: 'implementing-edit' });
        const imported = await importSeedanceGenerationAssets(
          selectSeedanceGenerationAssets(current.sourceAssets),
          controller.signal,
        );
        const importedById = new Map(imported.map((asset) => [asset.id, asset]));
        const sourceAssets = current.sourceAssets.map((asset) => importedById.get(asset.id) ?? asset);
        patchRun(current.id, { sourceAssets });
        await executeDirectEdit({
          idempotencyKey: `seedance-direct-edit:${current.id}`,
          prompt: current.prompt,
          runId: current.id,
          sourceFileIds: [...new Set([
            ...(current.sourceMediaFileIds ?? []),
            ...sourceAssets.flatMap((asset) => asset.mediaFileId ? [asset.mediaFileId] : []),
          ])],
        });
        controller.signal.throwIfAborted();
        patchRun(current.id, { phase: 'edit-ready' });
      } else {
        await generateMasterLooksForRun(current.id, controller.signal);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [beginOperation, executeDirectEdit]);

  const generateKeyframeVersions = useCallback(async (
    runId: string,
    briefs: SeedanceKeyframeBrief[],
    providerId: string,
    controller: AbortController,
  ) => {
    const createdAt = Date.now();
    const versions: SeedanceKeyframeVersion[] = briefs.map((brief, index) => ({
      id: `${brief.id}-v-${createdAt.toString(36)}-${index + 1}`,
      briefId: brief.id,
      createdAt: createdAt + index,
      status: 'generating',
    }));
    const current = activeRun();
    if (!current) return;
    patchRun(runId, { keyframeVersions: [...current.keyframeVersions, ...versions] });
    for (const [index, brief] of briefs.entries()) {
      if (controller.signal.aborted) return;
      const version = versions[index];
      if (!version) continue;
      const beforeGeneration = activeRun();
      if (!beforeGeneration) return;
      try {
        const generated = await generateSeedanceImage({
          idempotencyKey: `kernel-media-generation:seedance:${runId}:keyframe:${version.id}`,
          negativePrompt: brief.negativePrompt,
          prompt: brief.prompt,
          providerId,
          referenceMediaFileIds: referenceIdsForKeyframe(beforeGeneration, brief),
          signal: controller.signal,
        });
        const latest = activeRun();
        if (!latest) return;
        patchRun(runId, {
          acceptedVersionByBriefId: {
            ...latest.acceptedVersionByBriefId,
            [brief.id]: version.id,
          },
          keyframeVersions: latest.keyframeVersions.map((candidate) => candidate.id === version.id
            ? {
                ...candidate,
                generationRecordId: generated.recordId,
                mediaFileId: generated.mediaFileId,
                status: 'ready',
              }
            : candidate),
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        const latest = activeRun();
        if (!latest) return;
        patchRun(runId, {
          keyframeVersions: latest.keyframeVersions.map((candidate) => candidate.id === version.id
            ? { ...candidate, error: errorMessage(error), status: 'failed' }
            : candidate),
        });
      }
    }
  }, []);

  const chooseMaster = useCallback(async (look: SeedanceMasterLook) => {
    const current = activeRun();
    if (!current?.story || !look.mediaFileId || look.status !== 'ready') return;
    const controller = beginOperation();
    patchRun(current.id, {
      error: undefined,
      selectedMasterLookId: look.id,
      phase: 'generating-keyframes',
    });
    try {
      const sourceBundle = await sourceBundleForRun(current, controller.signal);
      const result = await runSeedanceKernelStage({
        operation: 'keyframes',
        input: {
          prompt: current.prompt,
          story: current.story,
          selectedAssets: selectedImportedAssets(current),
          masterLook: look,
          sourceBundleId: sourceBundle.id,
        },
      }, controller.signal);
      if (result.kind !== 'keyframes') throw new Error('The kernel returned the wrong workflow step.');
      patchRun(current.id, {
        keyframeBriefs: result.keyframes,
        segments: result.segments,
      });
      await generateKeyframeVersions(
        current.id,
        result.keyframes,
        result.imageProviderId,
        controller,
      );
      const completed = activeRun();
      const allReady = Boolean(completed && result.keyframes.every((brief) => {
        const versionId = completed.acceptedVersionByBriefId[brief.id];
        return completed.keyframeVersions.some((version) => (
          version.id === versionId && version.status === 'ready'
        ));
      }));
      patchRun(current.id, {
        phase: allReady ? 'ready' : 'reviewing-keyframes',
        selectedKeyframeIds: [],
      });
    } catch (error) {
      patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
    }
  }, [beginOperation, generateKeyframeVersions]);

  const toggleKeyframe = useCallback((briefId: string) => {
    const current = activeRun();
    if (!current || (current.phase !== 'reviewing-keyframes' && current.phase !== 'ready')) return;
    patchRun(current.id, {
      selectedKeyframeIds: current.selectedKeyframeIds.includes(briefId)
        ? current.selectedKeyframeIds.filter((id) => id !== briefId)
        : [...current.selectedKeyframeIds, briefId],
    });
  }, []);

  const regenerateSelected = useCallback(async (feedback: string) => {
    const current = activeRun();
    const master = current ? selectedMaster(current) : undefined;
    if (!current?.story || !master || current.selectedKeyframeIds.length === 0) return;
    const controller = beginOperation();
    patchRun(current.id, { error: undefined, phase: 'generating-keyframes' });
    try {
      const sourceBundle = await sourceBundleForRun(current, controller.signal);
      const result = await runSeedanceKernelStage({
        operation: 'regenerate-keyframes',
        input: {
          prompt: current.prompt,
          story: current.story,
          selectedAssets: selectedImportedAssets(current),
          masterLook: master,
          feedback: feedback.trim(),
          keyframes: current.keyframeBriefs,
          selectedKeyframeIds: current.selectedKeyframeIds,
          sourceBundleId: sourceBundle.id,
        },
      }, controller.signal);
      if (result.kind !== 'keyframes') throw new Error('The kernel returned the wrong workflow step.');
      const replacements = new Map(result.keyframes.map((brief) => [brief.id, brief]));
      const keyframeBriefs = current.keyframeBriefs.map((brief) => replacements.get(brief.id) ?? brief);
      patchRun(current.id, { keyframeBriefs, segments: result.segments });
      const selectedReplacements = keyframeBriefs.filter((brief) => (
        current.selectedKeyframeIds.includes(brief.id)
      ));
      await generateKeyframeVersions(
        current.id,
        selectedReplacements,
        result.imageProviderId,
        controller,
      );
      const completed = activeRun();
      const allReady = Boolean(completed && keyframeBriefs.every((brief) => {
        const versionId = completed.acceptedVersionByBriefId[brief.id];
        return completed.keyframeVersions.some((version) => (
          version.id === versionId && version.status === 'ready'
        ));
      }));
      patchRun(current.id, {
        phase: allReady ? 'ready' : 'reviewing-keyframes',
        selectedKeyframeIds: [],
      });
    } catch (error) {
      patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
    }
  }, [beginOperation, generateKeyframeVersions]);

  const setSceneExpanded = useCallback((sceneId: string, expanded: boolean) => {
    const current = activeRun();
    const existing = sceneStreamControllersRef.current.get(sceneId);
    existing?.abort();
    sceneStreamControllersRef.current.delete(sceneId);
    if (!expanded || !current?.orchestration) return;
    const controller = new AbortController();
    sceneStreamControllersRef.current.set(sceneId, controller);
    const priorSceneCursor = current.orchestrationEvents
      .filter((event) => event.sceneId === sceneId)
      .reduce((maximum, event) => Math.max(maximum, event.sequence), 0);
    void followSeedanceSceneOrchestration({
      runId: current.id,
      sceneId,
      afterSequence: priorSceneCursor,
      signal: controller.signal,
      onEvents: (events, cursor) => patchOrchestrationEvents(current.id, events, cursor),
    }).catch((error) => {
      if (!controller.signal.aborted) {
        patchRun(current.id, { error: errorMessage(error) });
      }
    }).finally(() => {
      if (sceneStreamControllersRef.current.get(sceneId) === controller) {
        sceneStreamControllersRef.current.delete(sceneId);
      }
    });
  }, []);

  const shouldResumeOrchestration = enabled && Boolean(run?.orchestration && ![
    'awaiting-selection', 'reviewing-media', 'completed', 'failed', 'cancelled',
  ].includes(run.orchestration.phase));
  useEffect(() => {
    const current = activeRun();
    if (!shouldResumeOrchestration || !current?.orchestration || abortRef.current) return;
    const controller = beginOperation();
    void followRunUntil(
      current.id,
      new Set(['awaiting-selection', 'reviewing-media', 'completed', 'failed', 'cancelled']),
      controller.signal,
    ).then(async (completed) => {
      if (completed.phase === 'reviewing-media' || completed.phase === 'completed') {
        await finishSelectedOrchestration(
          current.id,
          completed,
          controller.signal,
          executeDirectEdit,
        );
      }
    }).catch((error) => {
      if (!controller.signal.aborted) {
        patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
      }
    }).finally(() => {
      if (abortRef.current === controller) abortRef.current = null;
    });
  }, [beginOperation, executeDirectEdit, shouldResumeOrchestration]);

  useEffect(() => () => {
    abortRef.current?.abort();
    sceneStreamControllersRef.current.forEach((controller) => controller.abort());
    sceneStreamControllersRef.current.clear();
  }, []);

  const stop = useCallback(() => {
    const current = activeRun();
    if (current?.phase === 'implementing-edit') stopDirectEdit?.();
    abortRef.current?.abort(new DOMException('Story workflow stopped.', 'AbortError'));
    abortRef.current = null;
    sceneStreamControllersRef.current.forEach((controller) => controller.abort());
    sceneStreamControllersRef.current.clear();
    if (!current) return;
    if (current.orchestration && !['completed', 'failed', 'cancelled'].includes(current.orchestration.phase)) {
      void cancelSeedanceOrchestration(current.id).then((orchestration) => {
        patchOrchestrationSnapshot(current.id, orchestration);
      }).catch(() => undefined);
    }
    const phase = stablePhaseAfterStop(current);
    patchRun(current.id, {
      phase,
      ...(phase === 'failed' ? { error: 'Preproduction stopped before a reviewable result was ready.' } : {}),
    });
  }, [stopDirectEdit]);

  const reset = useCallback(() => {
    const current = activeRun();
    if (current?.phase === 'implementing-edit') stopDirectEdit?.();
    abortRef.current?.abort(new DOMException('Story workflow reset.', 'AbortError'));
    abortRef.current = null;
    sceneStreamControllersRef.current.forEach((controller) => controller.abort());
    sceneStreamControllersRef.current.clear();
    if (current?.orchestration && !['completed', 'failed', 'cancelled'].includes(current.orchestration.phase)) {
      void cancelSeedanceOrchestration(current.id).catch(() => undefined);
    }
    state.resetRuns();
  }, [state, stopDirectEdit]);

  const resume = useCallback(() => {
    const current = activeRun();
    if (!current) return;
    if (
      (current.orchestration?.phase === 'reviewing-media' || current.orchestration?.phase === 'completed')
      && current.orchestration.story
    ) {
      const controller = beginOperation();
      patchRun(current.id, { error: undefined, phase: 'planning-assets' });
      void finishSelectedOrchestration(
        current.id,
        current.orchestration,
        controller.signal,
        executeDirectEdit,
      ).catch((error) => {
        if (!controller.signal.aborted) patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
      }).finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
      return;
    }
    if (current.orchestration?.phase === 'failed') {
      const controller = beginOperation();
      void resumeSeedanceOrchestration(current.id, controller.signal).then(async (orchestration) => {
        patchOrchestrationSnapshot(current.id, orchestration);
        const completed = await followRunUntil(
          current.id,
          new Set(['awaiting-selection', 'reviewing-media', 'completed', 'failed', 'cancelled']),
          controller.signal,
        );
        if (completed.phase === 'reviewing-media' || completed.phase === 'completed') {
          await finishSelectedOrchestration(
            current.id,
            completed,
            controller.signal,
            executeDirectEdit,
          );
        }
      }).catch((error) => {
        if (!controller.signal.aborted) patchRun(current.id, { error: errorMessage(error), phase: 'failed' });
      }).finally(() => {
        if (abortRef.current === controller) abortRef.current = null;
      });
      return;
    }
    const phase = current.story
      ? 'reviewing-media'
      : current.ideas.length > 0 ? 'choosing-idea' : 'failed';
    patchRun(current.id, { error: undefined, phase });
  }, [beginOperation, executeDirectEdit]);

  useEffect(() => {
    if (!enabled || run?.phase !== 'implementing-edit' || abortRef.current) return;
    resume();
  }, [enabled, resume, run?.id, run?.phase]);

  const setStoryExpanded = useCallback((expanded: boolean) => {
    const current = activeRun();
    if (current) patchRun(current.id, { storyExpanded: expanded });
  }, []);

  const readyKeyframeCount = useMemo(() => run?.keyframeBriefs.filter((brief) => {
    const versionId = run.acceptedVersionByBriefId[brief.id];
    return run.keyframeVersions.some((version) => version.id === versionId && version.status === 'ready');
  }).length ?? 0, [run]);

  return {
    chooseIdea,
    chooseMaster,
    continueFromMedia,
    regenerateMasters: continueFromMedia,
    moreIdeas,
    readyKeyframeCount,
    regenerateSelected,
    replanAssets,
    retrySourceResearch,
    resume,
    reset,
    run,
    setSceneExpanded,
    setStoryExpanded,
    start,
    stop,
    toggleKeyframe,
    toggleSourceAsset,
  };
}

export const seedancePreproductionControllerInternals = { ensureSourceBundle };
