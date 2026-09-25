import { convertCompositions } from './projectCompositionSerialization';
// Project Save — sync stores to project file format

import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import {
  mergeSignalArtifacts,
  signalAssetItemToProjectMetadata,
} from '../../stores/mediaStore/helpers/signalItems';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  getActiveFlashBoardAIWorkspaceId,
  getFlashBoardActiveGenerationRecords,
  getFlashBoardAIWorkspaces,
  getFlashBoardChatMessages,
  getFlashBoardComposerState,
  getFlashBoardPromptHistory,
  type FlashBoardActiveGenerationRecord,
} from '../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardAIWorkspace,
  FlashBoardChatMessage,
  FlashBoardComposerState,
  FlashBoardPromptHistoryEntry,
} from '../../stores/flashboardStore/types';
import { getExportStoreData, useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { recordHistoryEvent, serializeHistoryStateForProject } from '../../stores/historyStore';
import { buildProjectAudioStateIndex } from '../audio/projectAudioState';
import { createCurrentAudioArtifactStore } from '../audio/timelineWaveformPyramidCache';
import { flashBoardMediaBridge } from '../flashboard/FlashBoardMediaBridge';
import { syncTransitionCompositionTimelineToParent } from '../../stores/mediaStore/slices/composition/transitionCompositionSync';
import type {
  ProjectFlashBoardAIWorkspace,
  ProjectFlashBoardComposerState,
  ProjectFlashBoardGenerationMetadata,
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardPromptHistoryEntry,
  ProjectFlashBoardState,
} from './types/flashboard.types';
import { serializeFlashBoardChatMessage } from './flashBoardChatProjectCodec';
import {
  projectFileService,
} from '../projectFileService';
import { shouldBlockDestructiveStoreSync } from './destructiveStoreSyncGuard';
import {
  convertFolders,
  convertMediaFiles,
} from './projectMediaSerialization';
import {
  isProjectStoreSyncInProgress,
  withProjectStoreDirtyMarkSuppressed,
  withProjectStoreSyncGuard,
} from './projectStoreSyncGuard';
import { persistFlashBoardChatJournal } from './flashBoardChatProjectJournal';
import {
  getStoryboardProjectSnapshot,
  reconcileStoryboardTimelineClips,
} from '../../stores/storyboardStore';
import { getSeedancePreproductionProjectState } from '../../stores/seedancePreproductionStore';
import { useTrackingStore } from '../../stores/trackingStore';
import { useDocumentsStore } from '../../stores/documentsStore';
import { writeDocumentsManifest } from '../documents/documentArtifacts';
import { cloneTrackingAssets, ensureLegacyTrackingAssets } from '../planarTracking/trackingAssets';
import {
  collectLegacyMediaArtifactSeeds,
  persistLegacyMediaArtifactSeeds,
} from './load/loadMediaArtifactMigration';
import type {
  ProjectMediaBoardGroupOffsets,
  ProjectMediaBoardNodeLayout,
  ProjectMediaBoardOrder,
  ProjectMediaBoardViewport,
} from './types/project.types';

const log = Logger.create('ProjectSync');
export {
  isProjectStoreDirtyMarkSuppressed,
  isProjectStoreSyncInProgress,
  withProjectStoreSyncGuard,
} from './projectStoreSyncGuard';
export interface SaveCurrentProjectOptions {
  source?: 'manual' | 'autosave';
  label?: string;
}

function serializeFlashBoardGenerationRecord(
  record: FlashBoardActiveGenerationRecord,
): ProjectFlashBoardGenerationRecord {
  return {
    id: record.id,
    workspaceId: record.workspaceId,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    request: record.request,
    job: record.job,
    outputs: record.outputs,
    result: record.result,
    results: record.results,
  };
}

function serializeFlashBoardComposerState(
  composer: FlashBoardComposerState,
): ProjectFlashBoardComposerState {
  return {
    isOpen: composer.isOpen,
    draftPrompt: composer.draftPrompt,
    service: composer.service,
    providerId: composer.providerId,
    version: composer.version,
    outputType: composer.outputType,
    mode: composer.mode,
    duration: composer.duration,
    aspectRatio: composer.aspectRatio,
    imageSize: composer.imageSize,
    generateAudio: composer.generateAudio,
    multiShots: composer.multiShots,
    multiPrompt: composer.multiPrompt,
    voiceId: composer.voiceId,
    voiceName: composer.voiceName,
    languageOverride: composer.languageOverride,
    languageCode: composer.languageCode,
    outputFormat: composer.outputFormat,
    videoOutputFormat: composer.videoOutputFormat,
    webSearch: composer.webSearch,
    returnLastFrame: composer.returnLastFrame,
    voiceSettings: composer.voiceSettings,
    sunoCustomMode: composer.sunoCustomMode,
    sunoInstrumental: composer.sunoInstrumental,
    sunoStyle: composer.sunoStyle,
    sunoTitle: composer.sunoTitle,
    sunoNegativeTags: composer.sunoNegativeTags,
    sunoVocalGender: composer.sunoVocalGender,
    sunoStyleWeight: composer.sunoStyleWeight,
    sunoWeirdnessConstraint: composer.sunoWeirdnessConstraint,
    sunoAudioWeight: composer.sunoAudioWeight,
    startMediaFileId: composer.startMediaFileId,
    endMediaFileId: composer.endMediaFileId,
    referenceMediaFileIds: composer.referenceMediaFileIds,
    modelSettingsByKey: composer.modelSettingsByKey,
  };
}

function serializeFlashBoardAIWorkspace(
  workspace: FlashBoardAIWorkspace,
): ProjectFlashBoardAIWorkspace {
  return {
    id: workspace.id,
    title: workspace.title,
    kind: workspace.kind,
    createdAt: new Date(workspace.createdAt).toISOString(),
    updatedAt: new Date(workspace.updatedAt).toISOString(),
    chatConversationRef: workspace.chatConversationRef,
    composer: serializeFlashBoardComposerState(workspace.composer),
    chatMessages: workspace.chatMessages.map(serializeFlashBoardChatMessage),
  };
}

function serializeFlashBoardPromptHistoryEntry(
  entry: FlashBoardPromptHistoryEntry,
): ProjectFlashBoardPromptHistoryEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    prompt: entry.prompt,
    createdAt: new Date(entry.createdAt).toISOString(),
  };
}

function serializeFlashBoardState(
  records: FlashBoardActiveGenerationRecord[],
  composer: FlashBoardComposerState,
  promptHistory: FlashBoardPromptHistoryEntry[],
  chatMessages: FlashBoardChatMessage[],
  workspaces: FlashBoardAIWorkspace[],
  activeWorkspaceId: string,
): ProjectFlashBoardState {
  const generationMetadataByMediaId: Record<string, ProjectFlashBoardGenerationMetadata> = {
    ...flashBoardMediaBridge.serializeMetadata(),
  };

  for (const record of records) {
    for (const result of record.results ?? (record.result ? [record.result] : [])) {
      if (!result.mediaFileId || !record.request) continue;
      generationMetadataByMediaId[result.mediaFileId] = {
        mediaFileId: result.mediaFileId,
        workspaceId: record.workspaceId,
        generationElapsedMs: Math.max(
          0,
          (record.job?.completedAt ?? record.updatedAt) - (record.job?.startedAt ?? record.createdAt),
        ),
        service: record.request.service,
        providerId: record.request.providerId,
        version: record.request.version,
        outputType: record.request.outputType,
        mediaType: result.mediaType,
        mode: record.request.mode,
        originalPrompt: record.request.originalPrompt,
        prompt: record.request.prompt,
        negativePrompt: record.request.negativePrompt,
        duration: record.request.duration,
        aspectRatio: record.request.aspectRatio,
        imageSize: record.request.imageSize,
        generateAudio: record.request.generateAudio,
        multiShots: record.request.multiShots,
        multiPrompt: record.request.multiPrompt,
        voiceId: record.request.voiceId,
        voiceName: record.request.voiceName,
        languageOverride: record.request.languageOverride,
        languageCode: record.request.languageCode,
        outputFormat: record.request.outputFormat,
        voiceSettings: record.request.voiceSettings,
        sunoCustomMode: record.request.sunoCustomMode,
        sunoInstrumental: record.request.sunoInstrumental,
        sunoStyle: record.request.sunoStyle,
        sunoTitle: record.request.sunoTitle,
        sunoNegativeTags: record.request.sunoNegativeTags,
        sunoVocalGender: record.request.sunoVocalGender,
        sunoStyleWeight: record.request.sunoStyleWeight,
        sunoWeirdnessConstraint: record.request.sunoWeirdnessConstraint,
        sunoAudioWeight: record.request.sunoAudioWeight,
        startMediaFileId: record.request.startMediaFileId,
        endMediaFileId: record.request.endMediaFileId,
        referenceMediaFileIds: record.request.referenceMediaFileIds,
        createdAt: new Date(record.createdAt).toISOString(),
      };
    }
  }

  return {
    version: 2,
    composer: serializeFlashBoardComposerState(composer),
    promptHistory: promptHistory.map(serializeFlashBoardPromptHistoryEntry),
    chatMessages: chatMessages.map(serializeFlashBoardChatMessage),
    workspaces: workspaces.map(serializeFlashBoardAIWorkspace),
    activeWorkspaceId,
    generationRecords: records.map(serializeFlashBoardGenerationRecord),
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

    // Source artifacts used to live on timeline clips. Persist every legacy
    // copy before serializing the active timeline or stripping clip copies.
    // A failed migration aborts the save so the only surviving copy cannot be
    // overwritten by a smaller project.json.
    const legacyArtifactSeeds = collectLegacyMediaArtifactSeeds({
      media: mediaState.files,
      compositions: mediaState.compositions.map(composition => ({
        clips: composition.id === mediaState.activeCompositionId
          ? timelineStore.clips
          : composition.timelineData?.clips ?? [],
      })),
    });
    await persistLegacyMediaArtifactSeeds(legacyArtifactSeeds);

    // Save current timeline to active composition first
    if (mediaState.activeCompositionId) {
      const activeCompositionId = mediaState.activeCompositionId;
      const timelineData = timelineStore.getSerializableState();
      withProjectStoreDirtyMarkSuppressed(() => {
        useMediaStore.setState((state) => ({
          compositions: syncTransitionCompositionTimelineToParent(
            state.compositions.map((c) =>
              c.id === activeCompositionId
                ? { ...c, duration: timelineData.duration, timelineData }
                : c
            ),
            activeCompositionId,
            timelineData,
          ),
        }));
      });
    }

    // Get fresh state after update
    const freshState = useMediaStore.getState();
    const projectData = projectFileService.getProjectData();

    if (projectData && shouldBlockDestructiveStoreSync(projectData, freshState)) {
      log.warn('Skipped destructive project sync from stale store state', {
        projectMediaCount: projectData.media.length,
        storeMediaCount: freshState.files.length,
        projectFolderCount: projectData.folders.length,
        storeFolderCount: freshState.folders.length,
        projectCompositionCount: projectData.compositions.length,
        storeCompositionCount: freshState.compositions.length,
      });
      return;
    }

    ensureLegacyTrackingAssets();

    // Update project file data
    const projectMedia = convertMediaFiles(freshState.files);
    const projectCompositions = convertCompositions(freshState.compositions);
    projectFileService.updateMedia(projectMedia);
    projectFileService.updateCompositions(projectCompositions);
    projectFileService.updateFolders(convertFolders(freshState.folders));

    // Update active state
    if (projectData) {
      const trackingAssets = cloneTrackingAssets(useTrackingStore.getState().assets);
      if (trackingAssets.length > 0) {
        projectData.trackingAssets = trackingAssets;
      } else {
        delete projectData.trackingAssets;
      }
      projectData.activeCompositionId = freshState.activeCompositionId;
      projectData.openCompositionIds = freshState.openCompositionIds;
      projectData.expandedFolderIds = freshState.expandedFolderIds;
      projectData.slotAssignments = freshState.slotAssignments;
      projectData.slotClipSettings = freshState.slotClipSettings;

      let audioArtifactStore: ReturnType<typeof createCurrentAudioArtifactStore> | undefined;
      try {
        audioArtifactStore = createCurrentAudioArtifactStore();
      } catch (error) {
        log.warn('Could not open audio artifact store while building project audio index', error);
      }
      const projectAudioState = await buildProjectAudioStateIndex({
        media: projectMedia,
        compositions: projectCompositions,
        activeCompositionId: freshState.activeCompositionId,
        artifactStore: audioArtifactStore,
      });
      if (projectAudioState) {
        projectData.audio = projectAudioState;
      } else {
        delete projectData.audio;
      }

      const signalAssets = freshState.signalAssets ?? [];
      const signalArtifacts = signalAssets.reduce(
        (artifacts, item) => mergeSignalArtifacts(artifacts, item.artifacts),
        freshState.signalArtifacts ?? [],
      );
      const signalGraphs = freshState.signalGraphs ?? [];
      const signalOperators = freshState.signalOperators ?? [];
      if (
        signalAssets.length > 0 ||
        signalArtifacts.length > 0 ||
        signalGraphs.length > 0 ||
        signalOperators.length > 0
      ) {
        projectData.signals = {
          schemaVersion: 1,
          assets: signalAssets.map((item) => item.asset),
          artifacts: signalArtifacts,
          graphs: signalGraphs,
          operators: signalOperators,
          assetItems: signalAssets.map(signalAssetItemToProjectMetadata),
          updatedAt: new Date().toISOString(),
        };
      } else {
        delete projectData.signals;
      }

      Reflect.deleteProperty(projectData, 'youtube');

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
      const mediaPanelBoardLayouts = parseLocalStorageJson<Record<string, ProjectMediaBoardNodeLayout>>('media-panel-board-layouts');
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
        mediaPanelBoardLayouts,
        transcriptLanguage: transcriptLanguage || undefined,
        thumbnailsEnabled: timelineState.thumbnailsEnabled,
        waveformsEnabled: timelineState.waveformsEnabled,
        audioDisplayMode: timelineState.audioDisplayMode,
        audioFocusMode: timelineState.audioFocusMode,
        trackFocusMode: timelineState.trackFocusMode,
        trackHeaderWidth: timelineState.trackHeaderWidth,
        timelineSplitRatio: timelineState.timelineSplitRatio,
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
        history: serializeHistoryStateForProject(),
      };

      // Save generated media items
      projectData.textItems = freshState.textItems;
      projectData.solidItems = freshState.solidItems;
      projectData.meshItems = freshState.meshItems;
      projectData.cameraItems = freshState.cameraItems;
      projectData.lightItems = freshState.lightItems;
      projectData.splatEffectorItems = freshState.splatEffectorItems;
      projectData.mathSceneItems = freshState.mathSceneItems;
      projectData.motionShapeItems = freshState.motionShapeItems;

      projectData.flashboard = serializeFlashBoardState(
        getFlashBoardActiveGenerationRecords(),
        getFlashBoardComposerState(),
        getFlashBoardPromptHistory(),
        getFlashBoardChatMessages(),
        getFlashBoardAIWorkspaces(),
        getActiveFlashBoardAIWorkspaceId(),
      );
      withProjectStoreDirtyMarkSuppressed(() => {
        reconcileStoryboardTimelineClips(useTimelineStore.getState().clips);
      });
      projectData.storyboard = getStoryboardProjectSnapshot();
      projectData.seedancePreproduction = getSeedancePreproductionProjectState();
      projectData.documents = await writeDocumentsManifest(
        useDocumentsStore.getState().serialize(), projectData.documents,
      );

      if (!await persistFlashBoardChatJournal(getFlashBoardChatMessages())) {
        log.warn(' Chat journal could not be mirrored to the project folder');
      }
    }

    log.info(' Synced stores to project');
  }, { suppressDirtyMarks: false });
}

/**
 * Save current project
 */
export async function saveCurrentProject(options: SaveCurrentProjectOptions = {}): Promise<boolean> {
  if (!projectFileService.isProjectOpen()) {
    log.error(' No project open');
    return false;
  }

  if (isProjectStoreSyncInProgress()) {
    log.warn('Skipped project save while project stores are being synchronized');
    return false;
  }

  if (options.source === 'manual') {
    recordHistoryEvent(
      'manual-save',
      options.label ?? 'Manual save'
    );
  }

  await syncStoresToProject();
  return await projectFileService.saveProject();
}
