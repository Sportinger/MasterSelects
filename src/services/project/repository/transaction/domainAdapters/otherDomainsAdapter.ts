import { appendFlashBoardJournalDelta } from '../editorFlashBoardJournal';
import type { EntityDTO, JsonValue } from '../../contracts';
import type { ProjectFile } from '../../../types/project.types';
import { domainJson, entityKey } from '../../domains/jsonBoundary';
import { changedItems, type DomainMutationPlan } from '../domainMutationAdapter';
import { emptyPlan, ensureRootField, membership, reference, replaceAggregate, object } from './aggregatePlan';
import { encodedPatch } from './projectPatchCodec';
import { getExportStoreData } from '../../../../../stores/exportStore';
import { selectStoryboardProjectState } from '../../../../../stores/storyboardStore/projectState';
import { granularizeStructuredPlan, STRUCTURED_FIELDS } from './structuredDomain';
import { splitNestedDomain } from '../../domains/nestedOwnership';

type State = Record<string, unknown>;
function list(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, before: unknown, after: unknown,
  field: 'documents' | 'trackingAssets'): void {
  const previous = Array.isArray(before) ? before : [], next = Array.isArray(after) ? after : [];
  const domain = field === 'documents' ? 'document' : field;
  for (const change of changedItems(previous as { id: string }[], next as { id: string }[])) {
    const key = entityKey(domain, 'project', change.id);
    if (!change.after) replaceAggregate(plan, entities, key, `${domain}-aggregate`, undefined);
    else {
      const fields = field === 'documents' ? { documents: { schemaVersion: 2, documents: [change.after], activeDocumentId: null } }
        : { trackingAssets: [change.after] };
      encodedPatch(plan, entities, fields as Partial<ProjectFile>, [key]);
    }
  }
  if (previous.length !== next.length || previous.some((entry, i) => entry.id !== next[i]?.id)) membership(plan, entities, domain, 'project', next.map(entry => entry.id));
  if (field === 'documents') {
    const key = entityKey('documents', 'project', 'state');
    replaceAggregate(plan, entities, key, 'documents-inline', { schemaVersion: 2, documents: reference(entityKey('membership', 'project', 'document')) });
    ensureRootField(plan, entities, field, reference(key));
  } else ensureRootField(plan, entities, field, reference(entityKey('membership', 'project', domain)));
}
function changed(before: State, after: State, fields: readonly string[]): boolean { return fields.some(key => before[key] !== after[key]); }
export function prepareOtherDomainMutation(domain: string, beforeValue: unknown, patchValue: unknown,
  entities: ReadonlyMap<string, EntityDTO>): DomainMutationPlan {
  const before = object(beforeValue), after = { ...before, ...object(patchValue) }, plan = emptyPlan();
  if (domain === 'dock') {
    if (before.layout !== after.layout) plan.views.push({ key: 'dock/layout', value: domainJson(after.layout) });
  } else if (domain === 'documents') {
    if (before.documents !== after.documents) list(plan, entities, before.documents, after.documents, 'documents');
    if (before.activeDocumentId !== after.activeDocumentId) plan.views.push({ key: 'documents/activeDocumentId', value: domainJson(after.activeDocumentId) });
  } else if (domain === 'tracking') {
    if (before.assets !== after.assets) list(plan, entities, before.assets, after.assets, 'trackingAssets');
    if (before.selectedAssetId !== after.selectedAssetId) plan.views.push({ key: 'tracking/selectedAssetId', value: domainJson(after.selectedAssetId) });
  } else if (domain === 'midi') {
    if (changed(before, after, ['transportBindings', 'slotBindings', 'parameterBindings'])) {
      const key = entityKey('midi', 'project', 'bindings');
      encodedPatch(plan, entities, { uiState: { midi: { transportBindings: after.transportBindings, slotBindings: after.slotBindings, parameterBindings: after.parameterBindings } } } as Partial<ProjectFile>, [key]);
      ensureRootField(plan, entities, 'midi', reference(key));
    }
    if (before.isEnabled !== after.isEnabled) plan.views.push({ key: 'midi/isEnabled', value: domainJson(after.isEnabled) });
  } else if (domain === 'export') {
    if (changed(before, after, ['settings', 'presets', 'batch'])) {
      const key = entityKey('export', 'project', 'definitions');
      const exportState = getExportStoreData(after as unknown as Parameters<typeof getExportStoreData>[0]);
      encodedPatch(plan, entities, { uiState: { exportState: { ...exportState, presets: [] } } } as Partial<ProjectFile>, [key]);
      granularizeStructuredPlan(plan, entities, key, before, after, (_field, value) => domainJson(value));
      ensureRootField(plan, entities, 'export', reference(key));
    }
    if (before.selectedPresetId !== after.selectedPresetId) plan.views.push({ key: 'export/selectedPresetId', value: domainJson(after.selectedPresetId) });
  } else if (domain === 'storyboard') {
    const fields = ['plans', 'scenes', 'generationBriefs', 'candidates', 'evidenceRefs', 'coverageBySceneId', 'variantSets', 'variantOptions', 'decisions', 'templates'];
    if (changed(before, after, fields)) {
      const key = entityKey('storyboard', 'project', 'state');
      const storyboard = selectStoryboardProjectState(after as unknown as Parameters<typeof selectStoryboardProjectState>[0]);
      const emptyMaps = Object.fromEntries(Object.keys(STRUCTURED_FIELDS[key]).map(field => [field, {}]));
      encodedPatch(plan, entities, { storyboard: { ...storyboard, ...emptyMaps } } as Partial<ProjectFile>, [key]);
      granularizeStructuredPlan(plan, entities, key, before, after, (field, value) => {
        const split = splitNestedDomain(domainJson({ schemaVersion: 1, ...emptyMaps, [field]: { item: value } }), 'StoryboardProjectState');
        return object(object(split.content)[field]).item;
      });
      ensureRootField(plan, entities, 'storyboard', reference(key));
    }
  } else if (domain === 'seedance') {
    const state = (value: State, runs: unknown) => ({ schemaVersion: 1, documents: value.documents, runs,
      sourceBundle: value.sourceBundle, activeRunId: value.activeRunId });
    for (const [id, run] of Object.entries(object(after.runs))) {
      if (object(before.runs)[id] === run) continue;
      const key = entityKey('seedanceRun', 'project', id);
      encodedPatch(plan, entities, { seedancePreproduction: state(after, { [id]: run }) } as Partial<ProjectFile>, [key]);
    }
    for (const id of Object.keys(object(before.runs))) if (!(id in object(after.runs))) replaceAggregate(plan, entities, entityKey('seedanceRun', 'project', id), 'seedance-run', undefined);
    if (changed(before, after, ['documents', 'runs', 'sourceBundle'])) {
      const key = entityKey('seedance', 'project', 'state');
      // Only the state shell is encoded here. Runs retain their independently versioned entities.
      encodedPatch(plan, entities, { seedancePreproduction: state(after, {}) } as Partial<ProjectFile>, [key]);
      const aggregate = plan.aggregates.find(entry => entry.key === key)!;
      const root = aggregate.after.get(key)!;
      root.value = { ...root.value as Record<string, JsonValue>, runs: Object.fromEntries(Object.keys(object(after.runs)).map(id => [id, reference(entityKey('seedanceRun', 'project', id))])) };
      ensureRootField(plan, entities, 'seedancePreproduction', reference(key));
    }
    if (before.activeRunId !== after.activeRunId) plan.views.push({ key: 'seedance/activeRunId', value: domainJson(after.activeRunId) });
  } else if (domain === 'flashboard') {
    // Conversation/job state is never rolled back by content navigation.
    for (const field of ['activeGenerationRecords', 'promptHistory', 'chatMessages', 'aiWorkspaces']) {
      appendFlashBoardJournalDelta(plan, `flashboard/runtime/${field}`, before[field], after[field]);
    }
    for (const field of ['composer', 'activeAIWorkspaceId', 'selectedActiveGenerationRecordIds']) {
      if (before[field] !== after[field]) plan.views.push({ key: `flashboard/${field}`, value: domainJson(after[field]) });
    }
    if (before.aiWorkspaces !== after.aiWorkspaces) {
      const key = entityKey('flashboard', 'project', 'board');
      replaceAggregate(plan, entities, key, 'flashboard-board', { version: 1, generationMetadataByMediaId: object(entities.get(key)?.value).generationMetadataByMediaId ?? {},
        workspaces: (after.aiWorkspaces as State[]).map(workspace => ({ id: workspace.id, title: workspace.title,
          kind: workspace.kind, createdAt: new Date(workspace.createdAt as number).toISOString() })) });
      ensureRootField(plan, entities, 'flashboard', reference(key));
    }
  }
  return plan;
}
