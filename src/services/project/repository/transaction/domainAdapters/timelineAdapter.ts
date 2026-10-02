import type { EntityDTO } from '../../contracts';
import type { TimelineStore } from '../../../../../stores/timeline/types';
import type { Composition } from '../../../../../stores/mediaStore/types';
import { convertCompositions, convertRuntimeProjectClip, convertProjectTrack } from '../../../projectCompositionSerialization';
import { encodeCompositionClip, encodeCompositionTrack } from '../../domains/projectDomains';
import { entityKey } from '../../domains/jsonBoundary';
import { changedItems, type DomainMutationPlan } from '../domainMutationAdapter';
import { emptyPlan, existingAggregate, membership } from './aggregatePlan';
import { encodedPatch } from './projectPatchCodec';

export interface TimelineAdapterContext { entities: ReadonlyMap<string, EntityDTO>; activeComposition: Composition | undefined; }
const CONTENT_KEYS = ['duration', 'durationLocked', 'markers', 'masterAudioState', 'sharedSceneGraphs', 'tempoMap', 'rulerLanes', 'activeRulerLaneId', 'videoBakeRegions', 'inPoint', 'outPoint'] as const;
export function prepareTimelineMutation(before: TimelineStore, patch: Partial<TimelineStore>, context: TimelineAdapterContext): DomainMutationPlan {
  const plan = emptyPlan(), owner = context.activeComposition;
  if (!owner) return plan;
  const next = { ...before, ...patch }, entities = context.entities;
  const changedKeyframes = new Set<string>();
  if (before.clipKeyframes !== next.clipKeyframes) {
    for (const id of new Set([...before.clipKeyframes.keys(), ...next.clipKeyframes.keys()])) {
      if (before.clipKeyframes.get(id) !== next.clipKeyframes.get(id)) changedKeyframes.add(id);
    }
  }
  const clipChanges = changedItems(before.clips, next.clips);
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
  if (before.clips !== next.clips && (before.clips.length !== next.clips.length || before.clips.some((clip, i) => clip.id !== next.clips[i]?.id))) {
    membership(plan, entities, 'clips', owner.id, next.clips.map(clip => clip.id), 'clip');
  }
  for (const change of changedItems(before.tracks, next.tracks)) {
    const key = entityKey('track', owner.id, change.id);
    plan.aggregates.push({ key, before: existingAggregate(entities, key), after: change.after
      ? encodeCompositionTrack(owner.id, convertProjectTrack(change.after)) : new Map() });
  }
  if (before.tracks !== next.tracks && (before.tracks.length !== next.tracks.length || before.tracks.some((track, i) => track.id !== next.tracks[i]?.id))) {
    membership(plan, entities, 'tracks', owner.id, next.tracks.map(track => track.id), 'track');
  }
  if (CONTENT_KEYS.some(key => before[key] !== next[key])) {
    const timelineData = {
      ...owner.timelineData, tracks: [], clips: [], duration: next.duration, durationLocked: next.durationLocked,
      markers: next.markers, masterAudioState: next.masterAudioState, sharedSceneGraphs: next.sharedSceneGraphs,
      tempoMap: next.tempoMap, rulerLanes: next.rulerLanes, activeRulerLaneId: next.activeRulerLaneId,
      videoBakeRegions: next.videoBakeRegions,
    } as NonNullable<Composition['timelineData']>;
    const composition = convertCompositions([{ ...owner, timelineData }])[0];
    encodedPatch(plan, entities, { compositions: [composition], uiState: { compositionViewState: { [owner.id]: { inPoint: next.inPoint, outPoint: next.outPoint } } } }, [entityKey('composition', 'project', owner.id)]);
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
