import type { MediaFile } from '../../stores/mediaStore/types';
import { isLinkedMediaDeferred } from '../project/linkedMediaDemand';
import { isRepositoryHydrating } from '../project/repository/transaction/storeMutationBoundary';

/**
 * Why a clip has no loadable media source:
 * - `missing`: no media entry with that id exists (a real project defect);
 * - `loading`: the entry exists but its runtime File is not restored yet (project open/reopen,
 *   or a linked source that opens on demand); consumers wait for it instead of reporting it;
 * - `unavailable`: the entry exists without a File outside any load (offline or needs relink).
 *
 * Shared by composition preparation and the clip audio analyses so every consumer reports
 * a reopen in progress the same way.
 */
export type ClipMediaGap = 'missing' | 'loading' | 'unavailable';

export function classifyClipMediaGap(mediaFileId: string | undefined, mediaFile: MediaFile | undefined, projectLoading: boolean): ClipMediaGap {
  if (!mediaFileId || !mediaFile) return 'missing';
  if (projectLoading || isRepositoryHydrating() || isLinkedMediaDeferred(mediaFileId)) return 'loading';
  return 'unavailable';
}
