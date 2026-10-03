import type { ProjectFile, ProjectUIState } from '../../types/project.types';
import type { ProjectClip, ProjectComposition, ProjectTrack } from '../../types/composition.types';
import type { BlobReference, EntityDTO, JsonValue, RecordReference } from '../contracts';
import { classifyFields } from './fieldOwnership';
import { ProjectFileFields, ProjectCompositionFields, ProjectClipFields, ProjectTrackFields, ProjectMediaFileFields } from './fieldClassifications';
import { splitNestedDomain, restoreNestedDomain, type NestedDomainSplit } from './nestedOwnership';
import { decodeAggregate, domainJson, encodeAggregate, entityKey } from './jsonBoundary';

export interface DomainJournal { id: string; kind: string; value: JsonValue; blobs: BlobReference[]; references: RecordReference[]; }
export interface EncodedProjectDomains { entities: Map<string, EntityDTO>; workspace: JsonValue; journals: DomainJournal[]; }
export interface AggregateEncodingOptions { blobs?: BlobReference[]; }
export const PROJECT_ENTITY_KEY = 'project/root/metadata';
type ObjectValue = Record<string, unknown>;
const ref = (key: string): JsonValue => ({ $repositoryEntity: key });
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
function rejectRepositoryMarkers(value: JsonValue): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (key === '$repositoryEntity' || key === '$repositoryShape') throw new TypeError('Reserved repository marker in user data');
    rejectRepositoryMarkers(child);
  }
}
const without = (value: ObjectValue, fields: string[]): ObjectValue => Object.fromEntries(Object.entries(value).filter(([key]) => !fields.includes(key)));

/** Use this entry point for a touched aggregate; whole-project encoding is import/capture only. */
export function encodeProjectAggregate(domain: string, ownerId: string, id: string, value: unknown, options: AggregateEncodingOptions = {}): Map<string, EntityDTO> {
  rejectRepositoryMarkers(domainJson(value));
  return encodeAggregate(entityKey(domain, ownerId, id), `${domain}-aggregate`, value, options.blobs);
}
export function encodeCompositionClip(compositionId: string, clip: ProjectClip, options: AggregateEncodingOptions = {}): Map<string, EntityDTO> {
  return encodeProjectAggregate('clip', compositionId, clip.id, splitNestedDomain(domainJson(classifyFields(clip, ProjectClipFields).content ?? {}), 'ProjectClip').content, options);
}
export function encodeCompositionTrack(compositionId: string, track: ProjectTrack, options: AggregateEncodingOptions = {}): Map<string, EntityDTO> {
  const content = classifyFields(track, ProjectTrackFields).content ?? {};
  if (content.audioState) content.audioState = without(object(content.audioState), ['inputDeviceId', 'recordArm', 'inputMonitor', 'meterMode']);
  return encodeProjectAggregate('track', compositionId, track.id, splitNestedDomain(domainJson(content), 'ProjectTrack').content, options);
}

/** Canonical and noncanonical fields are split before any content hash is requested. */
export function encodeProjectDomains(project: ProjectFile): EncodedProjectDomains {
  // Validate the complete boundary, including workspace/journals, before splitting it.
  rejectRepositoryMarkers(domainJson(project));
  const entities = new Map<string, EntityDTO>();
  const journals: DomainJournal[] = [];
  const top = classifyFields(project, ProjectFileFields);
  const workspace: ObjectValue = { top: top.workspace ?? {}, fields: {}, resolvers: {}, cache: {}, updatedAt: project.updatedAt };
  workspace.nested = {};
  const nested = workspace.nested as ObjectValue;
  const fields = workspace.fields as ObjectValue;
  const resolvers = workspace.resolvers as ObjectValue;
  const caches = workspace.cache as ObjectValue;
  const root: ObjectValue = {};
  const add = (key: string, type: string, value: unknown): JsonValue => {
    const schemaTypes: Record<string,string> = { 'clip-aggregate': 'ProjectClip', 'track-aggregate': 'ProjectTrack', 'composition-aggregate': 'ProjectComposition', 'media-aggregate': 'ProjectMediaFile', 'signals-aggregate': 'ProjectSignalState', 'audio-artifacts': 'ProjectAudioState', 'document-aggregate': 'ProjectDocument', 'documents-inline': 'DocumentsProjectState', 'documents-manifest': 'DocumentsProjectManifest', 'midi-bindings': 'ProjectMIDIState', 'export-definitions': 'ProjectExportStoreData', 'seedance-run': 'SeedancePreproductionRun', 'seedance-state': 'SeedancePreproductionProjectState', 'flashboard-board': 'ProjectFlashBoardState', 'storyboard-aggregate': 'StoryboardProjectState' };
    const splitValue: NestedDomainSplit = schemaTypes[type] ? splitNestedDomain(domainJson(value), schemaTypes[type]) : { content: domainJson(value), patches: {} };
    const journalPatches = splitValue.patches.journal;
    if (journalPatches) journals.push({ id: 'fields/' + key, kind: 'domain-field-journal', value: domainJson(journalPatches), blobs: [], references: [] });
    const localPatches = Object.fromEntries(Object.entries(splitValue.patches).filter(([classification]) => classification !== 'journal'));
    if (Object.keys(localPatches).length) nested[key] = localPatches;
    for (const [childKey, entity] of encodeAggregate(key, type, splitValue.content)) {
      if (entities.has(childKey)) throw new TypeError(`Duplicate domain identity: ${childKey}`);
      entities.set(childKey, entity);
    }
    return ref(key);
  };
  const journal = (id: string, kind: string, value: unknown) => {
    if (value !== undefined) journals.push({ id, kind, value: domainJson(value), references: [], blobs: [] });
  };
  const list = (domain: string, owner: string, values: unknown[]): JsonValue => {
    const members = values.map((value, index) => {
      const id = object(value).id;
      return add(entityKey(domain, owner, typeof id === 'string' ? id : String(index)), `${domain}-aggregate`, value);
    });
    return add(entityKey('membership', owner, domain), 'domain-membership', members);
  };
  const split = (key: string, groups: ReturnType<typeof classifyFields>): ObjectValue => {
    if (groups.workspace) fields[key] = groups.workspace;
    if (groups.resolver) resolvers[key] = groups.resolver;
    if (groups.cache) caches[key] = groups.cache;
    if (groups.journal) journal(key, 'domain-journal', groups.journal);
    return groups.content ?? {};
  };
  for (const [name, value] of Object.entries(top.content ?? {})) {
    if (['compositions', 'media', 'flashboard', 'audio', 'signals', 'documents', 'seedancePreproduction'].includes(name)) continue;
    if (['name', 'createdAt', 'settings'].includes(name)) { root[name] = value; continue; }
    root[name] = Array.isArray(value) ? list(name, 'project', value) : add(entityKey(name, 'project', 'state'), `${name}-aggregate`, value);
  }
  root.media = add(entityKey('membership', 'project', 'media'), 'domain-membership', project.media.map((media) => {
    const key = entityKey('media', 'project', media.id);
    const content = split(key, classifyFields(media, ProjectMediaFileFields));
    if (Array.isArray(content.linkedSources)) {
      const linkedLocators: ObjectValue = {};
      content.linkedSources = content.linkedSources.map((source) => {
        const entry = object(source);
        linkedLocators[String(entry.id)] = { sourcePath: entry.sourcePath, fileKey: entry.fileKey };
        return without(entry, ['sourcePath', 'fileKey']);
      });
      resolvers[`${key}/linked`] = linkedLocators;
    }
    if ('fileHash' in content) { content.$fastFingerprint = content.fileHash; content.$sourceVerification = 'legacy-unverified'; delete content.fileHash; }
    return add(key, 'media-aggregate', content);
  }));
  root.compositions = add(entityKey('membership', 'project', 'compositions'), 'domain-membership', project.compositions.map((composition) => {
    const key = entityKey('composition', 'project', composition.id);
    const content = split(key, classifyFields(composition, ProjectCompositionFields));
    const view = project.uiState?.compositionViewState?.[composition.id];
    if (view && 'inPoint' in view) content.$inPoint = view.inPoint;
    if (view && 'outPoint' in view) content.$outPoint = view.outPoint;
    content.tracks = add(entityKey('membership', composition.id, 'tracks'), 'domain-membership', composition.tracks.map((track) => {
      const trackKey = entityKey('track', composition.id, track.id);
      const trackContent = split(trackKey, classifyFields(track, ProjectTrackFields));
      if (trackContent.audioState) {
        const audio = object(trackContent.audioState);
        fields[`${trackKey}/audio`] = Object.fromEntries(['inputDeviceId', 'recordArm', 'inputMonitor', 'meterMode'].filter((name) => name in audio).map((name) => [name, audio[name]]));
        trackContent.audioState = without(audio, ['inputDeviceId', 'recordArm', 'inputMonitor', 'meterMode']);
      }
      return add(trackKey, 'track-aggregate', trackContent);
    }));
    content.clips = add(entityKey('membership', composition.id, 'clips'), 'domain-membership', composition.clips.map((clip) => {
      const clipKey = entityKey('clip', composition.id, clip.id);
      return add(clipKey, 'clip-aggregate', split(clipKey, classifyFields(clip, ProjectClipFields)));
    }));
    if (content.masterAudioState) {
      const master = object(content.masterAudioState);
      if (master.exportPreflight !== undefined) fields[`${key}/masterAudio`] = { exportPreflight: master.exportPreflight };
      content.masterAudioState = without(master, ['exportPreflight']);
    }
    return add(key, 'composition-aggregate', content);
  }));
  if (project.audio) {
    // The project-wide master/index must never override composition-owned masters.
    root.audio = add(entityKey('audio', 'project', 'artifacts'), 'audio-artifacts', without(object(project.audio), ['masterAudioState', 'analysisArtifactIds', 'updatedAt']));
    fields.audio = { masterAudioState: project.audio.masterAudioState, analysisArtifactIds: project.audio.analysisArtifactIds, updatedAt: project.audio.updatedAt };
  }
  if (project.signals) {
    root.signals = add(entityKey('signals', 'project', 'state'), 'signals-aggregate', without(object(project.signals), ['updatedAt']));
    fields.signals = { updatedAt: project.signals.updatedAt };
  }
  if (project.documents) {
    const documentState = object(project.documents);
    fields.documents = { activeDocumentId: documentState.activeDocumentId };
    // Inline schema 2 is distinguished from manifest schema 2 by structure.
    const inline = Array.isArray(documentState.documents);
    if (!inline && !Array.isArray(documentState.artifacts)) throw new TypeError('Invalid document structure');
    root.documents = add(entityKey('documents', 'project', 'state'), inline ? 'documents-inline' : 'documents-manifest', {
      schemaVersion: documentState.schemaVersion,
      [inline ? 'documents' : 'artifacts']: list(inline ? 'document' : 'documentManifest', 'project', documentState[inline ? 'documents' : 'artifacts'] as unknown[]),
    });
  }
  const ui = project.uiState;
  if (ui) {
    fields.uiState = without(object(ui), ['history', 'midi', 'exportState']);
    // Move semantic in/out points to their composition owner.
    if (ui.compositionViewState) fields.uiState = { ...object(fields.uiState), compositionViewState: Object.fromEntries(Object.entries(ui.compositionViewState).map(([id, view]) => [id, without(object(view), ['inPoint', 'outPoint'])])) };
    if (ui.history) journal('legacy/history', 'legacy-history', ui.history);
    if (ui.midi) {
      root.midi = add(entityKey('midi', 'project', 'bindings'), 'midi-bindings', without(object(ui.midi), ['isEnabled']));
      fields.midi = { isEnabled: ui.midi.isEnabled };
    }
    if (ui.exportState) {
      const batch = ui.exportState.batch;
      root.export = add(entityKey('export', 'project', 'definitions'), 'export-definitions', { ...without(object(ui.exportState), ['selectedPresetId']), batch: without(object(batch), ['selectedJobId']) });
      fields.export = { selectedPresetId: ui.exportState.selectedPresetId, selectedJobId: batch.selectedJobId };
    }
  }
  if (project.flashboard) {
    const fb = project.flashboard;
    fields.flashboard = { composer: fb.composer, activeWorkspaceId: fb.activeWorkspaceId, workspaceComposers: Object.fromEntries((fb.workspaces ?? []).map((entry) => [entry.id, entry.composer])) };
    journal('flashboard/jobs', 'generation-journal', fb.generationRecords);
    journal('flashboard/prompts', 'prompt-journal', fb.promptHistory);
    journal('flashboard/chat', 'conversation-journal', fb.chatMessages);
    journal('flashboard/workspace-chat', 'conversation-journal', (fb.workspaces ?? []).map(({ id, chatMessages, chatConversationRef }) => ({ id, chatMessages, chatConversationRef })));
    root.flashboard = add(entityKey('flashboard', 'project', 'board'), 'flashboard-board', { version: fb.version, generationMetadataByMediaId: fb.generationMetadataByMediaId,
      workspaces: (fb.workspaces ?? []).map((entry) => without(object(entry), ['composer', 'chatMessages', 'chatConversationRef', 'updatedAt'])) });
  }
  if (project.seedancePreproduction) {
    const seedance = project.seedancePreproduction;
    const runViews: ObjectValue = {};
    root.seedancePreproduction = add(entityKey('seedance', 'project', 'state'), 'seedance-state', {
      ...without(object(seedance), ['activeRunId', 'runs']),
      runs: Object.fromEntries(Object.entries(seedance.runs).map(([id, run]) => {
        const journalFields = ['phase', 'error', 'orchestration', 'orchestrationCursor', 'orchestrationEvents', 'researchDiagnostics', 'updatedAt'];
        journal(`seedance/run/${id}`, 'orchestration-journal', Object.fromEntries(journalFields.filter((name) => name in run).map((name) => [name, object(run)[name]])));
        runViews[id] = { storyExpanded: run.storyExpanded };
        return [id, add(entityKey('seedanceRun', 'project', id), 'seedance-run', without(object(run), [...journalFields, 'storyExpanded']))];
      })),
    });
    fields.seedance = { activeRunId: seedance.activeRunId, runs: runViews };
  }
  add(PROJECT_ENTITY_KEY, 'project-metadata', root);
  // uiState is split above; retaining the original under top would duplicate journals/content.
  delete object(workspace.top).uiState;
  return { entities, workspace: domainJson(workspace), journals };
}

export function decodeProjectDomains(entities: ReadonlyMap<string, EntityDTO>, workspace: JsonValue, journals: readonly DomainJournal[] = [],
  onMissingMembership: (entityId: string) => void = id => console.warn(`[Repository] Missing membership ${id} decoded as empty; the next edit rewrites it.`)): ProjectFile {
  const root = object(decodeAggregate(PROJECT_ENTITY_KEY, entities, { onMissingMembership }));
  const ws = object(domainJson(workspace));
  const fields = object(ws.fields), resolvers = object(ws.resolvers), cache = object(ws.cache);
  const restore = (key: string, content: ObjectValue): ObjectValue => {
    const nestedGroups = object(object(ws.nested)[key]);
    const patches = Object.assign({}, ...Object.values(nestedGroups).map(object), object(journals.find((entry) => entry.id === 'fields/' + key)?.value));
    const value = restoreNestedDomain(content as JsonValue, patches as Record<string,JsonValue>);
    return { ...object(value), ...object(fields[key]), ...object(resolvers[key]), ...object(cache[key]) };
  };
  const project = { ...root, ...object(ws.top), version: 1, updatedAt: typeof ws.updatedAt === 'string' ? ws.updatedAt : '', activeCompositionId: null, openCompositionIds: [], expandedFolderIds: [] } as unknown as ProjectFile;
  Object.assign(project, object(ws.top));
  project.media = project.media.map((media) => {
    const key = entityKey('media', 'project', media.id);
    const restored = restore(key, object(media));
    if (Array.isArray(restored.linkedSources)) restored.linkedSources = restored.linkedSources.map((entry) => ({ ...object(entry), ...object(object(resolvers[`${key}/linked`])[String(object(entry).id)]) }));
    if ('$fastFingerprint' in restored) { restored.fileHash = restored.$fastFingerprint; delete restored.$fastFingerprint; delete restored.$sourceVerification; }
    return { sourcePath: '', hasProxy: false, ...restored } as unknown as ProjectFile['media'][number];
  });
  project.uiState = object(fields.uiState) as ProjectUIState;
  project.compositions = project.compositions.map((composition) => {
    const key = entityKey('composition', 'project', composition.id);
    const restored = restore(key, object(composition));
    restored.tracks = composition.tracks.map((track) => {
      const trackKey = entityKey('track', composition.id, track.id);
      const trackValue: ObjectValue = { height: 60, ...restore(trackKey, object(track)) };
      if (trackValue.audioState) trackValue.audioState = { ...object(trackValue.audioState), ...object(fields[`${trackKey}/audio`]) };
      return trackValue;
    });
    restored.clips = composition.clips.map((clip) => restore(entityKey('clip', composition.id, clip.id), object(clip)));
    if (restored.masterAudioState) restored.masterAudioState = { ...object(restored.masterAudioState), ...object(fields[`${key}/masterAudio`]) };
    if ('$inPoint' in restored || '$outPoint' in restored) {
      const views = project.uiState!.compositionViewState ??= {};
      views[composition.id] = { ...views[composition.id], ...('$inPoint' in restored ? { inPoint: restored.$inPoint as number | null } : {}), ...('$outPoint' in restored ? { outPoint: restored.$outPoint as number | null } : {}) };
      delete restored.$inPoint; delete restored.$outPoint;
    }
    return restored as unknown as ProjectComposition;
  });
  if (project.audio) project.audio = { ...restore(entityKey('audio', 'project', 'artifacts'), object(project.audio)), ...object(fields.audio) } as unknown as ProjectFile['audio'];
  if (project.signals) project.signals = { ...restore(entityKey('signals', 'project', 'state'), object(project.signals)), ...object(fields.signals) } as unknown as ProjectFile['signals'];
  if (project.documents) {
    const documentValue = restore(entityKey('documents', 'project', 'state'), object(project.documents));
    if (Array.isArray(documentValue.documents)) documentValue.documents = documentValue.documents.map((value) => restore(entityKey('document', 'project', String(object(value).id)), object(value)));
    project.documents = { ...documentValue, ...object(fields.documents) } as unknown as ProjectFile['documents'];
  }
  if (root.midi) project.uiState!.midi = { ...restore(entityKey('midi', 'project', 'bindings'), object(root.midi)), ...object(fields.midi) };
  if (root.export) {
    const exportValue = restore(entityKey('export', 'project', 'definitions'), object(root.export)), exportView = object(fields.export);
    project.uiState!.exportState = { ...exportValue, selectedPresetId: exportView.selectedPresetId ?? null, batch: { ...object(exportValue.batch), selectedJobId: exportView.selectedJobId ?? null } } as unknown as ProjectUIState['exportState'];
  }
  const journalValue = (id: string) => journals.find((entry) => entry.id === id)?.value;
  if (project.flashboard) {
    Object.assign(project.flashboard, restore(entityKey('flashboard', 'project', 'board'), object(project.flashboard)));
    const fb = project.flashboard, views = object(fields.flashboard);
    Object.assign(fb, without(views, ['workspaceComposers']), { generationRecords: journalValue('flashboard/jobs') ?? [], promptHistory: journalValue('flashboard/prompts'), chatMessages: journalValue('flashboard/chat') });
    const conversations = journalValue('flashboard/workspace-chat');
    fb.workspaces = fb.workspaces?.map((entry) => ({ ...entry, updatedAt: entry.createdAt, composer: object(object(views.workspaceComposers)[entry.id]), chatMessages: [], ...(Array.isArray(conversations) ? object(conversations.find((value) => object(value).id === entry.id)) : {}) }));
  }
  if (project.seedancePreproduction) {
    const seedance = project.seedancePreproduction, views = object(fields.seedance);
    seedance.activeRunId = typeof views.activeRunId === 'string' ? views.activeRunId : null;
    for (const [id, run] of Object.entries(seedance.runs)) Object.assign(run, restore(entityKey('seedanceRun', 'project', id), object(run)), { phase: 'idle', orchestrationCursor: 0, orchestrationEvents: [], researchDiagnostics: [], updatedAt: run.createdAt, storyExpanded: false }, object(journalValue(`seedance/run/${id}`)), object(object(views.runs)[id]));
  }
  delete (project as unknown as ObjectValue).midi;
  delete (project as unknown as ObjectValue).export;
  return project;
}
