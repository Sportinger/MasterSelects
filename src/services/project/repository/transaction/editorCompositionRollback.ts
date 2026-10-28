import type { Composition, MediaState } from '../../../../stores/mediaStore/types';
import type { TimelineStore } from '../../../../stores/timeline/types';
import { projectTimelineMutationToComposition } from './editorCompositionProjection';
import { revertFieldWrite } from './editorRollbackMerge';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { Logger } from '../../../logger';

const log = Logger.create('EditorRollback');

type CompositionProjection = Pick<Composition, 'timelineData' | 'duration'>;
/**
 * One uninterrupted run of a transaction's projections of a composition's timeline (its `timelineData` and
 * duration): the value before the run's first projection and after its latest one. While that composition is
 * visible, a cancel restores its timeline store and projects it again; once another composition replaced the
 * store, the projection is the only runtime copy of the edit, and the cancel restores it from these segments.
 */
export interface CompositionProjectionSegment { before: CompositionProjection; after: CompositionProjection; }
/**
 * Per composition, the transaction's segments in order. A projection continues the last segment only when
 * nobody projected that composition since (its value is still the segment's `after`). When another transaction
 * committed a write in between, a new segment starts: a cancel then takes back each segment on its own, per
 * clip and field, and keeps the other transaction's committed edit instead of restoring the whole timeline.
 */
export type CompositionProjectionRecords = Map<string, CompositionProjectionSegment[]>;

const mediaState = () => getRepositoryStore('media')?.getState() as MediaState | undefined;
const activeComposition = (media: MediaState | undefined) => media?.compositions.find(comp => comp.id === media.activeCompositionId);
const projectionOf = (comp: Composition): CompositionProjection => ({ timelineData: comp.timelineData, duration: comp.duration });

/** projectTimelineMutationToComposition that also records the projection for a later cancel. */
export function projectTimelineMutationForTransaction(records: CompositionProjectionRecords | undefined, before: TimelineStore, next: TimelineStore): void {
  const prior = activeComposition(mediaState());
  projectTimelineMutationToComposition(before, next);
  const after = prior && mediaState()?.compositions.find(comp => comp.id === prior.id);
  if (!records || !prior || !after) return;
  const segments = records.get(prior.id) ?? [];
  const last = segments.at(-1);
  if (last && last.after.timelineData === prior.timelineData && last.after.duration === prior.duration) last.after = projectionOf(after);
  else segments.push({ before: projectionOf(prior), after: projectionOf(after) });
  records.set(prior.id, segments);
}

/**
 * Takes one segment back from the composition's current projection. A value nobody changed since returns as a
 * whole; otherwise every timeline field the segment changed is reverted per item (clips, tracks, markers by id),
 * so what other transactions changed meanwhile stays.
 */
function revertSegment(compId: string, current: CompositionProjection, segment: CompositionProjectionSegment): CompositionProjection {
  const { before, after } = segment;
  const duration = Object.is(current.duration, after.duration) ? before.duration : current.duration;
  if (current.timelineData === after.timelineData) return { timelineData: before.timelineData, duration };
  if (!current.timelineData || !before.timelineData || !after.timelineData) {
    log.warn(`Cancel keeps the saved view of composition ${compId}: it was replaced after the cancelled edit`);
    return current;
  }
  const now = current.timelineData as unknown as Record<string, unknown>;
  const was = before.timelineData as unknown as Record<string, unknown>, wrote = after.timelineData as unknown as Record<string, unknown>;
  const timelineData: Record<string, unknown> = { ...now };
  for (const key of new Set([...Object.keys(was), ...Object.keys(wrote)])) {
    if (Object.is(was[key], wrote[key])) continue;
    timelineData[key] = revertFieldWrite(now[key], was[key], wrote[key], `composition ${compId} ${key}`);
  }
  return { timelineData: timelineData as unknown as Composition['timelineData'], duration };
}

/**
 * Restores the projection of every composition the cancelled transaction edited that is no longer visible,
 * taking its segments back newest first. Returns the restored composition ids.
 */
export function restoreOffscreenCompositionProjections(records: CompositionProjectionRecords | undefined): string[] {
  const store = getRepositoryStore('media'), media = mediaState();
  if (!records?.size || !store || !media) return [];
  const restored: string[] = [];
  const compositions = media.compositions.map(comp => {
    const segments = records.get(comp.id);
    if (!segments?.length || comp.id === media.activeCompositionId) return comp;
    restored.push(comp.id);
    const value = segments.toReversed().reduce((current, segment) => revertSegment(comp.id, current, segment), projectionOf(comp));
    return { ...comp, ...value };
  });
  if (restored.length) withRepositoryHydration(() => store.setState({ compositions }));
  return restored;
}
