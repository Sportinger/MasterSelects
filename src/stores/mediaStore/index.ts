// MediaStore - main coordinator

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { MediaState, MediaFile, ProjectItem } from './types';
import { DEFAULT_COMPOSITION } from './constants';
import { fileSystemService } from '../../services/fileSystemService';

// Import slices
import { createFileImportSlice, type FileImportActions } from './slices/fileImportSlice';
import { createFileManageSlice, type FileManageActions } from './slices/fileManageSlice';
import { createCompositionSlice, type CompositionActions } from './slices/compositionSlice';
import { createFolderSlice, type FolderActions } from './slices/folderSlice';
import { createSelectionSlice, type SelectionActions } from './slices/selectionSlice';
import { createProxySlice, type ProxyActions } from './slices/proxySlice';
import { createProjectSlice, type ProjectActions } from './slices/projectSlice';

// Re-export types
export type { MediaType, ProxyStatus, MediaItem, MediaFile, Composition, MediaFolder, TextItem, ProjectItem } from './types';

// Combined store type with all actions
type MediaStoreState = MediaState &
  FileImportActions &
  FileManageActions &
  CompositionActions &
  FolderActions &
  SelectionActions &
  ProxyActions &
  ProjectActions & {
    getItemsByFolder: (folderId: string | null) => ProjectItem[];
    getItemById: (id: string) => ProjectItem | undefined;
    getFileByName: (name: string) => MediaFile | undefined;
    createTextItem: (name?: string) => string;
    removeTextItem: (id: string) => void;
  };

export const useMediaStore = create<MediaStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    files: [],
    compositions: [DEFAULT_COMPOSITION],
    folders: [],
    textItems: [],
    activeCompositionId: 'comp-1',
    openCompositionIds: ['comp-1'],
    selectedIds: [],
    expandedFolderIds: [],
    currentProjectId: null,
    currentProjectName: 'Untitled Project',
    isLoading: false,
    // proxyEnabled is defined in proxySlice
    proxyGenerationQueue: [],
    currentlyGeneratingProxyId: null,
    fileSystemSupported: fileSystemService.isSupported(),
    proxyFolderName: fileSystemService.getProxyFolderName(),

    // Getters
    getItemsByFolder: (folderId: string | null) => {
      const { files, compositions, folders, textItems } = get();
      return [
        ...folders.filter((f) => f.parentId === folderId),
        ...compositions.filter((c) => c.parentId === folderId),
        ...textItems.filter((t) => t.parentId === folderId),
        ...files.filter((f) => f.parentId === folderId),
      ];
    },

    getItemById: (id: string) => {
      const { files, compositions, folders, textItems } = get();
      return (
        files.find((f) => f.id === id) ||
        compositions.find((c) => c.id === id) ||
        folders.find((f) => f.id === id) ||
        textItems.find((t) => t.id === id)
      );
    },

    getFileByName: (name: string) => {
      return get().files.find((f) => f.name === name);
    },

    // Create text item in Media Panel
    createTextItem: (name?: string) => {
      const { textItems } = get();
      const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newText = {
        id,
        name: name || `Text ${textItems.length + 1}`,
        type: 'text' as const,
        parentId: null,
        createdAt: Date.now(),
        text: 'New Text',
        fontFamily: 'Arial',
        fontSize: 48,
        color: '#ffffff',
        duration: 5, // 5 seconds default
      };
      set({ textItems: [...textItems, newText] });
      return id;
    },

    removeTextItem: (id: string) => {
      set({ textItems: get().textItems.filter(t => t.id !== id) });
    },

    // Merge all slices
    ...createFileImportSlice(set, get),
    ...createFileManageSlice(set, get),
    ...createCompositionSlice(set, get),
    ...createFolderSlice(set, get),
    ...createSelectionSlice(set, get),
    ...createProxySlice(set, get),
    ...createProjectSlice(set, get),
  }))
);

// Register store globally for init.ts to access (avoids circular dependency)
(globalThis as any).__mediaStoreModule = { useMediaStore };

// Import init module for side effects (auto-init, autosave, beforeunload)
import './init';

// Export trigger for external use
export { triggerTimelineSave } from './init';
