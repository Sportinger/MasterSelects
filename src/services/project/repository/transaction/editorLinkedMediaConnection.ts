import { createRenderablePrimaryMediaObjectUrl, resolveCurrentPrimaryMediaObjectUrl } from '../../mediaObjectUrlManager';
import type { ProjectFile } from '../../types/project.types';
import type { MediaState } from '../../../../stores/mediaStore/types';
import type { RepositorySession } from '../RepositorySession';
import { convertProjectMediaToStore } from '../../load/loadMediaHydration';
import { updateTimelineClips } from '../../../../stores/mediaStore/slices/fileManage/timelineClipReload';
import { getRepositoryStore, withRepositoryHydration } from './storeMutationBoundary';
import { getEditorRepositorySession, withSourceIdentitiesPaused } from './editorMutationRuntime';
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
import { isMediaAccessPaused } from '../../folderAccess/folderAccessPause';

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
  const wanted = [...ids].filter(isLinkedMediaDeferred);
  const results = await Promise.all(wanted.map(requestLinkedMedia));
  if (wanted.some(isMediaAccessPaused)) {
    throw new Error('Folder access was paused by the browser. Click Re-allow in the toolbar, then export again.');
  }
  if (results.some(result => !result)) {
    throw new Error('A media source required by this composition is unavailable. Relink it before exporting.');
  }
}
export async function withTimelineLinkedMedia<Args, Result>(run: (args: Args) => Promise<Result>, args: Args): Promise<Result> {
  await prepareTimelineLinkedMedia();
  // Linked proxies (e.g. 1080p copies of 4K MXF) speed up playback only; exports use the originals.
  const { withOriginalMediaSources } = await import('../../linkedMediaSources');
  return withOriginalMediaSources(() => run(args));
}

function createDemandOpener(session: RepositorySession | null, items: readonly ProjectMedia[]) {
  const sources = new Map(items.map(item => [item.id, item]));
  const inflight = new Map<string, Promise<boolean>>();
  let active = 0; const waiters: Array<() => void> = [];
  return (id: string): Promise<boolean> => {
    const previous = inflight.get(id); if (previous) return previous;
    const item = sources.get(id); if (!session || !item) return Promise.resolve(false);
    // Waiting for Re-allow: no new probe on every playhead or selection change.
    if (isMediaAccessPaused(id)) return Promise.resolve(false);
    const current = () => getEditorRepositorySession() === session;
    const run = (async () => {
      if (active >= CONNECTION_CONCURRENCY) await new Promise<void>(resolve => waiters.push(resolve)); else active++;
      try {
        if (!current()) return false;
        const batch: MediaFile[] = [];
        const connected = await connect(session, item, current, file => batch.push(file), true);
        if (!current()) return false;
        // Access paused by the browser is not a missing file: the media stays unopened until Re-allow.
        if (!connected && await pauseMediaIfAccessLapsed(item, sessionProjectFolder(session))) return false;
        finishLinkedMediaDemand(id);
        if (connected) await applyConnectedMedia(batch); else markMissingLinkedMedia([id]);
        return connected;
      } catch (error) {
        if (current() && await pauseMediaIfAccessLapsed(item, sessionProjectFolder(session)).catch(() => false)) return false;
        if (current()) { finishLinkedMediaDemand(id); markMissingLinkedMedia([id]); }
        log.warn('Saved media location unavailable', { id, error }); return false;
      } finally { const resume = waiters.shift(); if (resume) resume(); else active--; }
    })();
    // A settled open is not cached: paused media are opened again after Re-allow.
    inflight.set(id, run); void run.finally(() => { if (inflight.get(id) === run) inflight.delete(id); }); return run;
  };
}
function observeDemand(session: RepositorySession): () => void {
  type Subscribable = { subscribe(listener: () => void): () => void };
  const timelineStore = getRepositoryStore('timeline'), mediaStore = getRepositoryStore('media');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let checkedComposition: { id: string | null | undefined } | null = null;
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
    if (!checkedComposition || checkedComposition.id !== media.activeCompositionId) {
      checkedComposition = { id: media.activeCompositionId };
      void checkCompositionSources(session, timeline, media);
    }
    if (timer) clearTimeout(timer);
    if (timeline.isPlaying) timer = setTimeout(update, 500);
  };
  const unsubscribeTimeline = (timelineStore as unknown as Subscribable | undefined)?.subscribe?.(update);
  const unsubscribeMedia = (mediaStore as unknown as Subscribable | undefined)?.subscribe?.(update);
  update();
  return () => { unsubscribeTimeline?.(); unsubscribeMedia?.(); if (timer) clearTimeout(timer); };
}
/**
 * After the sources at the playhead, every source of the opened composition (nested clips and multicam
 * angles included) is opened in the background. Missing media then surface together, and the reconnect
 * dialog waits for the check instead of reappearing for a few files at a time during playback.
 */
async function checkCompositionSources(session: RepositorySession, timeline: TimelineStore, media: MediaState): Promise<void> {
  const multicam = media.compositions.find(comp => comp.id === media.activeCompositionId)?.multicam;
  const ids = [...selectDemandedLinkedMedia(timeline.clips, 0, true, multicam)].filter(isLinkedMediaDeferred);
  const current = () => getEditorRepositorySession() === session;
  if (!ids.length || !current()) return;
  running++; notify();
  try {
    const { readEditorRepositoryProject } = await import('../lifecycle/editorRepositoryLifecycle');
    const wanted = new Set(ids);
    const items = (readEditorRepositoryProject()?.media ?? []).filter(item => wanted.has(item.id));
    // Found sources publish in batches and the rest go offline together: one store update per file
    // re-rendered the whole editor hundreds of times and made the check crawl.
    await withSourceIdentitiesPaused(() => connectAll(session, items, () => {}, true));
    if (!current()) return;
    const files = (getRepositoryStore('media')?.getState() as MediaState | undefined)?.files ?? [];
    const unopened = items.filter(item => isLinkedMediaDeferred(item.id) && !files.find(file => file.id === item.id)?.file);
    const missing: string[] = [];
    for (const item of unopened) if (!await pauseMediaIfAccessLapsed(item, sessionProjectFolder(session))) missing.push(item.id);
    if (!current()) return;
    for (const id of missing) finishLinkedMediaDemand(id);
    markMissingLinkedMedia(missing);
    if (missing.length) log.info('Composition sources checked', { checked: items.length, missing: missing.length });
  } finally { running--; notify(); }
}
function sessionProjectFolder(session: RepositorySession): FileSystemDirectoryHandle | null {
  const location = session.location as RepositorySession['location'] | undefined;
  return location?.kind === 'fsa' ? location.handle : null;
}
// Loaded on use: the access checks reach the project services, which this hot path must not load eagerly.
async function pauseMediaIfAccessLapsed(item: ProjectMedia, projectFolder: FileSystemDirectoryHandle | null): Promise<boolean> {
  return (await import('../../folderAccess/mediaLocationAccess')).pauseMediaIfAccessLapsed(item, projectFolder);
}
function markMissingLinkedMedia(ids: readonly string[]): void {
  if (!ids.length) return;
  const missing = new Set(ids);
  const mediaStore = getRepositoryStore('media'), timelineStore = getRepositoryStore('timeline');
  withRepositoryHydration(() => {
    if (mediaStore) mediaStore.setState({ files: [...(mediaStore.getState() as MediaState).files] });
    if (timelineStore) {
      const mark = (clips: TimelineStore['clips']): TimelineStore['clips'] => clips.map(clip => ({ ...clip,
        ...(clip.source?.mediaFileId && missing.has(clip.source.mediaFileId) ? { needsReload: true, isLoading: false } : {}),
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
async function connectAll(session: RepositorySession, items: readonly ProjectMedia[], progress: ConnectionProgress, trustSavedLocation = false): Promise<number> {
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
        try { if (await connect(session, item, current, hydrated => pending.push(hydrated), trustSavedLocation)) online++; }
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

/**
 * One open per media at a time: the playhead demand and the composition check both open the same
 * source on reopen. Two opens created two primary object URLs; the second revoked the first while
 * the store and the media elements kept it (ERR_FILE_NOT_FOUND on every element load).
 */
const openingBySession = new WeakMap<RepositorySession, Map<string, Promise<MediaFile | 'open' | null>>>();

/**
 * Scoped per repository session: a run returns null once its session is replaced, so a reopened
 * project joining the old session's open would see existing media as missing.
 */
async function connect(session: RepositorySession, item: ProjectMedia, current: () => boolean, stage: (file: MediaFile) => void, trustSavedLocation = false): Promise<boolean> {
  let opening = openingBySession.get(session);
  if (!opening) { opening = new Map(); openingBySession.set(session, opening); }
  let run = opening.get(item.id);
  if (!run) {
    const started = openLinkedMedia(item, current, trustSavedLocation);
    const runs = opening;
    run = started;
    runs.set(item.id, started);
    void started.then(() => undefined, () => undefined).finally(() => { if (runs.get(item.id) === started) runs.delete(item.id); });
  }
  const opened = await run;
  if (opened === 'open') return true;
  if (!opened || !current()) return false;
  stage(opened);
  return true;
}

function readMediaEntry(id: string): MediaFile | undefined {
  return (getRepositoryStore('media')?.getState() as MediaState | undefined)?.files.find(file => file.id === id);
}

async function openLinkedMedia(item: ProjectMedia, current: () => boolean, trustSavedLocation: boolean): Promise<MediaFile | 'open' | null> {
  const existing = readMediaEntry(item.id);
  if (!existing) return null;
  if (existing.file) return 'open';
  // Automatic access trusts the exact saved location; explicit reconnects validate the replacement.
  const session = getEditorRepositorySession();
  const projection = session?.coordinator?.getProjection();
  const key = entityKey('media', 'project', item.id);
  const authored = projection?.entities.has(key) ? object(decodeOwnedAggregate(key, projection.entities)) : {};
  const identity = object(authored.$sourceIdentity ?? projection?.entities.get(`source-identity:${item.id}`)?.value);
  if (session && identity.identityStatus === 'verified' && typeof identity.contentHash === 'string' && typeof identity.byteLength === 'number') {
    const blob = await session.client.readBlob({ hash: identity.contentHash, length: identity.byteLength });
    if (blob && blob.size === identity.byteLength && current()) {
      // Another path may have opened it meanwhile; a new primary URL would revoke the one in use.
      if (readMediaEntry(item.id)?.file) return 'open';
      const file = new File([blob], item.name, { type: blob.type });
      const url = await createRenderablePrimaryMediaObjectUrl(item.id, file);
      if (!current()) return null;
      noteMediaOpened(item);
      return { ...existing, file, url };
    }
  }
  if (readMediaEntry(item.id)?.file) return 'open';
  const [hydrated] = await convertProjectMediaToStore([item], { hydrateFiles: true, deferCacheChecks: true, trustSavedLocation });
  if (!hydrated?.file || !current()) return null;
  noteMediaOpened(item);
  return hydrated;
}
/** Locations that opened prove folder access; a later lapse on them pauses instead of going offline. */
function noteMediaOpened(item: ProjectMedia): void {
  void import('../../folderAccess/mediaLocationAccess').then(access => access.rememberMediaLocationAccess(item))
    .catch(error => log.debug('Could not remember media access', { id: item.id, error }));
}

async function applyConnectedMedia(batch: MediaFile[]): Promise<void> {
  if (!batch.length) return;
  for (const file of batch) finishLinkedMediaDemand(file.id);
  const mediaStore = getRepositoryStore('media'); if (!mediaStore) return;
  const connected = new Map(batch.map(file => [file.id, file]));
  withRepositoryHydration(() => mediaStore.setState({ files: (mediaStore.getState() as MediaState).files.map(entry => {
    const hydrated = connected.get(entry.id);
    if (!hydrated) return entry;
    if (!entry.file) {
      return { ...entry, file: hydrated.file, url: hydrated.url,
        hasFileHandle: hydrated.hasFileHandle, thumbnailUrl: entry.thumbnailUrl ?? hydrated.thumbnailUrl };
    }
    // Already open: keep it, unless this open replaced (revoked) the primary URL the entry still holds.
    const currentUrl = entry.url && resolveCurrentPrimaryMediaObjectUrl(entry.id, entry.url);
    return entry.url && currentUrl !== entry.url && hydrated.url && currentUrl === hydrated.url
      ? { ...entry, url: hydrated.url } : entry;
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
