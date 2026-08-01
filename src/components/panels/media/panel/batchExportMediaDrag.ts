import type { MediaFile, ProjectItem } from '../../../../stores/mediaStore';
import { isImportedMediaFileItem } from '../itemTypeGuards';

const BATCH_EXPORT_MEDIA_TYPES = new Set<MediaFile['type']>(['video', 'audio', 'image']);
export type BatchExportMediaNeedsRelink = (mediaFile: MediaFile) => boolean;

export function isBatchExportMediaDragEligible(
  item: ProjectItem,
  needsRelink: BatchExportMediaNeedsRelink,
): item is MediaFile {
  return isImportedMediaFileItem(item)
    && BATCH_EXPORT_MEDIA_TYPES.has(item.type)
    && !item.liveInput
    && !item.isImporting
    && !needsRelink(item);
}

export function planBatchExportMediaDragIds(
  draggedItem: ProjectItem,
  selectedIds: readonly string[],
  mediaFiles: readonly MediaFile[],
  needsRelink: BatchExportMediaNeedsRelink,
): string[] {
  if (!isBatchExportMediaDragEligible(draggedItem, needsRelink)) return [];
  if (!selectedIds.includes(draggedItem.id)) return [draggedItem.id];

  const mediaFilesById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile]));
  const plannedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const selectedId of selectedIds) {
    if (seenIds.has(selectedId)) continue;
    seenIds.add(selectedId);
    const selectedFile = mediaFilesById.get(selectedId);
    if (selectedFile && isBatchExportMediaDragEligible(selectedFile, needsRelink)) {
      plannedIds.push(selectedFile.id);
    }
  }

  return plannedIds;
}
