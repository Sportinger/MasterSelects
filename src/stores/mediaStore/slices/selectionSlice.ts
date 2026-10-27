// Selection actions

import type { MediaFolder, MediaSliceCreator, LabelColor } from '../types';
import { Logger } from '../../../services/logger';

const log = Logger.create('MediaSelection');

/** Folder ids of `itemIds` that would land in themselves or one of their own subfolders. */
export function findFolderMoveCycles(folders: readonly MediaFolder[], itemIds: readonly string[], targetId: string | null): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain = new Set<string>();
  let cursor = targetId ? byId.get(targetId) : undefined;
  while (cursor && !chain.has(cursor.id)) {
    chain.add(cursor.id);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
  return itemIds.filter((id) => byId.has(id) && chain.has(id));
}

export interface SelectionActions {
  moveToFolder: (itemIds: string[], folderId: string | null) => void;
  setSelection: (ids: string[]) => void;
  addToSelection: (id: string) => void;
  removeFromSelection: (id: string) => void;
  clearSelection: () => void;
  setLabelColor: (itemIds: string[], color: LabelColor) => void;
}

export const createSelectionSlice: MediaSliceCreator<SelectionActions> = (set, get) => ({
  moveToFolder: (requestedIds: string[], folderId: string | null) => {
    // A folder moved into itself or its own subfolder would detach the whole branch from the tree.
    const cycles = findFolderMoveCycles(get().folders, requestedIds, folderId);
    if (cycles.length > 0) log.warn('Refused to move folders into themselves or their own subfolders', { folderIds: cycles, folderId });
    const itemIds = cycles.length > 0 ? requestedIds.filter((id) => !cycles.includes(id)) : requestedIds;
    if (itemIds.length === 0) return;
    set((state) => ({
      files: state.files.map((f) =>
        itemIds.includes(f.id) ? { ...f, parentId: folderId } : f
      ),
      compositions: state.compositions.map((c) =>
        itemIds.includes(c.id) ? { ...c, parentId: folderId } : c
      ),
      folders: state.folders.map((f) =>
        itemIds.includes(f.id) ? { ...f, parentId: folderId } : f
      ),
      textItems: state.textItems.map((t) =>
        itemIds.includes(t.id) ? { ...t, parentId: folderId } : t
      ),
      solidItems: state.solidItems.map((s) =>
        itemIds.includes(s.id) ? { ...s, parentId: folderId } : s
      ),
      meshItems: (state.meshItems || []).map((m) =>
        itemIds.includes(m.id) ? { ...m, parentId: folderId } : m
      ),
      cameraItems: (state.cameraItems || []).map((c) =>
        itemIds.includes(c.id) ? { ...c, parentId: folderId } : c
      ),
      lightItems: (state.lightItems || []).map((l) =>
        itemIds.includes(l.id) ? { ...l, parentId: folderId } : l
      ),
      splatEffectorItems: (state.splatEffectorItems || []).map((effector) =>
        itemIds.includes(effector.id) ? { ...effector, parentId: folderId } : effector
      ),
      mathSceneItems: (state.mathSceneItems || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, parentId: folderId } : item
      ),
      motionShapeItems: (state.motionShapeItems || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, parentId: folderId } : item
      ),
      signalAssets: (state.signalAssets || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, parentId: folderId } : item
      ),
    }));
  },

  setSelection: (ids: string[]) => {
    set({ selectedIds: ids });
  },

  addToSelection: (id: string) => {
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds
        : [...state.selectedIds, id],
    }));
  },

  removeFromSelection: (id: string) => {
    set((state) => ({
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
    }));
  },

  clearSelection: () => {
    set({ selectedIds: [] });
  },

  setLabelColor: (itemIds: string[], color: LabelColor) => {
    set((state) => ({
      files: state.files.map((f) =>
        itemIds.includes(f.id) ? { ...f, labelColor: color } : f
      ),
      compositions: state.compositions.map((c) =>
        itemIds.includes(c.id) ? { ...c, labelColor: color } : c
      ),
      folders: state.folders.map((f) =>
        itemIds.includes(f.id) ? { ...f, labelColor: color } : f
      ),
      textItems: state.textItems.map((t) =>
        itemIds.includes(t.id) ? { ...t, labelColor: color } : t
      ),
      solidItems: state.solidItems.map((s) =>
        itemIds.includes(s.id) ? { ...s, labelColor: color } : s
      ),
      meshItems: (state.meshItems || []).map((m) =>
        itemIds.includes(m.id) ? { ...m, labelColor: color } : m
      ),
      cameraItems: (state.cameraItems || []).map((c) =>
        itemIds.includes(c.id) ? { ...c, labelColor: color } : c
      ),
      lightItems: (state.lightItems || []).map((l) =>
        itemIds.includes(l.id) ? { ...l, labelColor: color } : l
      ),
      splatEffectorItems: (state.splatEffectorItems || []).map((effector) =>
        itemIds.includes(effector.id) ? { ...effector, labelColor: color } : effector
      ),
      mathSceneItems: (state.mathSceneItems || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, labelColor: color } : item
      ),
      motionShapeItems: (state.motionShapeItems || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, labelColor: color } : item
      ),
      signalAssets: (state.signalAssets || []).map((item) =>
        itemIds.includes(item.id) ? { ...item, labelColor: color } : item
      ),
    }));
  },
});
