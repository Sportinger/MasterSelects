// Project UI/runtime actions. Project-file save/load lives in ProjectFileService.

import type { Composition, MediaSliceCreator } from '../types';
import { DEFAULT_COMPOSITION } from '../constants';
import { fileSystemService } from '../../../services/fileSystemService';
import { useTimelineStore } from '../../timeline';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { Logger } from '../../../services/logger';
import { restoreLegacyStartupMediaState } from '../legacyStartupRestore';
import {
  revokeAllMediaObjectUrls,
  revokeMediaFileObjectUrls,
} from '../../../services/project/mediaObjectUrlManager';

const log = Logger.create('Project');

export interface ProjectActions {
  initFromDB: () => Promise<void>;
  newProject: () => void;
  setProjectName: (name: string) => void;
  pickProxyFolder: () => Promise<FileSystemDirectoryHandle | null>;
  showInExplorer: (type: 'raw' | 'proxy', mediaFileId?: string) => Promise<{ success: boolean; message: string }>;
}

export const createProjectSlice: MediaSliceCreator<ProjectActions> = (set, get) => ({
  setProjectName: (name: string) => {
    set({ currentProjectName: name });
  },

  pickProxyFolder: async () => {
    const result = await fileSystemService.pickProxyFolder();
    if (result) {
      set({ proxyFolderName: fileSystemService.getProxyFolderName() });
    }
    return result;
  },

  showInExplorer: async (type: 'raw' | 'proxy', mediaFileId?: string) => {
    return fileSystemService.showInExplorer(type, mediaFileId);
  },

  initFromDB: () => restoreLegacyStartupMediaState(set, get),

  newProject: () => {
    const previousFiles = get().files;

    // Clear timeline first
    const timelineStore = useTimelineStore.getState();
    timelineStore.clearTimeline();

    // Clear the render frame
    renderHostPort.clearFrame();

    previousFiles.forEach((file) => {
      revokeMediaFileObjectUrls(file);
    });
    revokeAllMediaObjectUrls();

    // Create new default composition
    const newCompId = `comp-${Date.now()}`;
    const newComposition: Composition = {
      ...DEFAULT_COMPOSITION,
      id: newCompId,
      createdAt: Date.now(),
    };

    // Reset all state
    set({
      files: [],
      compositions: [newComposition],
      folders: [],
      textItems: [],
      solidItems: [],
      meshItems: [],
      cameraItems: [],
      splatEffectorItems: [],
      mathSceneItems: [],
      motionShapeItems: [],
      signalAssets: [],
      signalArtifacts: [],
      signalGraphs: [],
      signalOperators: [],
      activeCompositionId: newCompId,
      openCompositionIds: [newCompId],
      selectedIds: [],
      expandedFolderIds: [],
      slotAssignments: {},
      slotDeckStates: {},
      slotClipSettings: {},
      selectedSlotCompositionId: null,
      activeLayerSlots: {},
      layerOpacities: {},
      currentProjectId: null,
      currentProjectName: 'Untitled Project',
      proxyEnabled: false,
      proxyGenerationQueue: [],
      currentlyGeneratingProxyId: null,
    });

    // Clear persisted items
    localStorage.removeItem('ms-textItems');
    localStorage.removeItem('ms-solidItems');
    localStorage.removeItem('ms-meshItems');
    localStorage.removeItem('ms-cameraItems');
    localStorage.removeItem('ms-splatEffectorItems');
    localStorage.removeItem('ms-mathSceneItems');
    localStorage.removeItem('ms-motionShapeItems');

    // Load empty timeline
    timelineStore.loadState(undefined);

    log.info('New project created');
  },

});
