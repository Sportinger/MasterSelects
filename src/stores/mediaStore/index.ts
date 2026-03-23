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
import { createSlotSlice, type SlotActions } from './slices/slotSlice';
import { createMultiLayerSlice, type MultiLayerActions } from './slices/multiLayerSlice';
import { createFolderSlice, type FolderActions } from './slices/folderSlice';
import { createSelectionSlice, type SelectionActions } from './slices/selectionSlice';
import { createProxySlice, type ProxyActions } from './slices/proxySlice';
import { createProjectSlice, type ProjectActions } from './slices/projectSlice';

// Re-export types
export type { MediaType, ProxyStatus, MediaItem, MediaFile, Composition, MediaFolder, TextItem, SolidItem, MeshItem, MeshPrimitiveType, ProjectItem } from './types';

// Combined store type with all actions
type MediaStoreState = MediaState &
  FileImportActions &
  FileManageActions &
  CompositionActions &
  SlotActions &
  MultiLayerActions &
  FolderActions &
  SelectionActions &
  ProxyActions &
  ProjectActions & {
    getItemsByFolder: (folderId: string | null) => ProjectItem[];
    getItemById: (id: string) => ProjectItem | undefined;
    getFileByName: (name: string) => MediaFile | undefined;
    getOrCreateTextFolder: () => string;
    createTextItem: (name?: string, parentId?: string | null) => string;
    removeTextItem: (id: string) => void;
    getOrCreateSolidFolder: () => string;
    createSolidItem: (name?: string, color?: string, parentId?: string | null) => string;
    removeSolidItem: (id: string) => void;
    updateSolidItem: (id: string, updates: Partial<{ color: string; width: number; height: number }>) => void;
    getOrCreateMeshFolder: () => string;
    createMeshItem: (meshType: import('./types').MeshPrimitiveType, name?: string, parentId?: string | null) => string;
    removeMeshItem: (id: string) => void;
  };

export const useMediaStore = create<MediaStoreState>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    files: [],
    compositions: [DEFAULT_COMPOSITION],
    folders: [],
    textItems: [],
    solidItems: [],
    meshItems: [],
    activeCompositionId: 'comp-1',
    openCompositionIds: ['comp-1'],
    slotAssignments: {},
    slotDeckStates: {},
    previewCompositionId: null,
    sourceMonitorFileId: null,
    activeLayerSlots: {},
    layerOpacities: {},
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
      const { files, compositions, folders, textItems, solidItems, meshItems } = get();
      return [
        ...folders.filter((f) => f.parentId === folderId),
        ...compositions.filter((c) => c.parentId === folderId),
        ...textItems.filter((t) => t.parentId === folderId),
        ...solidItems.filter((s) => s.parentId === folderId),
        ...meshItems.filter((m) => m.parentId === folderId),
        ...files.filter((f) => f.parentId === folderId),
      ];
    },

    getItemById: (id: string) => {
      const { files, compositions, folders, textItems, solidItems, meshItems } = get();
      return (
        files.find((f) => f.id === id) ||
        compositions.find((c) => c.id === id) ||
        folders.find((f) => f.id === id) ||
        textItems.find((t) => t.id === id) ||
        solidItems.find((s) => s.id === id) ||
        meshItems.find((m) => m.id === id)
      );
    },

    getFileByName: (name: string) => {
      return get().files.find((f) => f.name === name);
    },

    // Get or create "Text" folder for organizing text items
    getOrCreateTextFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Text' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Text', null);
      return newFolder.id;
    },

    // Create text item in Media Panel
    createTextItem: (name?: string, parentId?: string | null) => {
      const { textItems } = get();
      const id = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newText = {
        id,
        name: name || `Text ${textItems.length + 1}`,
        type: 'text' as const,
        parentId: parentId !== undefined ? parentId : null,
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

    // Get or create "Solids" folder for organizing solid items
    getOrCreateSolidFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Solids' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Solids', null);
      return newFolder.id;
    },

    // Create solid item in Media Panel
    createSolidItem: (name?: string, color?: string, parentId?: string | null) => {
      const { solidItems } = get();
      const id = `solid-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      // Use active composition dimensions, fallback to 1920x1080
      const activeComp = get().getActiveComposition();
      const compWidth = activeComp?.width || 1920;
      const compHeight = activeComp?.height || 1080;
      const newSolid = {
        id,
        name: name || `Solid ${solidItems.length + 1}`,
        type: 'solid' as const,
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        color: color || '#ffffff',
        width: compWidth,
        height: compHeight,
        duration: 5, // 5 seconds default
      };
      set({ solidItems: [...solidItems, newSolid] });
      return id;
    },

    removeSolidItem: (id: string) => {
      set({ solidItems: get().solidItems.filter(s => s.id !== id) });
    },

    updateSolidItem: (id: string, updates: Partial<{ color: string; width: number; height: number }>) => {
      set({
        solidItems: get().solidItems.map(s =>
          s.id === id
            ? {
                ...s,
                ...(updates.color !== undefined && { color: updates.color, name: `Solid ${updates.color}` }),
                ...(updates.width !== undefined && { width: updates.width }),
                ...(updates.height !== undefined && { height: updates.height }),
              }
            : s
        ),
      });
    },

    // Get or create "Meshes" folder for organizing mesh items
    getOrCreateMeshFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Meshes' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Meshes', null);
      return newFolder.id;
    },

    // Create mesh primitive item in Media Panel
    createMeshItem: (meshType: import('./types').MeshPrimitiveType, name?: string, parentId?: string | null) => {
      const { meshItems } = get();
      const id = `mesh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const label = meshType.charAt(0).toUpperCase() + meshType.slice(1);
      const newMesh: import('./types').MeshItem = {
        id,
        name: name || `${label} ${meshItems.filter(m => m.meshType === meshType).length + 1}`,
        type: 'model' as const,
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        meshType,
        color: '#aaaaaa',
        duration: 10, // 10 seconds default for 3D
      };
      set({ meshItems: [...meshItems, newMesh] });
      return id;
    },

    removeMeshItem: (id: string) => {
      set({ meshItems: get().meshItems.filter(m => m.id !== id) });
    },

    // Merge all slices
    ...createFileImportSlice(set, get),
    ...createFileManageSlice(set, get),
    ...createCompositionSlice(set, get),
    ...createSlotSlice(set, get),
    ...createMultiLayerSlice(set, get),
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
