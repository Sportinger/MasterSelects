// Folder operations

import type { MediaFolder, MediaSliceCreator } from '../types';
import { generateId } from '../helpers/importPipeline';

export interface FolderActions {
  createFolder: (name: string, parentId?: string | null) => MediaFolder;
  removeFolder: (id: string) => void;
  renameFolder: (id: string, name: string) => void;
  toggleFolderExpanded: (id: string) => void;
}

export const createFolderSlice: MediaSliceCreator<FolderActions> = (set, get) => ({
  createFolder: (name: string, parentId: string | null = null) => {
    const folder: MediaFolder = {
      id: generateId(),
      name,
      parentId,
      isExpanded: true,
      createdAt: Date.now(),
    };

    set((state) => ({
      folders: [...state.folders, folder],
      expandedFolderIds: [...state.expandedFolderIds, folder.id],
    }));

    return folder;
  },

  removeFolder: (id: string) => {
    // Move children to parent folder
    const folder = get().folders.find((f) => f.id === id);
    const parentId = folder?.parentId ?? null;

    set((state) => ({
      folders: state.folders.filter((f) => f.id !== id),
      files: state.files.map((f) =>
        f.parentId === id ? { ...f, parentId } : f
      ),
      compositions: state.compositions.map((c) =>
        c.parentId === id ? { ...c, parentId } : c
      ),
      selectedIds: state.selectedIds.filter((sid) => sid !== id),
      expandedFolderIds: state.expandedFolderIds.filter((eid) => eid !== id),
    }));
  },

  renameFolder: (id: string, name: string) => {
    set((state) => ({
      folders: state.folders.map((f) => (f.id === id ? { ...f, name } : f)),
    }));
  },

  toggleFolderExpanded: (id: string) => {
    set((state) => ({
      expandedFolderIds: state.expandedFolderIds.includes(id)
        ? state.expandedFolderIds.filter((eid) => eid !== id)
        : [...state.expandedFolderIds, id],
    }));
  },
});
