import type { EntityDTO } from '../../contracts';
import type { MediaState, Composition } from '../../../../../stores/mediaStore/types';
import type { ProjectFile } from '../../../types/project.types';
import { convertMediaFiles, convertFolders } from '../../../projectMediaSerialization';
import { convertCompositions } from '../../../projectCompositionSerialization';
import { encodeCompositionClip, encodeCompositionTrack } from '../../domains/projectDomains';
import { entityKey } from '../../domains/jsonBoundary';
import { signalAssetItemToProjectMetadata } from '../../../../../stores/mediaStore/helpers/signalItems';
import { changedItems, type DomainMutationPlan } from '../domainMutationAdapter';
import { assertListKnown, emptyPlan, existingAggregate, ensureRootField, membership, reference, replaceAggregate } from './aggregatePlan';
import { encodedPatch } from './projectPatchCodec';
import { granularizeStructuredPlan } from './structuredDomain';
import { splitNestedDomain } from '../../domains/nestedOwnership';
import { domainJson } from '../../domains/jsonBoundary';
import { object } from './aggregatePlan';

const signalMetadata = new WeakMap<object, ReturnType<typeof signalAssetItemToProjectMetadata>>();
function cachedSignalMetadata(item: Parameters<typeof signalAssetItemToProjectMetadata>[0]) {
  let value = signalMetadata.get(item); if (!value) { value = signalAssetItemToProjectMetadata(item); signalMetadata.set(item, value); } return value;
}
const GENERATED = ['textItems', 'solidItems', 'meshItems', 'cameraItems', 'lightItems', 'splatEffectorItems', 'mathSceneItems', 'motionShapeItems'] as const;
function compositionPlan(plan: DomainMutationPlan, entities: ReadonlyMap<string, EntityDTO>, before: Composition | null, after: Composition | null, id: string): void {
  const key = entityKey('composition', 'project', id);
  if (!after) {
    replaceAggregate(plan, entities, key, 'composition-aggregate', undefined);
    for (const clip of before?.timelineData?.clips ?? []) replaceAggregate(plan, entities, entityKey('clip', id, clip.id), 'clip-aggregate', undefined);
    for (const track of before?.timelineData?.tracks ?? []) replaceAggregate(plan, entities, entityKey('track', id, track.id), 'track-aggregate', undefined);
    replaceAggregate(plan, entities, entityKey('membership', id, 'clips'), 'domain-membership', undefined);
    replaceAggregate(plan, entities, entityKey('membership', id, 'tracks'), 'domain-membership', undefined);
    return;
  }
  const previous = before?.timelineData, next = after.timelineData;
  for (const change of changedItems(previous?.clips ?? [], next?.clips ?? [])) {
    const clipKey = entityKey('clip', id, change.id);
    const clip = change.after ? convertCompositions([{ ...after, timelineData: { ...next!, tracks: [], clips: [change.after], markers: [] } }])[0].clips[0] : null;
    plan.aggregates.push({ key: clipKey, before: existingAggregate(entities, clipKey), after: clip ? encodeCompositionClip(id, clip) : new Map() });
  }
  for (const change of changedItems(previous?.tracks ?? [], next?.tracks ?? [])) {
    const trackKey = entityKey('track', id, change.id);
    const track = change.after ? convertCompositions([{ ...after, timelineData: { ...next!, tracks: [change.after], clips: [], markers: [] } }])[0].tracks[0] : null;
    plan.aggregates.push({ key: trackKey, before: existingAggregate(entities, trackKey), after: track ? encodeCompositionTrack(id, track) : new Map() });
  }
  for (const [field, singular] of [['clips', 'clip'], ['tracks', 'track']] as const) {
    const oldItems = previous?.[field] ?? [], items = next?.[field] ?? [];
    if (!before || oldItems.length !== items.length || oldItems.some((item, index) => item.id !== items[index]?.id)) membership(plan, entities, field, id, items.map(item => item.id), singular);
  }
  const dto = convertCompositions([{ ...after, timelineData: next ? { ...next, tracks: [], clips: [] } : undefined }])[0];
  encodedPatch(plan, entities, { compositions: [dto] }, [key]);
}
export function prepareMediaMutation(before: MediaState, patch: Partial<MediaState>, entities: ReadonlyMap<string, EntityDTO>): DomainMutationPlan {
  const plan = emptyPlan(), next = { ...before, ...patch };
  for (const change of changedItems(before.files, next.files)) {
    const key = entityKey('media', 'project', change.id);
    if (change.after) encodedPatch(plan, entities, { media: convertMediaFiles([change.after]) }, [key]);
    else replaceAggregate(plan, entities, key, 'media-aggregate', undefined);
    if (change.before?.file !== change.after?.file) {
      replaceAggregate(plan, entities, `source-identity:${change.id}`, 'verified-source-identity', undefined);
      const aggregate = plan.aggregates.find(entry => entry.key === key);
      if (aggregate) aggregate.retainResultBindings = false;
    }
  }
  if (before.files !== next.files && (before.files.length !== next.files.length || before.files.some((item, i) => item.id !== next.files[i]?.id))) {
    assertListKnown(entities, entityKey('membership', 'project', 'media'), 'media', 'project', [...before.files, ...next.files].map(item => item.id));
    membership(plan, entities, 'media', 'project', next.files.map(item => item.id));
  }
  for (const change of changedItems(before.compositions, next.compositions)) compositionPlan(plan, entities, change.before, change.after, change.id);
  if (before.compositions !== next.compositions && (before.compositions.length !== next.compositions.length || before.compositions.some((item, i) => item.id !== next.compositions[i]?.id))) {
    assertListKnown(entities, entityKey('membership', 'project', 'compositions'), 'composition', 'project', [...before.compositions, ...next.compositions].map(item => item.id));
    membership(plan, entities, 'compositions', 'project', next.compositions.map(item => item.id), 'composition');
  }
  for (const field of ['folders', ...GENERATED] as const) {
    if (before[field] === next[field]) continue;
    for (const change of changedItems(before[field] as { id: string }[], next[field] as { id: string }[])) {
      const key = entityKey(field, 'project', change.id);
      if (change.after) encodedPatch(plan, entities, { [field]: field === 'folders' ? convertFolders([change.after as MediaState['folders'][number]]) : [change.after] } as Partial<ProjectFile>, [key]);
      else replaceAggregate(plan, entities, key, `${field}-aggregate`, undefined);
    }
    membership(plan, entities, field, 'project', next[field].map(item => item.id));
    ensureRootField(plan, entities, field, reference(entityKey('membership', 'project', field)));
  }
  if (['signalAssets', 'signalArtifacts', 'signalGraphs', 'signalOperators'].some(field => before[field as keyof MediaState] !== next[field as keyof MediaState])) {
    const key = entityKey('signals', 'project', 'state');
    const toState = (state: MediaState) => ({ assets: state.signalAssets.map(item => item.asset),
      assetItems: state.signalAssets.map(cachedSignalMetadata), artifacts: state.signalArtifacts,
      graphs: state.signalGraphs, operators: state.signalOperators });
    const empty = { schemaVersion: 1 as const, assets: [], assetItems: [], artifacts: [], graphs: [], operators: [] };
    encodedPatch(plan, entities, { signals: empty }, [key]);
    granularizeStructuredPlan(plan, entities, key, toState(before), toState(next), (field, value) => {
      const split = splitNestedDomain(domainJson({ ...empty, [field]: [value] }), 'ProjectSignalState');
      return (object(split.content)[field] as unknown[])[0];
    });
    ensureRootField(plan, entities, 'signals', reference(key));
  }
  for (const field of ['slotAssignments', 'slotClipSettings'] as const) {
    if (before[field] === next[field]) continue;
    const key = entityKey(field, 'project', 'state');
    encodedPatch(plan, entities, { [field]: next[field] } as Partial<ProjectFile>, [key]);
    ensureRootField(plan, entities, field, reference(key));
  }
  for (const field of ['activeCompositionId', 'openCompositionIds', 'selectedIds', 'expandedFolderIds', 'previewCompositionId', 'sourceMonitorFileId'] as const) {
    if (before[field] !== next[field]) plan.views.push({ key: `media/${field}`, value: next[field] });
  }
  return plan;
}
