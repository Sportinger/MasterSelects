import { entityKey } from '../domains/jsonBoundary';
import { createEmptySeedancePreproductionState } from '../../../seedancePreproduction/contracts';
import type { CoordinatorActivation } from './ProjectTransactionCoordinator';
import { RepositoryError, type EntityDTO, type JsonValue, type RepositoryProjection } from '../contracts';
import type { RepositorySession } from '../RepositorySession';
import { decodeProjectDomains } from '../domains/projectDomains';
import { decodeOwnedAggregate, object } from './domainAdapters/aggregatePlan';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { getEditorRepositorySession, getEditorRepositoryWorkspace } from './editorMutationRuntime';
import { blockEditorContentPublication, publishEditorContentProjection, readEditorContentPublication } from './editorPublication';
import { stageEditorTimeline } from './editorTimelineRestore';
import type { MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { convertProjectCompositionToStore } from '../../load/loadTimelineHydration';
import { convertProjectMediaToStore, convertProjectFolderToStore } from '../../load/loadMediaHydration';
import { createGeneratedMediaItemsForLoad, createSignalHydrationStateForLoad } from '../../load/loadSignalsHydration';
import { stopInternalPosition, updateInternalPosition } from '../../../layerBuilder/PlayheadState';
import { stopTimelineAudioPlayback } from '../../../audio/timelineAudioPlaybackStopper';
import { syncHistoryRehydratedTimelineRuntimeResources } from '../../../timeline/historyRuntimeRehydration';
import { scheduleMediaSourceArtifactProjectionForClips } from '../../../mediaArtifacts/mediaSourceArtifacts';
import { layerBuilder } from '../../../layerBuilder';
import { renderHostPort } from '../../../render/renderHostPort';
import { isExclusiveTimelineMutationLeaseActive } from '../../../../stores/timeline/exclusiveMutationLease';
import { readDocumentsManifest } from '../../../documents/documentArtifacts';
import { readEditorProjectionJournals, readInitialEditorFlashBoard, restoreEditorFlashBoardAuthoredFields } from './editorJournalHydration';
import { createDefaultExportStoreData } from '../../../../stores/exportStore';
import { scheduleLinkedMediaConnection, startScheduledLinkedMediaConnection } from './editorLinkedMediaConnection';
import { navigateEditorComposition } from './editorCompositionNavigation';

function decodeEntities(entities: ReadonlyMap<string, EntityDTO>): Map<string, EntityDTO> {
  const clean = new Map<string, EntityDTO>();
  for (const [key, entity] of entities) {
    if (!entity.value || typeof entity.value !== 'object' || Array.isArray(entity.value)) { clean.set(key, entity); continue; }
    const { $sourceIdentity: _identity, $resultBindings: _results, ...value } = entity.value;
    clean.set(key, { ...entity, value });
  }
  return clean;
}
function workspaceForDecode(value: JsonValue): JsonValue {
  const incoming = object(value), workspace = { ...structuredClone(incoming), ...object(incoming['project-codec']) }, fields = object(workspace.fields), resolvers = object(workspace.resolvers), nested = object(workspace.nested), cache = object(workspace.cache);
  for (const [key, item] of Object.entries(workspace)) {
    const codec = /^codec\/(fields|resolvers|nested|cache)\/(.+)$/u.exec(key);
    if (codec) ({ fields, resolvers, nested, cache }[codec[1] as 'fields'])[codec[2]] = item;
  }
  workspace.fields = fields; workspace.resolvers = resolvers; workspace.nested = nested; workspace.cache = cache;
  return workspace as JsonValue;
}
export function createEditorRepositoryActivation(): CoordinatorActivation {
  return { canActivate() {
    const timeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
    return !timeline?.isExporting && !isExclusiveTimelineMutationLeaseActive() && !readEditorContentPublication().blocked;
  }, activate(projection, previous, signal) { return activateEditorProjection(projection, previous, getEditorRepositoryWorkspace(), signal); } };
}
export async function activateRepositoryProjection(session: RepositorySession, workspace: JsonValue = {}, signal = new AbortController().signal): Promise<void> {
  const focus = object(workspace)['media/activeCompositionId'] ?? object(object(workspace).top).activeCompositionId;
  await activateEditorProjection(session.coordinator.getProjection(), { revisionId: null, generation: readEditorContentPublication().generation, entities: new Map() }, workspace, signal, typeof focus === 'string' ? focus : null, session, true);
}
export async function activateEditorComposition(id: string | null): Promise<void> {
  await navigateEditorComposition(id);
}
async function activateEditorProjection(projection: RepositoryProjection, previous: RepositoryProjection, workspace: JsonValue, signal: AbortSignal,
  desiredActiveId?: string | null, requestedSession = getEditorRepositorySession(), initialOpen = false): Promise<void> {
  const timelineStore = getRepositoryStore('timeline'), mediaStore = getRepositoryStore('media');
  if (!timelineStore || !mediaStore) throw new RepositoryError('ownership', 'Editor stores are not initialized');
  const timelineBefore = timelineStore.getState() as TimelineStore, mediaBefore = mediaStore.getState() as MediaState;
  if (timelineBefore.isExporting || isExclusiveTimelineMutationLeaseActive()) throw new RepositoryError('ownership', 'Cannot activate during export or a verified kernel operation');
  blockEditorContentPublication(); stopInternalPosition(); withRepositoryHydration(stopTimelineAudioPlayback);
  const priorStores = new Map(['timeline', 'media', 'documents', 'tracking', 'storyboard', 'seedance', 'midi', 'export', 'dock', 'flashboard'].map(domain => [domain, getRepositoryStore(domain)?.getState()]));
  let staged: Awaited<ReturnType<typeof stageEditorTimeline>> | null = null, swapped = false;
  try {
    const journals = requestedSession ? await readEditorProjectionJournals(requestedSession, projection.entities) : [];
    const project = decodeProjectDomains(decodeEntities(projection.entities), workspaceForDecode(workspace), journals);
    const journalFlashBoard = requestedSession ? await readInitialEditorFlashBoard(requestedSession, project) : null;
    const flashBoard = journalFlashBoard ? initialOpen ? journalFlashBoard : restoreEditorFlashBoardAuthoredFields(
      { ...journalFlashBoard, ...object(priorStores.get('flashboard')), aiWorkspaces: [
        ...(journalFlashBoard.aiWorkspaces as unknown[]), ...(object(priorStores.get('flashboard')).aiWorkspaces as unknown[] ?? []),
      ] }, journalFlashBoard.aiWorkspaces as unknown[]) : null;
    const documents = await readDocumentsManifest(project.documents);
    const compositionIds = new Set(project.compositions.map(comp => comp.id));
    // Keep workspace focus when navigating content, pruning removed objects.
    const wanted = object(workspace)['media/activeCompositionId'];
    const activeCompositionId = desiredActiveId !== undefined ? desiredActiveId && compositionIds.has(desiredActiveId) ? desiredActiveId : project.compositions[0]?.id ?? null : mediaBefore.activeCompositionId && compositionIds.has(mediaBefore.activeCompositionId)
      ? mediaBefore.activeCompositionId : typeof wanted === 'string' && compositionIds.has(wanted) ? wanted : project.activeCompositionId && compositionIds.has(project.activeCompositionId)
        ? project.activeCompositionId : project.compositions[0]?.id ?? null;
    const compositions = convertProjectCompositionToStore(project.compositions, project.uiState?.compositionViewState);
    const converted = await convertProjectMediaToStore(project.media, { hydrateFiles: false, deferCacheChecks: true });
    if (signal.aborted) throw new RepositoryError('cancelled', 'Project activation cancelled');
    const priorFiles = new Map(mediaBefore.files.map(file => [file.id, file]));
    const linkedMedia: typeof project.media = [];
    const files = await mapBounded(converted, MEDIA_BINDING_CONCURRENCY, async file => {
      return bindActivatedMedia(file);
    });
    async function bindActivatedMedia(file: (typeof converted)[number]) {
      const prior = priorFiles.get(file.id);
      const key = entityKey('media', 'project', file.id);
      const authored = projection.entities.has(key) ? object(decodeOwnedAggregate(key, projection.entities)) : {};
      const beforeAuthored = previous.entities.has(key) ? object(decodeOwnedAggregate(key, previous.entities)) : {};
      const identity = object(authored.$sourceIdentity ?? projection.entities.get(`source-identity:${file.id}`)?.value);
      const oldIdentity = object(beforeAuthored.$sourceIdentity ?? previous.entities.get(`source-identity:${file.id}`)?.value);
      const reusable = !initialOpen && requestedSession === getEditorRepositorySession() && prior?.file && (
        identity.identityStatus === 'verified' && identity.contentHash === oldIdentity.contentHash ||
        identity.identityStatus !== 'verified' && sameEditorMediaSourceBinding(authored, beforeAuthored));
      // Same source: keep its loaded artifacts too, so undo/redo does not re-hydrate and re-render every clip.
      if (reusable) return { ...file, file: prior.file, url: prior.url, hasFileHandle: prior.hasFileHandle,
        thumbnailUrl: prior.thumbnailUrl, proxyVideoUrl: prior.proxyVideoUrl,
        ...Object.fromEntries((['transcript', 'transcriptArtifact', 'transcribedRanges', 'analysis', 'sceneDescriptions'] as const)
          .filter(field => file[field] === undefined && prior[field] !== undefined).map(field => [field, prior[field]])) };
      // Originals outside the repository connect after opening by size and fingerprint. A full-content hash of
      // hundreds of GB is only needed when exporting embedded originals (runtimeSources), never on every open.
      const item = project.media.find(entry => entry.id === file.id); if (item) linkedMedia.push(item);
      return file;
    }
    const folders = convertProjectFolderToStore(project.folders), folderIds = new Set(folders.map(folder => folder.id));
    const nextMedia = { ...mediaBefore, files, folders, compositions, activeCompositionId,
      slotAssignments: project.slotAssignments ?? {}, slotClipSettings: project.slotClipSettings ?? {},
      ...createGeneratedMediaItemsForLoad(project, folderIds), ...createSignalHydrationStateForLoad(project, folderIds),
      openCompositionIds: initialOpen ? [...new Set([...(project.openCompositionIds ?? []).filter(id => compositionIds.has(id)), ...(activeCompositionId ? [activeCompositionId] : [])])] : mediaBefore.openCompositionIds.filter(id => compositionIds.has(id)),
      selectedIds: mediaBefore.selectedIds.filter(id => files.some(file => file.id === id) || compositionIds.has(id) || folderIds.has(id)),
    } as MediaState;
    const sessionAtStart = getEditorRepositorySession();
    scheduleLinkedMediaConnection(requestedSession, linkedMedia, false);
    const isStillInstalled = () => getEditorRepositorySession() === sessionAtStart;
    const isRuntimeInstalled = () => getEditorRepositorySession() === requestedSession;
    staged = await stageEditorTimeline(timelineBefore, nextMedia, compositions.find(comp => comp.id === activeCompositionId), signal, patch => {
      if (!isRuntimeInstalled() || (timelineStore.getState() as TimelineStore).timelineSessionId !== staged?.state.timelineSessionId) return;
      withRepositoryHydration(() => timelineStore.setState(patch));
    }, () => timelineStore.getState() as TimelineStore);
    if (signal.aborted || !isStillInstalled()) throw new RepositoryError('cancelled', 'Project session changed during runtime staging');
    swapped = true;
    withRepositoryHydration(() => {
      mediaStore.setState(nextMedia); timelineStore.setState(staged!.state);
      if (initialOpen) {
        const restoreView: Record<string, unknown> = { playheadPosition: 0, zoom: 50, scrollX: 0, ...(activeCompositionId ? project.uiState?.compositionViewState?.[activeCompositionId] : {}) };
        for (const field of ['playheadPosition', 'zoom', 'scrollX']) {
          const value = object(workspace)[`timeline/${activeCompositionId}/${field}`]; if (typeof value === 'number') restoreView[field] = value;
        }
        timelineStore.setState(restoreView);
        if (object(workspace)['dock/layout']) getRepositoryStore('dock')?.setState({ layout: object(workspace)['dock/layout'] });

      }
      if (flashBoard) getRepositoryStore('flashboard')?.setState(flashBoard);
      const tracking = getRepositoryStore('tracking');
      if (tracking) { const current = object(tracking.getState()); const ids = new Set((project.trackingAssets ?? []).map(asset => asset.id)); tracking.setState({ assets: project.trackingAssets ?? [], selectedAssetId: ids.has(String(current.selectedAssetId)) ? current.selectedAssetId : null }); }
      getRepositoryStore('documents')?.setState({ documents: documents?.documents ?? [],
        activeDocumentId: (documents?.documents.some(doc => doc.id === object(getRepositoryStore('documents')?.getState()).activeDocumentId)) ? object(getRepositoryStore('documents')?.getState()).activeDocumentId : null });
      getRepositoryStore('storyboard')?.setState(project.storyboard ?? emptyStoryboard());
      const currentSeedance = object(getRepositoryStore('seedance')?.getState());
      // External jobs remain current; semantic plans come from the selected revision.
      if (!project.seedancePreproduction) getRepositoryStore('seedance')?.setState(createEmptySeedancePreproductionState());
      else getRepositoryStore('seedance')?.setState({ ...project.seedancePreproduction,
        runs: Object.fromEntries(Object.entries(project.seedancePreproduction.runs).map(([id, run]) => {
          const prior = initialOpen ? {} : object(object(currentSeedance.runs)[id]);
          return [id, { ...run, ...Object.fromEntries(['phase', 'error', 'orchestration', 'orchestrationCursor', 'orchestrationEvents', 'researchDiagnostics', 'updatedAt'].filter(field => field in prior).map(field => [field, prior[field]])) }];
        })) });
      const midi = project.uiState?.midi;
      getRepositoryStore('midi')?.setState({ transportBindings: midi?.transportBindings ?? { playPause: null, stop: null }, slotBindings: midi?.slotBindings ?? {}, parameterBindings: midi?.parameterBindings ?? {} });
      const value = project.uiState?.exportState ?? createDefaultExportStoreData(); getRepositoryStore('export')?.setState({ settings: value.settings, presets: value.presets, batch: { ...value.batch, selectedJobId: object(object(getRepositoryStore('export')?.getState()).batch).selectedJobId ?? null } });
    });
    updateInternalPosition((timelineStore.getState() as TimelineStore).playheadPosition);
    staged.activate();
    syncHistoryRehydratedTimelineRuntimeResources((timelineStore.getState() as TimelineStore).clips);
    scheduleMediaSourceArtifactProjectionForClips((timelineStore.getState() as TimelineStore).clips);
    layerBuilder.invalidateCache(); renderHostPort.clearCaches();
    if (signal.aborted) throw new RepositoryError('cancelled', 'Project activation cancelled after runtime rebind');
    publishEditorContentProjection(projection); renderHostPort.requestNewFrameRender();
    if (!initialOpen) startScheduledLinkedMediaConnection();
  } catch (error) {
    staged?.abandon();
    if (swapped) withRepositoryHydration(() => { for (const [domain, value] of priorStores) if (value) getRepositoryStore(domain)?.setState(value); });
    updateInternalPosition(timelineBefore.playheadPosition);
    syncHistoryRehydratedTimelineRuntimeResources(timelineBefore.clips);
    layerBuilder.invalidateCache(); renderHostPort.clearCaches(); publishEditorContentProjection(previous);
    renderHostPort.requestNewFrameRender(); throw error;
  }
}
/** Binding reads handles, fingerprints and probes durations; hundreds at once stall the media players. */
const MEDIA_BINDING_CONCURRENCY = 6;
async function mapBounded<T, R>(items: readonly T[], limit: number, map: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await map(items[index]); }
  }));
  return results;
}
function emptyStoryboard() { return { schemaVersion: 1, plans: {}, scenes: {}, generationBriefs: {}, candidates: {}, evidenceRefs: {}, coverageBySceneId: {}, variantSets: {}, variantOptions: {}, decisions: {}, templates: {} }; }

/** Runtime reuse during same-session checkout is not durable proof or artifact authorization. */
export function sameEditorMediaSourceBinding(next: Record<string, unknown>, previous: Record<string, unknown>): boolean {
  const fields = ['id', 'sourcePath', 'projectPath', 'sourceRootId', 'sourceRelativePath', 'sourceSelection', 'linkedSources', 'externalOrigin', 'fileHash', 'fileSize', 'type'];
  return fields.every(field => JSON.stringify(next[field]) === JSON.stringify(previous[field]));
}
