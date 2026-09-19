export type FlashBoardReferenceableMediaType = 'image' | 'video' | 'audio';

export function isReferenceableMediaType(
  type: string | undefined,
): type is FlashBoardReferenceableMediaType {
  return type === 'image' || type === 'video' || type === 'audio';
}

export function clampReferenceMediaFileIds(
  referenceMediaFileIds: string[],
  maxReferenceImages?: number,
): string[] {
  const uniqueIds = referenceMediaFileIds.filter((mediaFileId, index) => (
    referenceMediaFileIds.indexOf(mediaFileId) === index
  ));
  const hasDuplicates = uniqueIds.length !== referenceMediaFileIds.length;

  if (
    typeof maxReferenceImages !== 'number'
    || !Number.isFinite(maxReferenceImages)
    || maxReferenceImages < 0
  ) {
    return hasDuplicates ? uniqueIds : referenceMediaFileIds;
  }

  const limitedIds = uniqueIds.slice(0, Math.floor(maxReferenceImages));
  return !hasDuplicates && limitedIds.length === referenceMediaFileIds.length
    ? referenceMediaFileIds
    : limitedIds;
}

export function appendReferenceMediaFileIds(currentIds: string[], nextIds: string[]): string[] {
  const seen = new Set(currentIds);
  const result = [...currentIds];

  for (const nextId of nextIds) {
    if (!seen.has(nextId)) {
      seen.add(nextId);
      result.push(nextId);
    }
  }

  return result;
}

export function reorderReferenceMediaFileIds(
  currentIds: string[],
  draggedId: string,
  targetId: string,
): string[] {
  const draggedIndex = currentIds.indexOf(draggedId);
  const targetIndex = currentIds.indexOf(targetId);
  if (draggedId === targetId || draggedIndex < 0 || targetIndex < 0) return currentIds;

  const reorderedIds = [...currentIds];
  reorderedIds.splice(draggedIndex, 1);
  reorderedIds.splice(targetIndex, 0, draggedId);
  return reorderedIds;
}
