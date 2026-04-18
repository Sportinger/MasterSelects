import type { MediaFile, ProjectItem } from '../../../stores/mediaStore';

export function isImportedMediaFileItem(item: ProjectItem): item is MediaFile {
  if (!('type' in item) || 'isExpanded' in item) {
    return false;
  }

  if (
    item.type === 'composition' ||
    item.type === 'text' ||
    item.type === 'solid' ||
    item.type === 'camera' ||
    item.type === 'splat-effector'
  ) {
    return false;
  }

  // Primitive mesh items also use type "model" but are not imported files.
  if (item.type === 'model' && 'meshType' in item) {
    return false;
  }

  return 'url' in item;
}

export function getItemImportProgress(item: ProjectItem): number | null {
  if (!isImportedMediaFileItem(item) || !item.isImporting) {
    return null;
  }

  const progress = Math.round(item.importProgress ?? 0);
  return Math.max(0, Math.min(100, progress));
}
