// Project Save — sync stores to project file format

import { Logger } from '../logger';
import { useMediaStore, type MediaFile, type Composition, type MediaFolder } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import { getExportStoreData, useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { isProxyFrameCountComplete } from '../../stores/mediaStore/helpers/proxyCompleteness';
import type {
  FlashBoardGenerationMetadata,
  FlashBoardStoreState,
  ProjectFlashBoard,
  ProjectFlashBoardNode,
  ProjectFlashBoardState,
} from '../../stores/flashboardStore/types';
import {
  projectFileService,
  type ProjectMediaFile,
  type ProjectComposition,
  type ProjectTrack,
  type ProjectClip,
  type ProjectMarker,
  type ProjectFolder,
} from '../projectFileService';
import { toProjectTransform } from './transformSerialization';
import type {
  SerializableClip,
  SerializableMarker,
  TimelineClip,
} from '../../types';
import type {
  ProjectMediaBoardGroupOffsets,
  ProjectMediaBoardOrder,
  ProjectMediaBoardViewport,
} from './types/project.types';

const log = Logger.create('ProjectSync');
let projectStoreSyncInProgress = false;

type ProjectSaveClip = SerializableClip & {
  source?: TimelineClip['source'];
  mediaId?: string;
  volume?: number;
  audioEnabled?: boolean;
  disabled?: boolean;
};
type ProjectSaveTrack = NonNullable<Composition['timelineData']>['tracks'][number] & {
  locked?: boolean;
};

export function isProjectStoreSyncInProgress(): boolean {
  return projectStoreSyncInProgress;
}

export async function withProjectStoreSyncGuard<T>(work: () => Promise<T>): Promise<T> {
  projectStoreSyncInProgress = true;
  try {
    return await work();
  } finally {
    projectStoreSyncInProgress = false;
  }
}

// ============================================
// CONVERTER HELPERS (store → project format)
// ============================================

function serializeModelSequence(sequence: MediaFile['modelSequence'] | ProjectClip['modelSequence']) {
  return sequence
    ? {
        ...sequence,
        frames: sequence.frames.map((frame) => ({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath,
        })),
      }
    : undefined;
}

function serializeGaussianSplatSequence(
  sequence: MediaFile['gaussianSplatSequence'] | ProjectClip['gaussianSplatSequence'],
) {
  return sequence
    ? {
        ...sequence,
        frames: sequence.frames.map((frame) => ({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath,
          splatCount: frame.splatCount,
          fileSize: frame.fileSize,
          container: frame.container,
          codec: frame.codec,
        })),
      }
    : undefined;
}

/**
 * Convert mediaStore files to ProjectMediaFile format
 */
function convertMediaFiles(files: MediaFile[]): ProjectMediaFile[] {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    type: file.type as 'video' | 'audio' | 'image' | 'model' | 'gaussian-splat' | 'lottie' | 'rive',
    sourcePath: file.filePath || file.name,
    projectPath: file.projectPath,
    fileHash: file.fileHash,
    duration: file.duration,
    width: file.width,
    height: file.height,
    frameRate: file.fps,
    codec: file.codec ?? file.gaussianSplatSequence?.codec,
    audioCodec: file.audioCodec,
    container: file.container ?? (file.gaussianSplatSequence?.container ? `${file.gaussianSplatSequence.container} Seq` : undefined),
    bitrate: file.bitrate,
    fileSize: file.fileSize ?? file.gaussianSplatSequence?.totalFileSize,
    hasAudio: file.hasAudio,
    splatCount: file.splatCount ?? file.gaussianSplatSequence?.frames[0]?.splatCount,
    totalSplatCount: file.totalSplatCount ?? file.gaussianSplatSequence?.totalSplatCount,
    splatFrameCount: file.splatFrameCount ?? file.gaussianSplatSequence?.frameCount,
    hasProxy:
      file.proxyStatus === 'ready' &&
      isProxyFrameCountComplete(file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps),
    vectorAnimation: file.vectorAnimation,
    modelSequence: serializeModelSequence(file.modelSequence),
    gaussianSplatSequence: serializeGaussianSplatSequence(file.gaussianSplatSequence),
    folderId: file.parentId,
    labelColor: file.labelColor && file.labelColor !== 'none' ? file.labelColor : undefined,
    importedAt: new Date(file.createdAt).toISOString(),
  }));
}

/**
 * Convert mediaStore folders to ProjectFolder format
 */
function convertFolders(folders: MediaFolder[]): ProjectFolder[] {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    labelColor: folder.labelColor && folder.labelColor !== 'none' ? folder.labelColor : undefined,
  }));
}

/**
 * Convert compositions to ProjectComposition format
 */
function convertCompositions(compositions: Composition[]): ProjectComposition[] {
  return compositions.map((comp) => {
    const timelineData = comp.timelineData;

    // Convert tracks
    const tracks: ProjectTrack[] = ((timelineData?.tracks || []) as ProjectSaveTrack[]).map((t) => ({
      id: t.id,
      name: t.name,
      type: t.type,
      height: t.height || 60,
      locked: t.locked || false,
      visible: t.visible !== false,
      muted: t.muted || false,
      solo: t.solo || false,
    }));

    // Convert clips
    const clips: ProjectClip[] = ((timelineData?.clips || []) as ProjectSaveClip[]).map((c) => ({
      id: c.id,
      trackId: c.trackId,
      name: c.name || '',
      mediaId: c.source?.mediaFileId || c.mediaFileId || c.mediaId || '',
      sourceType: c.source?.type || c.sourceType || 'video',
      naturalDuration: c.source?.naturalDuration || c.naturalDuration,
      thumbnails: c.thumbnails,
      linkedClipId: c.linkedClipId,
      linkedGroupId: c.linkedGroupId,
      waveform: c.waveform,
      modelSequence: serializeModelSequence(c.source?.modelSequence || c.modelSequence),
      gaussianSplatSequence: serializeGaussianSplatSequence(c.source?.gaussianSplatSequence || c.gaussianSplatSequence),
      meshType: c.source?.meshType || c.meshType,
      text3DProperties: c.source?.text3DProperties || c.text3DProperties,
      cameraSettings: c.source?.cameraSettings || c.cameraSettings,
      splatEffectorSettings: c.source?.splatEffectorSettings || c.splatEffectorSettings,
      threeDEffectorsEnabled: c.source?.threeDEffectorsEnabled,
      gaussianBlendshapes: c.source?.gaussianBlendshapes || c.gaussianBlendshapes,
      gaussianSplatSettings: c.source?.gaussianSplatSettings || c.gaussianSplatSettings,
      is3D: c.is3D || undefined,
      startTime: c.startTime,
      duration: c.duration,
      inPoint: c.inPoint || 0,
      outPoint: c.outPoint || c.duration,
      transform: toProjectTransform(c.transform),
      effects: (c.effects || []).map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name || e.type,
        enabled: e.enabled !== false,
        params: e.params || {},
      })),
      masks: (c.masks || []).map((m) => ({
        id: m.id,
        name: m.name || 'Mask',
        mode: m.mode || 'add',
        inverted: m.inverted || false,
        opacity: m.opacity ?? 1,
        feather: m.feather || 0,
        featherQuality: m.featherQuality ?? 50,
        enabled: m.enabled !== false,
        visible: m.visible !== false,
        closed: m.closed !== false,
        vertices: (m.vertices || []).map((vertex) => ({
          x: vertex.x,
          y: vertex.y,
          inTangent: vertex.handleIn ?? { x: 0, y: 0 },
          outTangent: vertex.handleOut ?? { x: 0, y: 0 },
          handleMode: vertex.handleMode,
        })),
        position: m.position || { x: 0, y: 0 },
      })),
      keyframes: c.keyframes || [],
      volume: c.volume ?? 1,
      audioEnabled: c.audioEnabled !== false,
      reversed: c.reversed || false,
      disabled: c.disabled || false,
      speed: c.speed,
      preservesPitch: c.preservesPitch,
      // Nested composition support
      isComposition: c.isComposition || undefined,
      compositionId: c.compositionId || undefined,
      // Text clip support
      textProperties: c.textProperties || undefined,
      // Solid clip support
      solidColor: c.solidColor || undefined,
      vectorAnimationSettings: c.source?.vectorAnimationSettings || c.vectorAnimationSettings || undefined,
      // Transcript data
      transcript: c.transcript || undefined,
      transcriptStatus: c.transcriptStatus || undefined,
      // Analysis data
      analysis: c.analysis || undefined,
      analysisStatus: c.analysisStatus || undefined,
      // AI scene description data
      sceneDescriptions: c.sceneDescriptions || undefined,
      sceneDescriptionStatus: c.sceneDescriptionStatus || undefined,
    }));

    const markers: ProjectMarker[] = ((timelineData?.markers || []) as SerializableMarker[]).map((marker) => ({
      id: marker.id,
      time: marker.time,
      name: marker.label || '',
      color: marker.color || '#2997E5',
      duration: 0,
      stopPlayback: marker.stopPlayback === true ? true : undefined,
      midiBindings: marker.midiBindings || undefined,
    }));

    return {
      id: comp.id,
      name: comp.name,
      width: comp.width,
      height: comp.height,
      frameRate: comp.frameRate,
      duration: comp.duration,
      backgroundColor: comp.backgroundColor,
      folderId: comp.parentId,
      labelColor: comp.labelColor && comp.labelColor !== 'none' ? comp.labelColor : undefined,
      tracks,
      clips,
      markers,
    };
  });
}

function serializeFlashBoardState(state: FlashBoardStoreState): ProjectFlashBoardState {
  const generationMetadataByMediaId: Record<string, FlashBoardGenerationMetadata> = {};

  const boards: ProjectFlashBoard[] = state.boards
    .filter((board) => board.nodes.length > 0)
    .map((board) => {
      const nodes: ProjectFlashBoardNode[] = board.nodes.map((node) => {
        if (node.result?.mediaFileId && node.request) {
          generationMetadataByMediaId[node.result.mediaFileId] = {
            mediaFileId: node.result.mediaFileId,
            providerId: node.request.providerId,
            version: node.request.version,
            prompt: node.request.prompt,
            negativePrompt: node.request.negativePrompt,
            duration: node.request.duration,
            aspectRatio: node.request.aspectRatio,
            generateAudio: node.request.generateAudio,
            multiShots: node.request.multiShots,
            multiPrompt: node.request.multiPrompt,
            startMediaFileId: node.request.startMediaFileId,
            endMediaFileId: node.request.endMediaFileId,
            referenceMediaFileIds: node.request.referenceMediaFileIds,
            createdAt: new Date(node.createdAt).toISOString(),
          };
        }

        let job: ProjectFlashBoardNode['job'];
        if (node.job) {
          const { remoteTaskId: _remoteTaskId, ...rest } = node.job;
          job = rest;
        }

        return {
          id: node.id,
          kind: node.kind,
          createdAt: new Date(node.createdAt).toISOString(),
          updatedAt: new Date(node.updatedAt).toISOString(),
          position: node.position,
          size: node.size,
          request: node.request,
          job,
          result: node.result,
        };
      });

      return {
        id: board.id,
        name: board.name,
        createdAt: new Date(board.createdAt).toISOString(),
        updatedAt: new Date(board.updatedAt).toISOString(),
        viewport: board.viewport,
        nodes,
      };
    });

  return {
    version: 1,
    activeBoardId: state.activeBoardId,
    boards,
    generationMetadataByMediaId,
  };
}

function parseLocalStorageJson<T>(key: string): T | undefined {
  const raw = localStorage.getItem(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function readMediaPanelViewMode(): 'classic' | 'icons' | 'board' | undefined {
  const raw = localStorage.getItem('media-panel-view-mode');
  if (raw === 'classic' || raw === 'icons' || raw === 'board') return raw;
  if (raw === 'grid') return 'icons';
  if (raw === 'list') return 'classic';
  return undefined;
}

// ============================================
// SYNC & SAVE
// ============================================

/**
 * Sync current store state to projectFileService
 */
export async function syncStoresToProject(): Promise<void> {
  await withProjectStoreSyncGuard(async () => {
    const mediaState = useMediaStore.getState();
    const timelineStore = useTimelineStore.getState();

    // Save current timeline to active composition first
    if (mediaState.activeCompositionId) {
      const timelineData = timelineStore.getSerializableState();
      useMediaStore.setState((state) => ({
        compositions: state.compositions.map((c) =>
          c.id === mediaState.activeCompositionId ? { ...c, timelineData } : c
        ),
      }));
    }

    // Get fresh state after update
    const freshState = useMediaStore.getState();

    // Update project file data
    projectFileService.updateMedia(convertMediaFiles(freshState.files));
    projectFileService.updateCompositions(convertCompositions(freshState.compositions));
    projectFileService.updateFolders(convertFolders(freshState.folders));

    // Update active state
    const projectData = projectFileService.getProjectData();
    if (projectData) {
      projectData.activeCompositionId = freshState.activeCompositionId;
      projectData.openCompositionIds = freshState.openCompositionIds;
      projectData.expandedFolderIds = freshState.expandedFolderIds;
      projectData.slotAssignments = freshState.slotAssignments;
      projectData.slotClipSettings = freshState.slotClipSettings;

      // Save YouTube panel state
      const youtubeState = useYouTubeStore.getState().getState();
      projectData.youtube = youtubeState;

      // Save UI state (dock layout + composition view states)
      const dockLayout = useDockStore.getState().getLayoutForProject();

      // Build composition view state from all compositions
      const compositionViewState: Record<string, {
        playheadPosition?: number;
        zoom?: number;
        scrollX?: number;
        inPoint?: number | null;
        outPoint?: number | null;
      }> = {};

      // Get current timeline state for active composition
      const timelineState = useTimelineStore.getState();
      if (freshState.activeCompositionId) {
        compositionViewState[freshState.activeCompositionId] = {
          playheadPosition: timelineState.playheadPosition,
          zoom: timelineState.zoom,
          scrollX: timelineState.scrollX,
          inPoint: timelineState.inPoint,
          outPoint: timelineState.outPoint,
        };
      }

      // Also save view state from other compositions' timelineData
      for (const comp of freshState.compositions) {
        if (comp.id !== freshState.activeCompositionId && comp.timelineData) {
          compositionViewState[comp.id] = {
            playheadPosition: comp.timelineData.playheadPosition,
            zoom: comp.timelineData.zoom,
            scrollX: comp.timelineData.scrollX,
            inPoint: comp.timelineData.inPoint,
            outPoint: comp.timelineData.outPoint,
          };
        }
      }

      // Capture per-project UI settings from localStorage
      const mediaPanelColumns = localStorage.getItem('media-panel-column-order');
      const mediaPanelNameWidth = localStorage.getItem('media-panel-name-width');
      const mediaPanelViewMode = readMediaPanelViewMode();
      const mediaPanelBoardViewport = parseLocalStorageJson<ProjectMediaBoardViewport>('media-panel-board-viewport');
      const mediaPanelBoardOrder = parseLocalStorageJson<ProjectMediaBoardOrder>('media-panel-board-order');
      const mediaPanelBoardGroupOffsets = parseLocalStorageJson<ProjectMediaBoardGroupOffsets>('media-panel-board-group-offsets');
      const transcriptLanguage = localStorage.getItem('transcriptLanguage');
      const settingsState = useSettingsStore.getState();
      const midiState = useMIDIStore.getState();

      projectData.uiState = {
        dockLayout,
        compositionViewState,
        mediaPanelColumns: mediaPanelColumns ? parseLocalStorageJson<string[]>('media-panel-column-order') : undefined,
        mediaPanelNameWidth: mediaPanelNameWidth ? parseInt(mediaPanelNameWidth, 10) : undefined,
        mediaPanelViewMode,
        mediaPanelBoardViewport,
        mediaPanelBoardOrder,
        mediaPanelBoardGroupOffsets,
        transcriptLanguage: transcriptLanguage || undefined,
        thumbnailsEnabled: timelineState.thumbnailsEnabled,
        waveformsEnabled: timelineState.waveformsEnabled,
        proxyEnabled: useMediaStore.getState().proxyEnabled,
        showTranscriptMarkers: timelineState.showTranscriptMarkers,
        showChangelogOnStartup: settingsState.showChangelogOnStartup,
        lastSeenChangelogVersion: settingsState.lastSeenChangelogVersion,
        midi: {
          isEnabled: midiState.isEnabled,
          transportBindings: {
            playPause: midiState.transportBindings.playPause,
            stop: midiState.transportBindings.stop,
          },
          slotBindings: midiState.slotBindings,
          parameterBindings: midiState.parameterBindings,
        },
        exportState: getExportStoreData(useExportStore.getState()),
      };

      // Save generated media items
      projectData.textItems = freshState.textItems;
      projectData.solidItems = freshState.solidItems;
      projectData.meshItems = freshState.meshItems;
      projectData.cameraItems = freshState.cameraItems;
      projectData.splatEffectorItems = freshState.splatEffectorItems;

      const flashBoardState = useFlashBoardStore.getState();
      const hasBoardsToPersist = flashBoardState.boards.some((board) => board.nodes.length > 0);
      if (hasBoardsToPersist) {
        projectData.flashboard = serializeFlashBoardState(flashBoardState);
      } else {
        delete projectData.flashboard;
      }
    }

    log.info(' Synced stores to project');
  });
}

/**
 * Save current project
 */
export async function saveCurrentProject(): Promise<boolean> {
  if (!projectFileService.isProjectOpen()) {
    log.error(' No project open');
    return false;
  }

  await syncStoresToProject();
  return await projectFileService.saveProject();
}
