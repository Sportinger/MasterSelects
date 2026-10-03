/** Import ONLY through a DEV-guarded dynamic import in editorBoot.ts. */
import { useTimelineStore } from '../stores/timeline';
import { useMediaStore } from '../stores/mediaStore';
import { cancelHistoryBatch, endBatch, startBatch, useHistoryStore } from '../stores/historyStore';
import { isHistoryDisabledForDebug } from '../stores/historyStore/historyDebug';
import { getEditorRepositorySession } from '../services/project/repository/transaction/editorMutationRuntime';
import { finishEditorGesture, hasOpenEditorGestures, runEditorGesture } from '../services/project/repository/transaction/editorGestureOwnership';
import { assertExclusiveTimelineMutationAllowed } from '../stores/timeline/exclusiveMutationLease';
import { cleanupDeletedClipResources } from '../stores/timeline/deletedClipResources';
import { buildCompositionGraph } from '../services/nodeGraph/composition/compositionGraphProjection';
import { getCompositionGraphMetrics, resetCompositionGraphMetrics } from '../services/nodeGraph/composition/compositionGraphMetrics';

export interface CompositionGraphBaselineOptions {
  mediaFileId?: string;
  /** Video/audio track pairs, default 3. Dedicated tracks avoid existing clips. */
  trackCount?: number;
  /** Full source duration by default. */
  clipDuration?: number;
  startTime?: number;
}

interface BaselineRun {
  compositionId: string;
  clipIds: Set<string>;
  trackIds: Set<string>;
}

const runtime: { busy: boolean; runs: BaselineRun[] } = import.meta.hot?.data?.compositionBaseline
  ?? { busy: false, runs: [] };

function assertReady(): string {
  if (!import.meta.env.DEV) throw new Error('Composition baseline is development-only.');
  if (runtime.busy) throw new Error('A baseline operation is already running.');
  if (useTimelineStore.getState().isExporting || useTimelineStore.getState().isPlaying) {
    throw new Error('Stop playback/export before changing the baseline.');
  }
  assertExclusiveTimelineMutationAllowed();
  if (isHistoryDisabledForDebug() || useHistoryStore.getState().batchId !== null || hasOpenEditorGestures()) {
    throw new Error('Baseline needs enabled history and no open edit gesture.');
  }
  const id = useMediaStore.getState().activeCompositionId;
  if (!id) throw new Error('Open a composition first.');
  return id;
}

/** Repository callbacks re-enter their token after each await; legacy history uses its batch. */
async function batch<T>(compositionId: string, label: string,
  action: (run: <R>(fn: () => R) => R) => Promise<T>, createdIds: () => ReadonlySet<string> = () => new Set()): Promise<T> {
  const repository = getEditorRepositorySession();
  const timelineSessionId = useTimelineStore.getState().timelineSessionId;
  const history = startBatch(label);
  if (!history.opened || history.batchId === null) throw new Error('Could not open an independent history batch.');
  const id = history.batchId;
  const isCurrent = () => getEditorRepositorySession() === repository
    && useMediaStore.getState().activeCompositionId === compositionId
    && useTimelineStore.getState().timelineSessionId === timelineSessionId;
  const run = <R>(fn: () => R): R => {
    if (!isCurrent()) throw new Error('Active project/composition changed during baseline creation.');
    return repository ? runEditorGesture(id, fn) : fn();
  };
  runtime.busy = true;
  try {
    const value = await action(run);
    run(() => undefined);
    if (repository) finishEditorGesture(id);
    endBatch();
    return value;
  } catch (error) {
    // Do not apply a legacy snapshot to a different composition/project.
    if (isCurrent()) {
      const ids = createdIds();
      run(() => cleanupDeletedClipResources(useTimelineStore.getState().clips.filter(clip => ids.has(clip.id))));
      if (repository) finishEditorGesture(id, true);
      cancelHistoryBatch();
    } else if (repository) {
      finishEditorGesture(id, true);
    }
    throw error;
  } finally {
    runtime.busy = false;
  }
}

function metrics() {
  const state = useTimelineStore.getState();
  const compositionId = useMediaStore.getState().activeCompositionId;
  const owned = new Set(runtime.runs.filter(run => run.compositionId === compositionId).flatMap(run => [...run.clipIds]));
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return {
    projection: getCompositionGraphMetrics(), compositionId, busy: runtime.busy,
    timelineClipCount: state.clips.length, trackCount: state.tracks.length,
    baselineClipCount: state.clips.filter(clip => owned.has(clip.id)).length,
    loadingClipCount: state.clips.filter(clip => clip.isLoading).length,
    waveformPendingCount: state.clips.filter(clip => clip.waveformGenerating).length,
    // Chromium-only, approximate process heap; never presented as GPU memory or playback FPS.
    heap: memory ? { usedBytes: memory.usedJSHeapSize, totalBytes: memory.totalJSHeapSize } : null,
  };
}

async function build(clipCount: number, options: CompositionGraphBaselineOptions = {}) {
  const compositionId = assertReady();
  if (![30, 300, 1000].includes(clipCount)) throw new RangeError('Choose 30, 300, or 1000 video clips (plus linked audio).');
  const { trackCount = 3, startTime = 0 } = options;
  if (!Number.isSafeInteger(trackCount) || trackCount < 1 || trackCount > 16
    || !Number.isFinite(startTime) || startTime < 0) throw new RangeError('Invalid trackCount/startTime.');
  const media = useMediaStore.getState().files.find(file =>
    (options.mediaFileId ? file.id === options.mediaFileId : true)
    && file.type === 'video' && file.hasAudio === true && file.file instanceof File
    && Number.isFinite(file.duration) && (file.duration ?? 0) > 0);
  if (!media?.file || !media.duration) throw new Error('Import a real video with confirmed audio, duration, and an available File first.');
  const sourceFile = media.file;
  const sourceDuration = media.duration;
  const pieceDuration = options.clipDuration ?? sourceDuration;
  if (!Number.isFinite(pieceDuration) || pieceDuration <= 0 || pieceDuration > sourceDuration) {
    throw new RangeError('clipDuration must be positive and no longer than the imported source.');
  }
  const runRecord: BaselineRun = { compositionId, clipIds: new Set(), trackIds: new Set() };
  const namePrefix = `Composition baseline ${crypto.randomUUID()} / `;
  const collectCreatedIds = () => {
    for (const clip of useTimelineStore.getState().clips) {
      if (!clip.name.startsWith(namePrefix)) continue;
      runRecord.clipIds.add(clip.id);
      if (clip.linkedClipId) runRecord.clipIds.add(clip.linkedClipId);
    }
    return runRecord.clipIds;
  };
  const started = performance.now();
  const before = metrics();
  let addMs = 0;
  await batch(compositionId, `Build composition baseline (${clipCount} video clips)`, async run => {
    const lanes = run(() => Array.from({ length: trackCount }, () => {
      const video = useTimelineStore.getState().addTrack('video');
      const audio = useTimelineStore.getState().addTrack('audio');
      runRecord.trackIds.add(video); runRecord.trackIds.add(audio);
      return { video, audio };
    }));
    for (let index = 0; index < clipCount; index++) {
      const lane = lanes[index % trackCount];
      const at = startTime + Math.floor(index / trackCount) * pieceDuration;
      const addStart = performance.now();
      const id = await run(() => useTimelineStore.getState().addClip(lane.video, sourceFile, at,
        pieceDuration, media.id, 'video', { linkedAudioTrackId: lane.audio, name: `${namePrefix}${index + 1}` }));
      run(() => {
        const video = useTimelineStore.getState().clips.find(clip => clip.id === id);
        const audio = useTimelineStore.getState().clips.find(clip => clip.id === video?.linkedClipId);
        if (!video || !audio || audio.linkedClipId !== video.id) throw new Error(`Clip ${index + 1} did not create a linked audio pair.`);
        runRecord.clipIds.add(video.id); runRecord.clipIds.add(audio.id);
        if (pieceDuration !== sourceDuration) {
          useTimelineStore.getState().trimClip(video.id, 0, pieceDuration);
          useTimelineStore.getState().trimClip(audio.id, 0, pieceDuration);
        }
      });
      addMs += performance.now() - addStart;
    }
  }, collectCreatedIds);
  runtime.runs.push(runRecord);
  const mutationMs = performance.now() - started;
  // Explicit probe only: do not contaminate the panel re-projection counter.
  const state = useTimelineStore.getState();
  const probeStart = performance.now();
  const graph = buildCompositionGraph({ compositionId, compositionName: 'Baseline', clips: state.clips,
    tracks: state.tracks, state: state.compositionGraph,
    media: new Map([[media.id, { id: media.id, name: media.name, duration: sourceDuration, kind: 'video' }]]) });
  return { requestedVideoClips: clipCount, createdTimelineClips: runRecord.clipIds.size,
    createdTrackIds: [...runRecord.trackIds], createdClipIds: [...runRecord.clipIds],
    timings: { addMs, mutationMs, projectionProbeMs: performance.now() - probeStart, totalMs: performance.now() - started },
    projectionProbe: { nodes: graph.nodes.length, edges: graph.edges.length }, before, after: metrics() };
}

async function clear() {
  const compositionId = assertReady();
  const runs = runtime.runs.filter(run => run.compositionId === compositionId);
  const ids = new Set(runs.flatMap(run => [...run.clipIds]));
  const trackIds = new Set(runs.flatMap(run => [...run.trackIds]));
  const state = useTimelineStore.getState();
  const present = state.clips.filter(clip => ids.has(clip.id));
  const locked = new Set(state.tracks.filter(track => track.locked).map(track => track.id));
  if (present.some(clip => locked.has(clip.trackId))) throw new Error('Unlock the baseline clips before clearing.');
  const started = performance.now();
  if (present.length || state.tracks.some(track => trackIds.has(track.id) && !track.locked)) {
    await batch(compositionId, 'Clear composition baseline', async run => {
      run(() => {
        if (present.length) {
          const result = useTimelineStore.getState().applyTimelineEditOperation({
            id: 'composition-baseline-clear', type: 'delete-clips', clipIds: present.map(clip => clip.id), includeLinked: false,
          }, { source: 'ui', historyLabel: 'Clear composition baseline' });
          if (!result.success || useTimelineStore.getState().clips.some(clip => ids.has(clip.id))) {
            throw new Error(`Could not clear all baseline clips: ${result.warnings.map(warning => warning.message).join('; ')}`);
          }
        }
        for (const trackId of trackIds) {
          const current = useTimelineStore.getState();
          if (current.tracks.some(track => track.id === trackId && !track.locked)
            && !current.clips.some(clip => clip.trackId === trackId)) current.removeTrack(trackId);
        }
      });
    });
  }
  // Retain identities: undoing clear then clearing again must still find exactly our clips.
  return { removedTimelineClips: present.length, elapsedMs: performance.now() - started, after: metrics() };
}

export function registerCompositionGraphBaselineHook(): void {
  if (!import.meta.env.DEV || typeof window === 'undefined') return;
  window.__MS_COMPOSITION_BASELINE__ = { build, clear, metrics,
    reset: () => { resetCompositionGraphMetrics(); return metrics(); } };
}

declare global {
  interface Window {
    __MS_COMPOSITION_BASELINE__?: {
      build: typeof build; clear: typeof clear; metrics: typeof metrics; reset: () => ReturnType<typeof metrics>;
    };
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(data => { data.compositionBaseline = runtime; });
  import.meta.hot.accept(module => module?.registerCompositionGraphBaselineHook());
}
