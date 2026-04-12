// Project Save — sync stores to project file format

import { Logger } from '../logger';
import { useMediaStore, type MediaFile, type Composition, type MediaFolder } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { useYouTubeStore } from '../../stores/youtubeStore';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
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

const log = Logger.create('ProjectSync');

// ============================================
// CONVERTER HELPERS (store → project format)
// ============================================

/**
 * Convert mediaStore files to ProjectMediaFile format
 */
function convertMediaFiles(files: MediaFile[]): ProjectMediaFile[] {
  return files.map((file) => ({
    id: file.id,
    name: file.name,
    type: file.type as 'video' | 'audio' | 'image',
    sourcePath: file.filePath || file.name,
    projectPath: file.projectPath,
    duration: file.duration,
    width: file.width,
    height: file.height,
    frameRate: file.fps,
    codec: file.codec,
    audioCodec: file.audioCodec,
    container: file.container,
    bitrate: file.bitrate,
    fileSize: file.fileSize,
    hasAudio: file.hasAudio,
    hasProxy: file.proxyStatus === 'ready',
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
    const tracks: ProjectTrack[] = (timelineData?.tracks || []).map((t: any) => ({
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
    const clips: ProjectClip[] = (timelineData?.clips || []).map((c: any) => ({
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
      meshType: c.source?.meshType || c.meshType,
      text3DProperties: c.source?.text3DProperties || c.text3DProperties,
      cameraSettings: c.source?.cameraSettings || c.cameraSettings,
      splatEffectorSettings: c.source?.splatEffectorSettings || c.splatEffectorSettings,
      gaussianBlendshapes: c.source?.gaussianBlendshapes || c.gaussianBlendshapes,
      gaussianSplatSettings: c.source?.gaussianSplatSettings || c.gaussianSplatSettings,
      is3D: c.is3D || undefined,
      startTime: c.startTime,
      duration: c.duration,
      inPoint: c.inPoint || 0,
      outPoint: c.outPoint || c.duration,
      transform: toProjectTransform(c.transform),
      effects: (c.effects || []).map((e: any) => ({
        id: e.id,
        type: e.type,
        name: e.name || e.type,
        enabled: e.enabled !== false,
        params: e.params || {},
      })),
      masks: (c.masks || []).map((m: any) => ({
        id: m.id,
        name: m.name || 'Mask',
        mode: m.mode || 'add',
        inverted: m.inverted || false,
        opacity: m.opacity ?? 1,
        feather: m.feather || 0,
        featherQuality: m.featherQuality || 8,
        visible: m.visible !== false,
        closed: m.closed !== false,
        vertices: m.vertices || [],
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

    // Note: markers not currently stored in CompositionTimelineData
    const markers: ProjectMarker[] = [];

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

// ============================================
// SYNC & SAVE
// ============================================

/**
 * Sync current store state to projectFileService
 */
export async function syncStoresToProject(): Promise<void> {
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
    const transcriptLanguage = localStorage.getItem('transcriptLanguage');
    const settingsState = useSettingsStore.getState();

    projectData.uiState = {
      dockLayout,
      compositionViewState,
      mediaPanelColumns: mediaPanelColumns ? JSON.parse(mediaPanelColumns) : undefined,
      mediaPanelNameWidth: mediaPanelNameWidth ? parseInt(mediaPanelNameWidth, 10) : undefined,
      transcriptLanguage: transcriptLanguage || undefined,
      thumbnailsEnabled: timelineState.thumbnailsEnabled,
      waveformsEnabled: timelineState.waveformsEnabled,
      proxyEnabled: useMediaStore.getState().proxyEnabled,
      showTranscriptMarkers: timelineState.showTranscriptMarkers,
      showChangelogOnStartup: settingsState.showChangelogOnStartup,
      lastSeenChangelogVersion: settingsState.lastSeenChangelogVersion,
    };

    // Save generated media items
    (projectData as any).textItems = freshState.textItems;
    (projectData as any).solidItems = freshState.solidItems;
    (projectData as any).meshItems = freshState.meshItems;
    (projectData as any).cameraItems = freshState.cameraItems;
    (projectData as any).splatEffectorItems = freshState.splatEffectorItems;
  }

  log.info(' Synced stores to project');
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
