// MediaStore - main coordinator

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

import type { MediaState, MediaFile, ProjectItem } from './types';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from './types';
import { isUserVisibleComposition } from './compositionVisibility';
import { DEFAULT_COMPOSITION } from './constants';
import { fileSystemService } from '../../services/fileSystemService';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../types/splatEffector';
import { DEFAULT_LIGHT_CLIP_SETTINGS } from '../../types/light';

// Import slices
import { createFileImportSlice, type FileImportActions } from './slices/fileImportSlice';
import { createFileManageSlice, type FileManageActions } from './slices/fileManageSlice';
import { createCompositionSlice, type CompositionActions } from './slices/compositionSlice';
import { createSlotSlice, type SlotActions } from './slices/slotSlice';
import { createMultiLayerSlice, type MultiLayerActions } from './slices/multiLayerSlice';
import { createFolderSlice, type FolderActions } from './slices/folderSlice';
import { createSelectionSlice, type SelectionActions } from './slices/selectionSlice';
import { createDuplicateSlice, type DuplicateActions } from './slices/duplicateSlice';
import { createProxySlice, type ProxyActions } from './slices/proxySlice';
import { createProjectSlice, type ProjectActions } from './slices/projectSlice';

// Re-export types
export type {
  MediaType,
  ProxyStatus,
  MediaItem,
  MediaFile,
  Composition,
  MediaFolder,
  TextItem,
  SolidItem,
  MeshItem,
  CameraItem,
  LightItem,
  SplatEffectorItem,
  MathSceneItem,
  MotionShapeItem,
  SignalAssetItem,
  SignalAssetItemDiagnostic,
  MeshPrimitiveType,
  SceneCameraSettings,
  SlotClipEndBehavior,
  SlotClipSettings,
  ProjectLoadPhase,
  ProjectLoadProgress,
  ProjectItem,
} from './types';
export { DEFAULT_SCENE_CAMERA_SETTINGS } from './types';

const MESH_ITEM_LABELS: Record<import('./types').MeshPrimitiveType, string> = {
  cube: 'Cube',
  sphere: 'Sphere',
  plane: 'Plane',
  cylinder: 'Cylinder',
  torus: 'Torus',
  cone: 'Cone',
  text3d: '3D Text',
};

const MOTION_SHAPE_LABELS: Record<import('../../types/motionDesign').ShapePrimitive, string> = {
  rectangle: 'Motion Rectangle',
  ellipse: 'Motion Ellipse',
  polygon: 'Motion Polygon',
  star: 'Motion Star',
};

// Combined store type with all actions
type MediaStoreState = MediaState &
  FileImportActions &
  FileManageActions &
  CompositionActions &
  SlotActions &
  MultiLayerActions &
  FolderActions &
  SelectionActions &
  DuplicateActions &
  ProxyActions &
  ProjectActions & {
    getItemsByFolder: (folderId: string | null) => ProjectItem[];
    getItemById: (id: string) => ProjectItem | undefined;
    getFileByName: (name: string) => MediaFile | undefined;
    getOrCreateTextFolder: () => string;
    createTextItem: (name?: string, parentId?: string | null) => string;
    updateTextItem: (id: string, updates: Partial<import('./types').TextItem>) => void;
    removeTextItem: (id: string) => void;
    getOrCreateSolidFolder: () => string;
    createSolidItem: (name?: string, color?: string, parentId?: string | null) => string;
    removeSolidItem: (id: string) => void;
    updateSolidItem: (id: string, updates: Partial<{ color: string; width: number; height: number }>) => void;
    getOrCreateMeshFolder: () => string;
    createMeshItem: (meshType: import('./types').MeshPrimitiveType, name?: string, parentId?: string | null) => string;
    removeMeshItem: (id: string) => void;
    getOrCreateCameraFolder: () => string;
    createCameraItem: (name?: string, parentId?: string | null) => string;
    removeCameraItem: (id: string) => void;
    getOrCreateLightFolder: () => string;
    createLightItem: (name?: string, parentId?: string | null) => string;
    removeLightItem: (id: string) => void;
    getOrCreateSplatEffectorFolder: () => string;
    createSplatEffectorItem: (name?: string, parentId?: string | null) => string;
    removeSplatEffectorItem: (id: string) => void;
    getOrCreateMathSceneFolder: () => string;
    createMathSceneItem: (name?: string, parentId?: string | null) => string;
    removeMathSceneItem: (id: string) => void;
    getOrCreateMotionShapeFolder: () => string;
    createMotionShapeItem: (primitive: import('../../types/motionDesign').ShapePrimitive, name?: string, parentId?: string | null) => string;
    removeMotionShapeItem: (id: string) => void;
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
    cameraItems: [],
    lightItems: [],
    splatEffectorItems: [],
    mathSceneItems: [],
    motionShapeItems: [],
    signalAssets: [],
    signalArtifacts: [],
    signalGraphs: [],
    signalOperators: [],
    activeCompositionId: 'comp-1',
    openCompositionIds: ['comp-1'],
    slotAssignments: {},
    slotDeckStates: {},
    slotClipSettings: {},
    selectedSlotCompositionId: null,
    previewCompositionId: null,
    sourceMonitorFileId: null,
    sourceMonitorPlaybackRequestId: 0,
    sourceMonitorCropRequestId: 0,
    sourceMonitorInPoint: null,
    sourceMonitorOutPoint: null,
    activeLayerSlots: {},
    layerOpacities: {},
    selectedIds: [],
    expandedFolderIds: [],
    currentProjectId: null,
    currentProjectName: 'Untitled Project',
    isLoading: false,
    projectLoadProgress: {
      active: false,
      phase: 'idle',
      percent: 0,
      message: '',
      blocking: false,
    },
    // proxyEnabled is defined in proxySlice
    proxyGenerationQueue: [],
    currentlyGeneratingProxyId: null,
    fileSystemSupported: fileSystemService.isSupported(),
    proxyFolderName: fileSystemService.getProxyFolderName(),

    // Getters
    getItemsByFolder: (folderId: string | null) => {
      const {
        files,
        compositions,
        folders,
        textItems,
        solidItems,
        meshItems,
        cameraItems,
        lightItems,
        splatEffectorItems,
        mathSceneItems,
        motionShapeItems,
        signalAssets,
      } = get();
      return [
        ...folders.filter((f) => f.parentId === folderId),
        ...compositions.filter((c) => c.parentId === folderId && isUserVisibleComposition(c)),
        ...textItems.filter((t) => t.parentId === folderId),
        ...solidItems.filter((s) => s.parentId === folderId),
        ...meshItems.filter((m) => m.parentId === folderId),
        ...cameraItems.filter((c) => c.parentId === folderId),
        ...lightItems.filter((l) => l.parentId === folderId),
        ...splatEffectorItems.filter((e) => e.parentId === folderId),
        ...mathSceneItems.filter((m) => m.parentId === folderId),
        ...motionShapeItems.filter((m) => m.parentId === folderId),
        ...signalAssets.filter((s) => s.parentId === folderId),
        ...files.filter((f) => f.parentId === folderId),
      ];
    },

    getItemById: (id: string) => {
      const {
        files,
        compositions,
        folders,
        textItems,
        solidItems,
        meshItems,
        cameraItems,
        lightItems,
        splatEffectorItems,
        mathSceneItems,
        motionShapeItems,
        signalAssets,
      } = get();
      return (
        files.find((f) => f.id === id) ||
        compositions.find((c) => c.id === id) ||
        folders.find((f) => f.id === id) ||
        textItems.find((t) => t.id === id) ||
        solidItems.find((s) => s.id === id) ||
        meshItems.find((m) => m.id === id) ||
        cameraItems.find((c) => c.id === id) ||
        lightItems.find((l) => l.id === id) ||
        splatEffectorItems.find((e) => e.id === id) ||
        mathSceneItems.find((m) => m.id === id) ||
        motionShapeItems.find((m) => m.id === id) ||
        signalAssets.find((s) => s.id === id)
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
      const label = name?.trim() || `Text ${textItems.length + 1}`;
      const newText = {
        id,
        name: label,
        type: 'text' as const,
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        text: label,
        fontFamily: 'Arial',
        fontSize: 48,
        color: '#ffffff',
        duration: 5, // 5 seconds default
      };
      set({ textItems: [...textItems, newText] });
      return id;
    },

    updateTextItem: (id: string, updates: Partial<import('./types').TextItem>) => {
      set({
        textItems: get().textItems.map(t =>
          t.id === id
            ? {
                ...t,
                ...updates,
                id: t.id,
                type: 'text' as const,
              }
            : t
        ),
      });
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
      const label = MESH_ITEM_LABELS[meshType] || meshType;
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

    getOrCreateCameraFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Cameras' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Cameras', null);
      return newFolder.id;
    },

    createCameraItem: (name?: string, parentId?: string | null) => {
      const { cameraItems } = get();
      const id = `camera-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newCamera: import('./types').CameraItem = {
        id,
        name: name || `Camera ${cameraItems.length + 1}`,
        type: 'camera',
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        duration: 10,
        cameraSettings: { ...DEFAULT_SCENE_CAMERA_SETTINGS },
      };
      set({ cameraItems: [...cameraItems, newCamera] });
      return id;
    },

    removeCameraItem: (id: string) => {
      set({ cameraItems: get().cameraItems.filter(c => c.id !== id) });
    },

    getOrCreateLightFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Lights' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Lights', null);
      return newFolder.id;
    },

    createLightItem: (name?: string, parentId?: string | null) => {
      const { lightItems } = get();
      const id = `light-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newLight: import('./types').LightItem = {
        id,
        name: name || `Light ${lightItems.length + 1}`,
        type: 'light',
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        duration: 10,
        lightSettings: { ...DEFAULT_LIGHT_CLIP_SETTINGS },
      };
      set({ lightItems: [...lightItems, newLight] });
      return id;
    },

    removeLightItem: (id: string) => {
      set({ lightItems: get().lightItems.filter(l => l.id !== id) });
    },

    getOrCreateSplatEffectorFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Effectors' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Effectors', null);
      return newFolder.id;
    },

    createSplatEffectorItem: (name?: string, parentId?: string | null) => {
      const { splatEffectorItems } = get();
      const id = `splat-effector-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newEffector: import('./types').SplatEffectorItem = {
        id,
        name: name || `3D Effector ${splatEffectorItems.length + 1}`,
        type: 'splat-effector',
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        duration: 10,
        splatEffectorSettings: { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
      };
      set({ splatEffectorItems: [...splatEffectorItems, newEffector] });
      return id;
    },

    removeSplatEffectorItem: (id: string) => {
      set({ splatEffectorItems: get().splatEffectorItems.filter(e => e.id !== id) });
    },

    getOrCreateMathSceneFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Math Scenes' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Math Scenes', null);
      return newFolder.id;
    },

    createMathSceneItem: (name?: string, parentId?: string | null) => {
      const { mathSceneItems } = get();
      const id = `math-scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newMathScene: import('./types').MathSceneItem = {
        id,
        name: name || `Math Scene ${mathSceneItems.length + 1}`,
        type: 'math-scene',
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        duration: 5,
      };
      set({ mathSceneItems: [...mathSceneItems, newMathScene] });
      return id;
    },

    removeMathSceneItem: (id: string) => {
      set({ mathSceneItems: get().mathSceneItems.filter((item) => item.id !== id) });
    },

    getOrCreateMotionShapeFolder: () => {
      const { folders, createFolder } = get();
      const existingFolder = folders.find((f) => f.name === 'Motion Shapes' && f.parentId === null);
      if (existingFolder) {
        return existingFolder.id;
      }
      const newFolder = createFolder('Motion Shapes', null);
      return newFolder.id;
    },

    createMotionShapeItem: (primitive: import('../../types/motionDesign').ShapePrimitive, name?: string, parentId?: string | null) => {
      const { motionShapeItems } = get();
      const id = `motion-shape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const label = MOTION_SHAPE_LABELS[primitive] || 'Motion Shape';
      const newMotionShape: import('./types').MotionShapeItem = {
        id,
        name: name || `${label} ${motionShapeItems.filter((item) => item.primitive === primitive).length + 1}`,
        type: 'motion-shape',
        parentId: parentId !== undefined ? parentId : null,
        createdAt: Date.now(),
        primitive,
        duration: 5,
      };
      set({ motionShapeItems: [...motionShapeItems, newMotionShape] });
      return id;
    },

    removeMotionShapeItem: (id: string) => {
      set({ motionShapeItems: get().motionShapeItems.filter((item) => item.id !== id) });
    },

    // Merge all slices
    ...createFileImportSlice(set, get),
    ...createFileManageSlice(set, get),
    ...createCompositionSlice(set, get),
    ...createSlotSlice(set, get),
    ...createMultiLayerSlice(set, get),
    ...createFolderSlice(set, get),
    ...createSelectionSlice(set, get),
    ...createDuplicateSlice(set, get),
    ...createProxySlice(set, get),
    ...createProjectSlice(set, get),
  }))
);

// Register store globally for init.ts to access (avoids circular dependency)
(globalThis as typeof globalThis & {
  __mediaStoreModule?: { useMediaStore: typeof useMediaStore };
}).__mediaStoreModule = { useMediaStore };

// Import init module for side effects (auto-init, autosave, beforeunload)
import './init';

// Export trigger for external use
export { triggerTimelineSave } from './init';
