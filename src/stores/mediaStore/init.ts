// MediaStore initialization and auto-save
// NOTE: This module is imported by index.ts for side effects
// We use a lazy getter to avoid circular dependencies

import { useTimelineStore } from '../timeline';
import { fileSystemService } from '../../services/fileSystemService';
import type { Composition, MediaState } from './types';
import { Logger } from '../../services/logger';
import { audioManager } from '../../services/audioManager';
import { audioRoutingManager } from '../../services/audioRoutingManager';
import { audioAnalyzer } from '../../services/audioAnalyzer';
import { compositionAudioMixer } from '../../services/compositionAudioMixer';
import { proxyFrameCache } from '../../services/proxyFrameCache';
import { audioExtractor } from '../../engine/audio/AudioExtractor';

const log = Logger.create('MediaStore');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MediaStore = any;

// Cached store reference - populated after first access
let cachedMediaStore: MediaStore | null = null;

// Lazy getter to avoid circular dependency
const getMediaStore = (): MediaStore | null => {
  if (cachedMediaStore) return cachedMediaStore;

  // Try to get the store - it may not be ready yet during initial load
  try {
    // Use dynamic import workaround for ESM
    // The store is accessed through the global module cache
    const module = (globalThis as any).__mediaStoreModule;
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
function saveTimelineToActiveComposition(): void {
  const useMediaStore = getMediaStore();
  if (!useMediaStore) return; // Store not ready yet
  const { activeCompositionId } = useMediaStore.getState();
  if (activeCompositionId) {
    const timelineStore = useTimelineStore.getState();
    const timelineData = timelineStore.getSerializableState();
    useMediaStore.setState((state: MediaState) => ({
      compositions: state.compositions.map((c: Composition) =>
        c.id === activeCompositionId ? { ...c, timelineData } : c
      ),
    }));
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
    files: state.files.map((f: { id: string; duration?: number; analysisStatus?: string; transcriptStatus?: string; transcriptCoverage?: number; analysisCoverage?: number }) => {
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
    (state: MediaState) => state.splatEffectorItems,
    (splatEffectorItems: MediaState['splatEffectorItems']) => {
      try {
        localStorage.setItem('ms-splatEffectorItems', JSON.stringify(splatEffectorItems));
      } catch { /* quota exceeded or unavailable */ }
    }
  );

  log.info('Item persistence setup complete');
}

/**
 * Set up auto-save interval.
 */
function setupAutoSave(): void {
  setInterval(() => {
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
  window.addEventListener('beforeunload', () => {
    if ((window as unknown as { __CLEARING_CACHE__?: boolean }).__CLEARING_CACHE__) return;
    saveTimelineToActiveComposition();
    disposeAllAudio();
  });
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
