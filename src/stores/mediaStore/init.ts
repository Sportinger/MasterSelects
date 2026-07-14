// MediaStore initialization and auto-save
// NOTE: This module is imported by index.ts for side effects
// We use a lazy getter to avoid circular dependencies

import { useTimelineStore } from '../timeline';
import { fileSystemService } from '../../services/fileSystemService';
import { isProjectStoreSyncInProgress } from '../../services/project/projectSave';
import type { Composition, MediaFile, MediaState } from './types';
import type { CompositionTimelineData } from '../../types';
import { Logger } from '../../services/logger';
import { audioManager } from '../../services/audioManager';
import { audioRoutingManager } from '../../services/audioRoutingManager';
import { audioAnalyzer } from '../../services/audioAnalyzer';
import { compositionAudioMixer } from '../../services/compositionAudioMixer';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import { audioExtractor } from '../../engine/audio/AudioExtractor';
import { syncTransitionCompositionTimelineToParent } from './slices/composition/transitionCompositionSync';

const log = Logger.create('MediaStore');

type MediaStore = typeof import('./index').useMediaStore;
type TimelineStoreState = ReturnType<typeof useTimelineStore.getState>;
type SaveTimelineToActiveCompositionOptions = {
  allowDuringTimelineInteraction?: boolean;
};
type TimelineCompositionSaveRefs = {
  tracks: unknown;
  clips: unknown;
  duration: number;
  durationLocked: boolean;
  inPoint: number | null;
  outPoint: number | null;
  loopPlayback: boolean;
  clipKeyframes: unknown;
  markers: unknown;
  videoBakeRegions: unknown;
  masterAudioState: unknown;
};
type MediaStoreGlobal = typeof globalThis & {
  __mediaStoreModule?: { useMediaStore: MediaStore };
  __masterselectsMediaStoreAutoSaveIntervalId?: ReturnType<typeof setInterval>;
  __masterselectsMediaStoreBeforeUnloadHandler?: () => void;
  __masterselectsTimelineCompositionSaveSignatures?: Map<string, string>;
  __masterselectsTimelineCompositionSaveRefs?: Map<string, TimelineCompositionSaveRefs>;
  __TIMELINE_CANVAS_SMOKE_ACTIVE__?: boolean;
};

// Cached store reference - populated after first access
let cachedMediaStore: MediaStore | null = null;

function getTimelineSaveSignatures(): Map<string, string> {
  const globalState = globalThis as MediaStoreGlobal;
  globalState.__masterselectsTimelineCompositionSaveSignatures ??= new Map<string, string>();
  return globalState.__masterselectsTimelineCompositionSaveSignatures;
}

function getTimelineSaveRefs(): Map<string, TimelineCompositionSaveRefs> {
  const globalState = globalThis as MediaStoreGlobal;
  globalState.__masterselectsTimelineCompositionSaveRefs ??= new Map<string, TimelineCompositionSaveRefs>();
  return globalState.__masterselectsTimelineCompositionSaveRefs;
}

function createTimelineSaveRefs(state: TimelineStoreState): TimelineCompositionSaveRefs {
  return {
    tracks: state.tracks,
    clips: state.clips,
    duration: state.duration,
    durationLocked: state.durationLocked,
    inPoint: state.inPoint,
    outPoint: state.outPoint,
    loopPlayback: state.loopPlayback,
    clipKeyframes: state.clipKeyframes,
    markers: state.markers,
    videoBakeRegions: state.videoBakeRegions,
    masterAudioState: state.masterAudioState,
  };
}

function areTimelineSaveRefsEqual(
  previous: TimelineCompositionSaveRefs | undefined,
  next: TimelineCompositionSaveRefs,
): boolean {
  return Boolean(previous) &&
    previous!.tracks === next.tracks &&
    previous!.clips === next.clips &&
    previous!.duration === next.duration &&
    previous!.durationLocked === next.durationLocked &&
    previous!.inPoint === next.inPoint &&
    previous!.outPoint === next.outPoint &&
    previous!.loopPlayback === next.loopPlayback &&
    previous!.clipKeyframes === next.clipKeyframes &&
    previous!.markers === next.markers &&
    previous!.videoBakeRegions === next.videoBakeRegions &&
    previous!.masterAudioState === next.masterAudioState;
}

function createTimelineSaveSignature(timelineData: CompositionTimelineData | undefined): string {
  if (!timelineData) return '';
  const {
    playheadPosition: _playheadPosition,
    scrollX: _scrollX,
    zoom: _zoom,
    ...content
  } = timelineData;
  return JSON.stringify(content);
}

// Lazy getter to avoid circular dependency
const getMediaStore = (): MediaStore | null => {
  if (cachedMediaStore) return cachedMediaStore;

  // Try to get the store - it may not be ready yet during initial load
  try {
    // Use dynamic import workaround for ESM
    // The store is accessed through the global module cache
    const module = (globalThis as MediaStoreGlobal).__mediaStoreModule;
    if (module?.useMediaStore) {
      cachedMediaStore = module.useMediaStore;
      return cachedMediaStore;
    }
  } catch {
    // Store not ready yet
  }
  return null;
};

/**
 * Save current timeline to active composition.
 */
function saveTimelineToActiveComposition(options: SaveTimelineToActiveCompositionOptions = {}): void {
  if ((globalThis as MediaStoreGlobal).__TIMELINE_CANVAS_SMOKE_ACTIVE__) {
    log.debug('Skipped timeline-to-composition save during timeline canvas smoke');
    return;
  }

  if (isProjectStoreSyncInProgress()) {
    log.debug('Skipped timeline-to-composition save during project store sync');
    return;
  }

  const useMediaStore = getMediaStore();
  if (!useMediaStore) return; // Store not ready yet
  const { activeCompositionId } = useMediaStore.getState();
  if (activeCompositionId) {
    const timelineStore = useTimelineStore.getState();
    if (!options.allowDuringTimelineInteraction && timelineStore.clipDragPreview) {
      return;
    }

    const nextRefs = createTimelineSaveRefs(timelineStore);
    const refs = getTimelineSaveRefs();
    if (areTimelineSaveRefsEqual(refs.get(activeCompositionId), nextRefs)) {
      return;
    }

    const timelineData = timelineStore.getSerializableState();
    const nextSignature = createTimelineSaveSignature(timelineData);
    refs.set(activeCompositionId, nextRefs);
    const signatures = getTimelineSaveSignatures();
    const previousSignature = signatures.get(activeCompositionId);
    if (previousSignature === nextSignature) return;

    let didUpdate = false;
    useMediaStore.setState((state: MediaState) => {
      const activeComposition = state.compositions.find((c: Composition) => c.id === activeCompositionId);
      if (!activeComposition) return state;

      const currentSignature = createTimelineSaveSignature(activeComposition.timelineData);
      if (currentSignature === nextSignature) {
        signatures.set(activeCompositionId, nextSignature);
        return state;
      }

      didUpdate = true;
      signatures.set(activeCompositionId, nextSignature);
      return {
        compositions: syncTransitionCompositionTimelineToParent(
          state.compositions.map((c: Composition) =>
            c.id === activeCompositionId ? { ...c, timelineData } : c
          ),
          activeCompositionId,
          timelineData,
        ),
      };
    });

    if (!didUpdate) {
      signatures.set(activeCompositionId, nextSignature);
    }
  }
}

/**
 * Trigger timeline save (exported for external use).
 */
export function triggerTimelineSave(): void {
  saveTimelineToActiveComposition();
  log.info('Timeline saved to composition');
}

/**
 * Initialize media store from IndexedDB and file handles.
 */
async function initializeStore(): Promise<void> {
  const useMediaStore = getMediaStore();
  if (!useMediaStore) {
    log.warn('Media store not ready during initialization');
    return;
  }

  // Initialize file system service
  await fileSystemService.init();

  // Update proxy folder name if restored
  const proxyFolderName = fileSystemService.getProxyFolderName();
  if (proxyFolderName) {
    useMediaStore.setState({ proxyFolderName });
  }

  // Initialize media from IndexedDB
  await useMediaStore.getState().initFromDB();

  // Restore active composition's timeline
  const { activeCompositionId, compositions } = useMediaStore.getState();
  if (activeCompositionId) {
    const activeComp = compositions.find((c: Composition) => c.id === activeCompositionId);
    if (activeComp?.timelineData) {
      log.info('Restoring timeline for:', activeComp.name);
      await useTimelineStore.getState().loadState(activeComp.timelineData);

      // Sync transcript and analysis status from restored clips to MediaFiles (for badge display)
      syncStatusFromClips(useMediaStore);
    }
  }
}

/**
 * Calculate coverage ratio from time ranges vs total duration (0-1).
 */
function calcRangeCoverage(ranges: [number, number][], totalDuration: number): number {
  if (totalDuration <= 0 || ranges.length === 0) return 0;
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i][0] <= last[1]) {
      last[1] = Math.max(last[1], sorted[i][1]);
    } else {
      merged.push([...sorted[i]]);
    }
  }
  return Math.min(1, merged.reduce((sum, [s, e]) => sum + (e - s), 0) / totalDuration);
}

/**
 * Scan timeline clips for transcripts and analysis and propagate status + coverage to MediaFiles.
 * This ensures the "T" and "A" badges show correctly after project reload.
 */
function syncStatusFromClips(useMediaStore: MediaStore): void {
  const clips = useTimelineStore.getState().clips;
  const transcriptMap = new Map<string, import('../../types').TranscriptWord[]>();
  // Track transcribed time ranges per media file (clip in/out = entire range was processed)
  const transcribedRangesMap = new Map<string, [number, number][]>();
  // Track analysis ranges per media file for coverage calculation
  const analysisRanges = new Map<string, [number, number][]>();

  for (const clip of clips) {
    const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
    if (!mediaFileId) continue;

    // Transcript sync
    if (clip.transcriptStatus === 'ready' && clip.transcript?.length) {
      const existing = transcriptMap.get(mediaFileId);
      if (existing) {
        for (const word of clip.transcript) {
          const dup = existing.some(
            (w: import('../../types').TranscriptWord) => Math.abs(w.start - word.start) < 0.05 && Math.abs(w.end - word.end) < 0.05
          );
          if (!dup) existing.push(word);
        }
      } else {
        transcriptMap.set(mediaFileId, [...clip.transcript]);
      }
      // Track the clip's full range as "transcribed" (silence still counts)
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existingRanges = transcribedRangesMap.get(mediaFileId) || [];
        existingRanges.push([inPt, outPt]);
        transcribedRangesMap.set(mediaFileId, existingRanges);
      }
    }

    // Analysis sync — collect ranges for coverage
    if (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready') {
      const inPt = clip.inPoint ?? 0;
      const outPt = clip.outPoint ?? (clip.source?.naturalDuration ?? 0);
      if (outPt > inPt) {
        const existing = analysisRanges.get(mediaFileId) || [];
        existing.push([inPt, outPt]);
        analysisRanges.set(mediaFileId, existing);
      }
    }
  }

  if (transcriptMap.size === 0 && analysisRanges.size === 0) return;

  // Sort each transcript by start time
  for (const [, words] of transcriptMap) {
    words.sort((a, b) => a.start - b.start);
  }

  useMediaStore.setState((state: MediaState) => ({
    files: state.files.map((f: MediaFile): MediaFile => {
      const transcript = transcriptMap.get(f.id);
      const tRanges = transcribedRangesMap.get(f.id);
      const aRanges = analysisRanges.get(f.id);
      if (!transcript && !aRanges) return f;

      const dur = f.duration || 0;
      return {
        ...f,
        ...(transcript && {
          transcriptStatus: 'ready' as const,
          transcript,
          // Use transcribed time ranges (not word ranges) - silence is still "transcribed"
          transcriptCoverage: dur > 0 && tRanges ? calcRangeCoverage(tRanges, dur) : 0,
          transcribedRanges: tRanges,
        }),
        ...(aRanges && f.analysisStatus !== 'ready' && {
          analysisStatus: 'ready' as const,
          analysisCoverage: dur > 0 ? calcRangeCoverage(aRanges, dur) : 0,
        }),
      };
    }),
  }));

  const total = transcriptMap.size + analysisRanges.size;
  log.info(`Synced status for ${total} media file(s) (T:${transcriptMap.size}, A:${analysisRanges.size})`);
}

/**
 * Persist generated media items to localStorage on change.
 */
function setupItemPersistence(): void {
  const useMediaStore = getMediaStore();
  if (!useMediaStore) return;

  // Subscribe to textItems changes
  useMediaStore.subscribe(
    (state: MediaState) => state.textItems,
    (textItems: MediaState['textItems']) => {
      try {
        localStorage.setItem('ms-textItems', JSON.stringify(textItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  // Subscribe to solidItems changes
  useMediaStore.subscribe(
    (state: MediaState) => state.solidItems,
    (solidItems: MediaState['solidItems']) => {
      try {
        localStorage.setItem('ms-solidItems', JSON.stringify(solidItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  // Subscribe to meshItems changes
  useMediaStore.subscribe(
    (state: MediaState) => state.meshItems,
    (meshItems: MediaState['meshItems']) => {
      try {
        localStorage.setItem('ms-meshItems', JSON.stringify(meshItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  // Subscribe to cameraItems changes
  useMediaStore.subscribe(
    (state: MediaState) => state.cameraItems,
    (cameraItems: MediaState['cameraItems']) => {
      try {
        localStorage.setItem('ms-cameraItems', JSON.stringify(cameraItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  useMediaStore.subscribe(
    (state: MediaState) => state.lightItems,
    (lightItems: MediaState['lightItems']) => {
      try {
        localStorage.setItem('ms-lightItems', JSON.stringify(lightItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  useMediaStore.subscribe(
    (state: MediaState) => state.splatEffectorItems,
    (splatEffectorItems: MediaState['splatEffectorItems']) => {
      try {
        localStorage.setItem('ms-splatEffectorItems', JSON.stringify(splatEffectorItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  useMediaStore.subscribe(
    (state: MediaState) => state.mathSceneItems,
    (mathSceneItems: MediaState['mathSceneItems']) => {
      try {
        localStorage.setItem('ms-mathSceneItems', JSON.stringify(mathSceneItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  useMediaStore.subscribe(
    (state: MediaState) => state.motionShapeItems,
    (motionShapeItems: MediaState['motionShapeItems']) => {
      try {
        localStorage.setItem('ms-motionShapeItems', JSON.stringify(motionShapeItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  log.info('Item persistence setup complete');
}

/**
 * Set up auto-save interval.
 */
function setupAutoSave(): void {
  const globalState = globalThis as MediaStoreGlobal;
  if (globalState.__masterselectsMediaStoreAutoSaveIntervalId) {
    clearInterval(globalState.__masterselectsMediaStoreAutoSaveIntervalId);
  }

  globalState.__masterselectsMediaStoreAutoSaveIntervalId = setInterval(() => {
    if ((window as unknown as { __CLEARING_CACHE__?: boolean }).__CLEARING_CACHE__) return;
    saveTimelineToActiveComposition();
  }, 30000); // Every 30 seconds
}

/**
 * Dispose all audio contexts and related resources.
 * Called on page unload to prevent leaked AudioContext instances.
 */
function disposeAllAudio(): void {
  try {
    audioManager.destroy();
    audioRoutingManager.dispose();
    audioAnalyzer.dispose();
    compositionAudioMixer.dispose();
    proxyFrameCache.disposeAudioContext();
    audioExtractor.destroy();
    log.info('All audio contexts disposed');
  } catch (e) {
    log.warn('Error during audio cleanup', e);
  }
}

/**
 * Set up beforeunload handler.
 */
function setupBeforeUnload(): void {
  const globalState = globalThis as MediaStoreGlobal;
  if (globalState.__masterselectsMediaStoreBeforeUnloadHandler) {
    window.removeEventListener('beforeunload', globalState.__masterselectsMediaStoreBeforeUnloadHandler);
  }

  globalState.__masterselectsMediaStoreBeforeUnloadHandler = () => {
    if ((window as unknown as { __CLEARING_CACHE__?: boolean }).__CLEARING_CACHE__) return;
    saveTimelineToActiveComposition({ allowDuringTimelineInteraction: true });
    disposeAllAudio();
  };
  window.addEventListener('beforeunload', globalState.__masterselectsMediaStoreBeforeUnloadHandler);
}

// Auto-initialize on app load
if (typeof window !== 'undefined') {
  setTimeout(() => {
    initializeStore();
    setupAutoSave();
    setupBeforeUnload();
    setupItemPersistence();
  }, 100);
}
