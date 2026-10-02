import type { ProjectFile } from '../../types/project.types';
import type { MediaState } from '../../../../stores/mediaStore/types';
import type { RepositorySession } from '../RepositorySession';
import { convertProjectMediaToStore } from '../../load/loadMediaHydration';
import { updateTimelineClips } from '../../../../stores/mediaStore/slices/fileManage/timelineClipReload';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { getEditorRepositorySession } from './editorMutationRuntime';
import { Logger } from '../../../logger';
import { restoreLinkedTimelineMedia } from './restoreLinkedTimelineMedia';
import { prioritizeLinkedMedia } from './linkedMediaPriority';
import type { TimelineStore } from '../../../../stores/timeline/types';
import type { MediaFile } from '../../../../stores/mediaStore/types';
import { deferLinkedMedia, finishLinkedMediaDemand, requestLinkedMedia, isLinkedMediaDeferred } from '../../linkedMediaDemand';
import { selectDemandedLinkedMedia } from './linkedMediaDemandSelection';
import { playheadState } from '../../../layerBuilder/PlayheadState';
import { entityKey } from '../domains/jsonBoundary';
import { decodeOwnedAggregate, object } from './domainAdapters/aggregatePlan';

type ProjectMedia = ProjectFile['media'][number];
const log = Logger.create('LinkedMediaConnection');
/** Limit actual source opens; unopened library entries do not occupy a connection slot. */
const CONNECTION_CONCURRENCY = 4;
interface MediaConnectionJob { session: RepositorySession; items: ProjectMedia[]; }
let scheduled: MediaConnectionJob | null = null;
let running = 0;
let stopDemand: (() => void) | undefined;
let demandJob: MediaConnectionJob | null = null;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
/** True while offline media are being connected; the reconnect overlay waits for it. */
export function isLinkedMediaConnectionRunning(): boolean { return running > 0 || scheduled !== null; }
export function subscribeLinkedMediaConnection(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); }

/**
 * Linked media (e.g. from converted old projects) stay in their folders. Opening never waits for
 * hundreds of file probes: saved sources are assumed present and opened only when consumed.
 */
export function scheduleLinkedMediaConnection(session: RepositorySession | null, items: readonly ProjectMedia[], startNow: boolean): void {
  stopDemand?.(); stopDemand = undefined;
  deferLinkedMedia(items.map(item => item.id), createDemandOpener(session, items));
  if (!session || !items.length) { scheduled = null; demandJob = null; notify(); return; }
  scheduled = { session, items: [...items] }; notify();
  demandJob = scheduled;
  if (startNow) startScheduledLinkedMediaConnection();
}

/** Called once the open has finished, so the background status does not fight the load overlay. */
export function startScheduledLinkedMediaConnection(): void {
  const job = scheduled; scheduled = null;
  if (!job || getEditorRepositorySession() !== job.session) { notify(); return; }
  stopDemand = observeDemand(job.session);
  notify();
}

/** Export consumes the complete active composition, so await its deferred sources first. */
export async function prepareTimelineLinkedMedia(): Promise<void> {
  const timeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
  if (!timeline) return;
  const ids = selectDemandedLinkedMedia(timeline.clips, timeline.playheadPosition, true);
  const results = await Promise.all([...ids].filter(isLinkedMediaDeferred).map(requestLinkedMedia));
  if (results.some(result => !result)) {
    throw new Error('A media source required by this composition is unavailable. Relink it before exporting.');
  }
}
export async function withTimelineLinkedMedia<Args, Result>(run: (args: Args) => Promise<Result>, args: Args): Promise<Result> {
  await prepareTimelineLinkedMedia();
  return run(args);
}

function createDemandOpener(session: RepositorySession | null, items: readonly ProjectMedia[]) {
  const sources = new Map(items.map(item => [item.id, item]));
  const inflight = new Map<string, Promise<boolean>>();
  let active = 0; const waiters: Array<() => void> = [];
  return (id: string): Promise<boolean> => {
    const previous = inflight.get(id); if (previous) return previous;
    const item = sources.get(id); if (!session || !item) return Promise.resolve(false);
    const current = () => getEditorRepositorySession() === session;
    const run = (async () => {
      if (active >= CONNECTION_CONCURRENCY) await new Promise<void>(resolve => waiters.push(resolve)); else active++;
      try {
        if (!current()) return false;
        const batch: MediaFile[] = [];
        const connected = await connect(item, current, file => batch.push(file), true);
        if (!current()) return false;
        finishLinkedMediaDemand(id);
        if (connected) await applyConnectedMedia(batch); else markMissingLinkedMedia(id);
        return connected;
      } catch (error) {
        if (current()) { finishLinkedMediaDemand(id); markMissingLinkedMedia(id); }
        log.warn('Saved media location unavailable', { id, error }); return false;
      } finally { const resume = waiters.shift(); if (resume) resume(); else active--; }
    })();
    inflight.set(id, run); return run;
  };
}
function observeDemand(session: RepositorySession): () => void {
  type Subscribable = { subscribe(listener: () => void): () => void };
  const timelineStore = getRepositoryStore('timeline'), mediaStore = getRepositoryStore('media');
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    if (getEditorRepositorySession() !== session) return;
    const timeline = timelineStore?.getState() as TimelineStore | undefined;
    const media = mediaStore?.getState() as MediaState | undefined;
    if (!timeline || !media) return;
    const time = playheadState.isUsingInternalPosition ? playheadState.position : timeline.playheadPosition;
    const ids = selectDemandedLinkedMedia(timeline.clips, time, timeline.isExporting,
      media.compositions.find(comp => comp.id === media.activeCompositionId)?.multicam);
    for (const id of media.selectedIds) ids.add(id);
    if (media.sourceMonitorFileId) ids.add(media.sourceMonitorFileId);
    for (const id of ids) void requestLinkedMedia(id);
    if (timer) clearTimeout(timer);
    if (timeline.isPlaying) timer = setTimeout(update, 500);
  };
  const unsubscribeTimeline = (timelineStore as unknown as Subscribable | undefined)?.subscribe?.(update);
  const unsubscribeMedia = (mediaStore as unknown as Subscribable | undefined)?.subscribe?.(update);
  update();
  return () => { unsubscribeTimeline?.(); unsubscribeMedia?.(); if (timer) clearTimeout(timer); };
}
function markMissingLinkedMedia(id: string): void {
  const mediaStore = getRepositoryStore('media'), timelineStore = getRepositoryStore('timeline');
  withRepositoryHydration(() => {
    if (mediaStore) mediaStore.setState({ files: [...(mediaStore.getState() as MediaState).files] });
    if (timelineStore) {
      const mark = (clips: TimelineStore['clips']): TimelineStore['clips'] => clips.map(clip => ({ ...clip,
        ...(clip.source?.mediaFileId === id ? { needsReload: true, isLoading: false } : {}),
        ...(clip.nestedClips ? { nestedClips: mark(clip.nestedClips) } : {}),
      }));
      timelineStore.setState({ clips: mark((timelineStore.getState() as TimelineStore).clips) });
    }
  });
}

type ConnectionProgress = (done: number, total: number, online: number, finished: boolean) => void;
/** Reconnect offline media from stored locations after folder access was granted; runtime only, nothing is saved. */
export async function connectOfflineLinkedMedia(onProgress: (done: number, total: number) => void): Promise<number> {
  const session = getEditorRepositorySession(); const mediaStore = getRepositoryStore('media');
  if (!session || !mediaStore) return 0;
  const offline = new Set((mediaStore.getState() as MediaState).files.filter(file => !file.file && !isLinkedMediaDeferred(file.id)).map(file => file.id));
  // Loaded lazily: the lifecycle module also starts scheduled connections.
  const { readEditorRepositoryProject } = await import('../lifecycle/editorRepositoryLifecycle');
  const items = (readEditorRepositoryProject()?.media ?? []).filter(item => offline.has(item.id));
  return connectAll(session, items, (done, total) => onProgress(done, total));
}
async function connectAll(session: RepositorySession, items: readonly ProjectMedia[], progress: ConnectionProgress): Promise<number> {
  const timeline = getRepositoryStore('timeline')?.getState() as TimelineStore | undefined;
  if (timeline) items = prioritizeLinkedMedia(items, timeline.clips, timeline.playheadPosition);
  const current = () => getEditorRepositorySession() === session;
  const total = items.length; let next = 0, done = 0, online = 0, reported = 0;
  const pending: MediaFile[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const batch = pending.splice(0);
    if (current()) await applyConnectedMedia(batch);
  };
  if (!total) return 0;
  const report = (force = false) => {
    if (!force && performance.now() - reported < 200) return;
    reported = performance.now(); progress(done, total, online, false);
  };
  running++; notify(); report(true);
  try {
    await Promise.all(Array.from({ length: Math.min(CONNECTION_CONCURRENCY, total) }, async () => {
      while (next < total && current()) {
        const item = items[next++];
        try { if (await connect(item, current, hydrated => pending.push(hydrated))) online++; }
        catch (error) { log.warn('Could not connect linked media', { id: item.id, name: item.name, error }); }
        done++;
        // Publish the first sources promptly, then avoid hundreds of full media-list renders.
        if (done <= CONNECTION_CONCURRENCY || pending.length >= 16) await flush();
        report();
      }
    }));
    await flush();
    if (current()) progress(done, total, online, true);
    return online;
  } finally { running--; notify(); }
}

async function connect(item: ProjectMedia, current: () => boolean, stage: (file: MediaFile) => void, trustSavedLocation = false): Promise<boolean> {
  const mediaStore = getRepositoryStore('media'); if (!mediaStore) return false;
  const existing = (mediaStore.getState() as MediaState).files.find(file => file.id === item.id);
  if (!existing) return false;
  if (existing.file) return true;
  // Automatic access trusts the exact saved location; explicit reconnects validate the replacement.
  const session = getEditorRepositorySession();
  const projection = session?.coordinator?.getProjection();
  const key = entityKey('media', 'project', item.id);
  const authored = projection?.entities.has(key) ? object(decodeOwnedAggregate(key, projection.entities)) : {};
  const identity = object(authored.$sourceIdentity ?? projection?.entities.get(`source-identity:${item.id}`)?.value);
  if (session && identity.identityStatus === 'verified' && typeof identity.contentHash === 'string' && typeof identity.byteLength === 'number') {
    const blob = await session.client.readBlob({ hash: identity.contentHash, length: identity.byteLength });
    if (blob && blob.size === identity.byteLength && current()) {
      const file = new File([blob], item.name, { type: blob.type });
      stage({ ...existing, file, url: URL.createObjectURL(file) }); return true;
    }
  }
  const [hydrated] = await convertProjectMediaToStore([item], { hydrateFiles: true, deferCacheChecks: true, trustSavedLocation });
  if (!hydrated?.file || !current()) return false;
  stage(hydrated);
  return true;
}

async function applyConnectedMedia(batch: MediaFile[]): Promise<void> {
  if (!batch.length) return;
  for (const file of batch) finishLinkedMediaDemand(file.id);
  const mediaStore = getRepositoryStore('media'); if (!mediaStore) return;
  const connected = new Map(batch.map(file => [file.id, file]));
  withRepositoryHydration(() => mediaStore.setState({ files: (mediaStore.getState() as MediaState).files.map(entry => {
    const hydrated = connected.get(entry.id);
    return hydrated && !entry.file ? { ...entry, file: hydrated.file, url: hydrated.url,
      hasFileHandle: hydrated.hasFileHandle, thumbnailUrl: entry.thumbnailUrl ?? hydrated.thumbnailUrl } : entry;
  }) }));
  for (const hydrated of batch) {
    const file = hydrated.file;
    if (!file) continue;
    // Runtime rebinding only; no authored clip or media fields change.
    if (hydrated.type === 'video' || hydrated.type === 'audio' || hydrated.type === 'image') {
      restoreLinkedTimelineMedia(hydrated.id, file, hydrated.url, hydrated);
    } else {
      await updateTimelineClips(hydrated.id, file, { invalidateCaches: false, generateThumbnails: false });
    }
  }
}
if (import.meta.hot) {
  import.meta.hot.dispose(data => { stopDemand?.(); data.linkedMediaDemandJob = demandJob; });
  const previous = import.meta.hot.data?.linkedMediaDemandJob as MediaConnectionJob | undefined;
  if (previous) queueMicrotask(() => scheduleLinkedMediaConnection(previous.session, previous.items, true));
}
