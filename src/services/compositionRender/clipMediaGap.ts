import { useMediaStore } from '../../stores/mediaStore';
import type { MediaFile } from '../../stores/mediaStore/types';
import { Logger } from '../logger';
import { isLinkedMediaDeferred } from '../project/linkedMediaDemand';
import { isRepositoryHydrating } from '../project/repository/transaction/storeMutationBoundary';
import type { CompositionSources } from './sourceTypes';

/**
 * Why a clip got no source while a composition was prepared:
 * - `missing`: no media entry with that id exists (a real project defect);
 * - `loading`: the entry exists but its runtime File is not restored yet (project open/reopen,
 *   or a linked source that opens on demand); the composition re-prepares once it arrives;
 * - `unavailable`: the entry exists without a File outside any load (offline or needs relink).
 */
export type ClipMediaGap = 'missing' | 'loading' | 'unavailable';

export function classifyClipMediaGap(mediaFileId: string | undefined, mediaFile: MediaFile | undefined, projectLoading: boolean): ClipMediaGap {
  if (!mediaFileId || !mediaFile) return 'missing';
  if (projectLoading || isRepositoryHydrating() || isLinkedMediaDeferred(mediaFileId)) return 'loading';
  return 'unavailable';
}

/**
 * Logs a clip without a loadable source at the right level and remembers media that may still
 * arrive, so `watchPendingClipMedia` can rebuild the composition instead of leaving the clip blank.
 */
export function reportClipMediaGap(
  logger: Pick<ReturnType<typeof Logger.create>, 'debug' | 'warn'>,
  sources: CompositionSources,
  clipId: string,
  mediaFileId: string | undefined,
  mediaFile: MediaFile | undefined,
  mediaFiles: readonly MediaFile[],
  projectLoading: boolean,
  urlSuffices = false,
): ClipMediaGap {
  const gap = classifyClipMediaGap(mediaFileId, mediaFile, projectLoading);
  if (gap !== 'missing' && mediaFileId) (sources.pendingMediaFileIds ??= new Map()).set(mediaFileId, urlSuffices);
  if (gap === 'loading') {
    logger.debug(`Media file not loaded yet for clip ${clipId}; the composition is rebuilt when it arrives`, { mediaFileId });
  } else if (gap === 'unavailable') {
    logger.warn(`Media file for clip ${clipId} has no loaded source (offline or needs relink)`, { mediaFileId, name: mediaFile?.name });
  } else {
    logger.warn(`Media file not found for clip ${clipId}`, {
      mediaFileId,
      availableFileIds: mediaFiles.map(f => f.id).slice(0, 5),
      totalFiles: mediaFiles.length,
    });
  }
  return gap;
}


/** Compositions prepared without a clip's source whose media entry has a loaded source now. */
export function findCompositionsWithArrivedMedia(
  compositionSources: ReadonlyMap<string, CompositionSources>,
  mediaFiles: readonly MediaFile[],
): string[] {
  let byId: Map<string, MediaFile> | null = null;
  const arrived: string[] = [];
  for (const [compositionId, sources] of compositionSources) {
    if (sources.disposed || !sources.pendingMediaFileIds?.size) continue;
    byId ??= new Map(mediaFiles.map(file => [file.id, file]));
    const lookup = byId;
    const loaded = [...sources.pendingMediaFileIds].some(([id, urlSuffices]) => {
      const file = lookup.get(id);
      return Boolean(file?.file || (urlSuffices && file?.url));
    });
    if (loaded) arrived.push(compositionId);
  }
  return arrived;
}

const log = Logger.create('CompositionRenderer');

/**
 * Rebuilds compositions (and their parents) once media that was missing at prepare time has
 * loaded. `arm()` subscribes to the media library on first need, so no work runs otherwise.
 */
export function createArrivedClipMediaWatch(
  compositionSources: ReadonlyMap<string, CompositionSources>,
  invalidate: (compositionId: string) => void,
): { arm(): void; dispose(): void } {
  let unsubscribe: (() => void) | null = null;
  return {
    arm() {
      if (unsubscribe) return;
      unsubscribe = useMediaStore.subscribe(state => state.files, files => {
        for (const compositionId of findCompositionsWithArrivedMedia(compositionSources, files)) {
          log.info(`Media for composition ${compositionId} finished loading; rebuilding its sources`);
          invalidate(compositionId);
        }
      });
    },
    /** Stops watching, e.g. when HMR replaces the renderer module, so no stale renderer keeps rebuilding. */
    dispose() { unsubscribe?.(); unsubscribe = null; },
  };
}
