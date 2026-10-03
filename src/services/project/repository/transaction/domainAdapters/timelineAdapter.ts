import { RepositoryError, type EntityDTO } from '../../contracts';
import type { TimelineStore } from '../../../../../stores/timeline/types';
import type { Composition } from '../../../../../stores/mediaStore/types';
import { convertCompositions, convertRuntimeProjectClip, convertProjectTrack } from '../../../projectCompositionSerialization';
import { encodeCompositionClip, encodeCompositionTrack } from '../../domains/projectDomains';
import { entityKey } from '../../domains/jsonBoundary';
import { changedItems, type DomainMutationPlan } from '../domainMutationAdapter';
import { decodeOwnedAggregate, emptyPlan, existingAggregate, membership } from './aggregatePlan';
import { encodedPatch } from './projectPatchCodec';

export interface TimelineAdapterContext { entities: ReadonlyMap<string, EntityDTO>; activeComposition: Composition | undefined; }
const CONTENT_KEYS = ['duration', 'durationLocked', 'markers', 'masterAudioState', 'sharedSceneGraphs', 'compositionGraph', 'tempoMap', 'rulerLanes', 'activeRulerLaneId', 'videoBakeRegions', 'inPoint', 'outPoint'] as const;
/** True when the project's composition list references this composition. */
function projectListsComposition(entities: ReadonlyMap<string, EntityDTO>, compositionId: string): boolean {
  const listKey = entityKey('membership', 'project', 'compositions');
  if (!entities.has(listKey)) return false;
  const target = entityKey('composition', 'project', compositionId);
  const members = decodeOwnedAggregate(listKey, entities);
  return Array.isArray(members) && members.some(member => !!member && typeof member === 'object' && !Array.isArray(member)
    && (member as { $repositoryEntity?: unknown }).$repositoryEntity === target);
}

export function prepareTimelineMutation(before: TimelineStore, patch: Partial<TimelineStore>, context: TimelineAdapterContext): DomainMutationPlan {
  const plan = emptyPlan(), owner = context.activeComposition;
  if (!owner) return plan;
  const next = { ...before, ...patch }, entities = context.entities;
  const listed = projectListsComposition(entities, owner.id);
  // A listed composition whose record or member lists are missing (dangling writes of an older
  // build) is rewritten completely, so the composition record never points at absent entities.
  const repair = listed && (!entities.has(entityKey('composition', 'project', owner.id))
    || !entities.has(entityKey('membership', owner.id, 'clips')) || !entities.has(entityKey('membership', owner.id, 'tracks')));
  const changedKeyframes = new Set<string>();
  if (before.clipKeyframes !== next.clipKeyframes) {
    for (const id of new Set([...before.clipKeyframes.keys(), ...next.clipKeyframes.keys()])) {
      if (before.clipKeyframes.get(id) !== next.clipKeyframes.get(id)) changedKeyframes.add(id);
    }
  }
  const clipChanges = changedItems(before.clips, next.clips);
  if (repair) for (const clip of next.clips) if (!clipChanges.some(change => change.id === clip.id)
    && !entities.has(entityKey('clip', owner.id, clip.id))) clipChanges.push({ id: clip.id, before: clip, after: clip });
  const changedClipIds = new Set(clipChanges.map(change => change.id));
  for (const id of changedKeyframes) if (!changedClipIds.has(id)) {
    const clip = next.clips.find(value => value.id === id);
    if (clip) clipChanges.push({ id, before: clip, after: clip });
  }
  for (const change of clipChanges) {
    const key = entityKey('clip', owner.id, change.id);
    plan.aggregates.push({ key, before: existingAggregate(entities, key), after: change.after
      ? encodeCompositionClip(owner.id, convertRuntimeProjectClip(change.after, next.clipKeyframes.get(change.id) ?? [])) : new Map() });
  }
  if (repair || (before.clips !== next.clips && (before.clips.length !== next.clips.length || before.clips.some((clip, i) => clip.id !== next.clips[i]?.id)))) {
    membership(plan, entities, 'clips', owner.id, next.clips.map(clip => clip.id), 'clip');
  }
  const trackChanges = changedItems(before.tracks, next.tracks);
  if (repair) for (const track of next.tracks) if (!trackChanges.some(change => change.id === track.id)
    && !entities.has(entityKey('track', owner.id, track.id))) trackChanges.push({ id: track.id, before: track, after: track });
  for (const change of trackChanges) {
    const key = entityKey('track', owner.id, change.id);
    plan.aggregates.push({ key, before: existingAggregate(entities, key), after: change.after
      ? encodeCompositionTrack(owner.id, convertProjectTrack(change.after)) : new Map() });
  }
  if (repair || (before.tracks !== next.tracks && (before.tracks.length !== next.tracks.length || before.tracks.some((track, i) => track.id !== next.tracks[i]?.id)))) {
    membership(plan, entities, 'tracks', owner.id, next.tracks.map(track => track.id), 'track');
  }
  if (repair || CONTENT_KEYS.some(key => before[key] !== next[key])) {
    const timelineData = {
      ...owner.timelineData, tracks: [], clips: [], duration: next.duration, durationLocked: next.durationLocked,
      markers: next.markers, masterAudioState: next.masterAudioState, sharedSceneGraphs: next.sharedSceneGraphs,
      compositionGraph: next.compositionGraph,
      tempoMap: next.tempoMap, rulerLanes: next.rulerLanes, activeRulerLaneId: next.activeRulerLaneId,
      videoBakeRegions: next.videoBakeRegions,
    } as NonNullable<Composition['timelineData']>;
    const composition = convertCompositions([{ ...owner, timelineData }])[0];
    encodedPatch(plan, entities, { compositions: [composition], uiState: { compositionViewState: { [owner.id]: { inPoint: next.inPoint, outPoint: next.outPoint } } } }, [entityKey('composition', 'project', owner.id)]);
  }
  // Never persist content of a composition outside the open project (e.g. the restore
  // placeholder 'comp-1'): that left records pointing at absent member lists.
  if (!listed && plan.aggregates.length) {
    throw new RepositoryError('ownership', `Composition "${owner.name}" is not part of the open project; the edit was not saved.`);
  }
  // Playback and view preferences never become content revisions.
  for (const key of ['playheadPosition', 'zoom', 'scrollX', 'selectedClipIds', 'selectedKeyframeIds', 'inPoint', 'outPoint'] as const) {
    if (before[key] !== next[key] && key !== 'inPoint' && key !== 'outPoint') {
      const value = next[key];
      plan.views.push({ key: `timeline/${owner.id}/${key}`, value: value instanceof Set ? [...value] : value });
    }
  }
  return plan;
}
