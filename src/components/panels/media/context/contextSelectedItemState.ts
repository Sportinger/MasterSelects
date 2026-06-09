import type {
  Composition,
  MediaFile,
  ProjectItem,
  SolidItem,
} from '../../../../stores/mediaStore';
import { isImportedMediaFileItem } from '../itemTypeGuards';

interface GetMediaContextSelectedItemStateInput {
  itemId?: string;
  items: readonly ProjectItem[];
}

export interface MediaContextSelectedItemState {
  selectedItem: ProjectItem | null;
  mediaFile: MediaFile | null;
  composition: Composition | null;
  solidItem: SolidItem | null;
}

function isCompositionItem(item: ProjectItem | null): item is Composition {
  return Boolean(item && 'type' in item && item.type === 'composition');
}

function isSolidItem(item: ProjectItem | null): item is SolidItem {
  return Boolean(item && 'type' in item && item.type === 'solid');
}

export function getMediaContextSelectedItemState({
  itemId,
  items,
}: GetMediaContextSelectedItemStateInput): MediaContextSelectedItemState {
  const selectedItem = itemId ? items.find(item => item.id === itemId) ?? null : null;

  return {
    selectedItem,
    mediaFile: selectedItem && isImportedMediaFileItem(selectedItem) ? selectedItem : null,
    composition: isCompositionItem(selectedItem) ? selectedItem : null,
    solidItem: isSolidItem(selectedItem) ? selectedItem : null,
  };
}
