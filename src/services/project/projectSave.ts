// Project Save — sync stores to project file format

import { Logger } from '../logger';
import { useMediaStore, type Composition } from '../../stores/mediaStore';
import {
  mergeSignalArtifacts,
  signalAssetItemToProjectMetadata,
} from '../../stores/mediaStore/helpers/signalItems';
import { useTimelineStore } from '../../stores/timeline';
import { useDockStore } from '../../stores/dockStore';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  getFlashBoardActiveGenerationRecords,
  getFlashBoardChatMessages,
  getFlashBoardComposerState,
  getFlashBoardPromptHistory,
  type FlashBoardActiveGenerationRecord,
} from '../../stores/flashboardStore/activeGenerationRecords';
import type { FlashBoardChatMessage, FlashBoardComposerState, FlashBoardPromptHistoryEntry } from '../../stores/flashboardStore/types';
import { getExportStoreData, useExportStore } from '../../stores/exportStore';
import { useMIDIStore } from '../../stores/midiStore';
import { recordHistoryEvent, serializeHistoryStateForProject } from '../../stores/historyStore';
import { buildProjectAudioStateIndex } from '../audio/projectAudioState';
import { createCurrentAudioArtifactStore } from '../audio/timelineWaveformPyramidCache';
import { clonePersistedClipAudioState } from '../audio/clipAudioStatePersistence';
import { flashBoardMediaBridge } from '../flashboard/FlashBoardMediaBridge';
import { redactFlashBoardChatImageData } from '../flashboard/FlashBoardChatImageData';
import { cloneClipNodeGraph } from '../nodeGraph';
import { normalizeTransitionInstanceParams } from '../../transitions';
import { syncTransitionCompositionTimelineToParent } from '../../stores/mediaStore/slices/composition/transitionCompositionSync';
import type {
  ProjectFlashBoardComposerState,
  ProjectFlashBoardChatMessage,
  ProjectFlashBoardGenerationMetadata,
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardPromptHistoryEntry,
  ProjectFlashBoardState,
} from './types/flashboard.types';
import {
  projectFileService,
  type ProjectComposition,
  type ProjectTrack,
  type ProjectClip,
  type ProjectMarker,
} from '../projectFileService';
import { toProjectTransform } from './transformSerialization';
import { serializeMaskEdgeFeathers, serializeMaskKeyframeProperty } from './maskSerialization';
import { normalizeRulerLaneState } from '../../timeline/tempo/rulerDefaults';
import { shouldBlockDestructiveStoreSync } from './destructiveStoreSyncGuard';
import {
  convertFolders,
  convertMediaFiles,
  serializeGaussianSplatSequence,
  serializeModelSequence,
} from './projectMediaSerialization';
import {
  isProjectStoreSyncInProgress,
  withProjectStoreSyncGuard,
} from './projectStoreSyncGuard';
import type {
  ClipVideoState,
  SerializableClip,
  SerializableMarker,
  TimelineClip,
  VideoBakeRegion,
} from '../../types';
import type {
  ProjectMediaBoardGroupOffsets,
  ProjectMediaBoardNodeLayout,
  ProjectMediaBoardOrder,
  ProjectMediaBoardViewport,
} from './types/project.types';

const log = Logger.create('ProjectSync');
export {
  isProjectStoreSyncInProgress,
  withProjectStoreSyncGuard,
} from './projectStoreSyncGuard';
export interface SaveCurrentProjectOptions {
  source?: 'manual' | 'autosave';
  label?: string;
}

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

function serializeProjectVideoBakeRegion(region: VideoBakeRegion): VideoBakeRegion {
  const clone = structuredClone(region);
  delete clone.bakedAt;
  delete clone.error;
  delete clone.progress;
  clone.status = 'marked';
  return clone;
}

function serializeProjectClipVideoState(videoState: ClipVideoState | undefined): ClipVideoState | undefined {
  if (!videoState) return undefined;
  return {
    ...structuredClone(videoState),
    bakeRegions: videoState.bakeRegions?.map(serializeProjectVideoBakeRegion),
  };
}

function shouldPersistClipWaveform(clip: ProjectSaveClip): boolean {
  return !clip.audioState?.sourceAnalysisRefs?.waveformPyramidId &&
    !clip.audioState?.processedAnalysisRefs?.processedWaveformPyramidId;
}

// ============================================
// CONVERTER HELPERS (store → project format)
// ============================================

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
      labelColor: t.labelColor && t.labelColor !== 'none' ? t.labelColor : undefined,
      locked: t.locked || false,
      visible: t.visible !== false,
      muted: t.muted || false,
      solo: t.solo || false,
      audioState: t.audioState ? structuredClone(t.audioState) : undefined,
      // MIDI track instrument (issue #182/#193) — persist so the synth + GM program
      // survive a hard refresh / project reload, not just the in-memory loadState path.
      midiInstrument: t.midiInstrument ? structuredClone(t.midiInstrument) : undefined,
    }));

    // Convert clips
    const clips: ProjectClip[] = ((timelineData?.clips || []) as ProjectSaveClip[]).map((c) => ({
      id: c.id,
      trackId: c.trackId,
      name: c.name || '',
      mediaId: c.source?.mediaFileId || c.mediaFileId || c.mediaId || '',
      signalAssetId: c.signalAssetId,
      signalRefId: c.signalRefId,
      signalRenderAdapterId: c.signalRenderAdapterId,
      sourceType: c.source?.type || c.sourceType || 'video',
      liveInputId: c.source?.liveInputId || c.liveInputId,
      naturalDuration: c.source?.naturalDuration || c.naturalDuration,
      // MIDI note data (issue #182) — notes on the clip, instrument on the track.
      midiData: (c.source?.type === 'midi' || c.sourceType === 'midi') && c.midiData
        ? structuredClone(c.midiData)
        : undefined,
      thumbnails: c.thumbnails,
      linkedClipId: c.linkedClipId,
      linkedGroupId: c.linkedGroupId,
      videoState: serializeProjectClipVideoState(c.videoState),
      waveform: shouldPersistClipWaveform(c) ? c.waveform : undefined,
      waveformChannels: shouldPersistClipWaveform(c) ? c.waveformChannels : undefined,
      audioState: clonePersistedClipAudioState(c.audioState),
      modelSequence: serializeModelSequence(c.source?.modelSequence || c.modelSequence),
      gaussianSplatSequence: serializeGaussianSplatSequence(c.source?.gaussianSplatSequence || c.gaussianSplatSequence),
      meshType: c.source?.meshType || c.meshType,
      modelPrimitiveIndex: c.source?.modelPrimitiveIndex ?? c.modelPrimitiveIndex,
      modelMaterialSettings: c.source?.modelMaterialSettings || c.modelMaterialSettings,
      text3DProperties: c.source?.text3DProperties || c.text3DProperties,
      cameraSettings: c.source?.cameraSettings || c.cameraSettings,
      lightSettings: c.source?.lightSettings || c.lightSettings,
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
      sourceRect: c.sourceRect ? structuredClone(c.sourceRect) : undefined,
      transitionRender: c.transitionRender ? structuredClone(c.transitionRender) : undefined,
      effects: (c.effects || []).map((e) => ({
        id: e.id,
        type: e.type,
        name: e.name || e.type,
        enabled: e.enabled !== false,
        params: e.params || {},
      })),
      transitionIn: c.transitionIn ? normalizeTransitionInstanceParams(structuredClone(c.transitionIn)) : undefined,
      transitionOut: c.transitionOut ? normalizeTransitionInstanceParams(structuredClone(c.transitionOut)) : undefined,
      transitionSourceTimeOverride: c.transitionSourceTimeOverride,
      transitionSourceHold: c.transitionSourceHold,
      transitionSourceMap: c.transitionSourceMap ? structuredClone(c.transitionSourceMap) : undefined,
      transitionRecipeBlendWindows: c.transitionRecipeBlendWindows ? structuredClone(c.transitionRecipeBlendWindows) : undefined,
      colorCorrection: c.colorCorrection ? structuredClone(c.colorCorrection) : undefined,
      nodeGraph: cloneClipNodeGraph(c.nodeGraph),
      masks: (c.masks || []).map((m) => ({
        id: m.id,
        name: m.name || 'Mask',
        mode: m.mode || 'add',
        inverted: m.inverted || false,
        opacity: m.opacity ?? 1,
        feather: m.feather || 0,
        edgeFeathers: serializeMaskEdgeFeathers(m),
        featherQuality: m.featherQuality ?? 50,
        enabled: m.enabled !== false,
        visible: m.visible !== false,
        outlineColor: m.outlineColor,
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
      keyframes: (c.keyframes || []).map((keyframe) => ({
        ...keyframe,
        property: serializeMaskKeyframeProperty(keyframe.property, c.masks),
      })),
      volume: c.volume ?? 1,
      audioEnabled: c.audioEnabled !== false,
      reversed: c.reversed || false,
      disabled: c.disabled || false,
      speed: c.speed,
      preservesPitch: c.preservesPitch,
      freeRun: c.freeRun,
      // Nested composition support
      isComposition: c.isComposition || undefined,
      compositionId: c.compositionId || undefined,
      // Text clip support
      textProperties: c.textProperties || undefined,
      // Solid clip support
      solidColor: c.solidColor || undefined,
      // Generated transition overlay support
      transitionOverlay: c.transitionOverlay || c.source?.transitionOverlay
        ? structuredClone(c.transitionOverlay ?? c.source?.transitionOverlay)
        : undefined,
      // Math scene clip support
      mathScene: c.mathScene ? structuredClone(c.mathScene) : undefined,
      // Motion design clip support
      motion: c.motion ? structuredClone(c.motion) : undefined,
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

    // Multi-ruler infrastructure (issue #257) — persist lanes/tempo, defaulting
    // comps authored before the feature so the durable file always has the fields.
    const rulerState = normalizeRulerLaneState({
      tempoMap: timelineData?.tempoMap,
      rulerLanes: timelineData?.rulerLanes,
      activeRulerLaneId: timelineData?.activeRulerLaneId,
    });

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
      transitionComp: comp.transitionComp ? structuredClone(comp.transitionComp) : undefined,
      tracks,
      clips,
      videoBakeRegions: timelineData?.videoBakeRegions
        ? timelineData.videoBakeRegions.map(serializeProjectVideoBakeRegion)
        : undefined,
      masterAudioState: timelineData?.masterAudioState
        ? structuredClone(timelineData.masterAudioState)
        : undefined,
      markers,
      tempoMap: rulerState.tempoMap,
      rulerLanes: rulerState.rulerLanes,
      activeRulerLaneId: rulerState.activeRulerLaneId,
    };
  });
}

function serializeFlashBoardGenerationRecord(
  record: FlashBoardActiveGenerationRecord,
): ProjectFlashBoardGenerationRecord {
  return {
    id: record.id,
    createdAt: new Date(record.createdAt).toISOString(),
    updatedAt: new Date(record.updatedAt).toISOString(),
    request: record.request,
    job: record.job,
    result: record.result,
  };
}

function serializeFlashBoardComposerState(
  composer: FlashBoardComposerState,
): ProjectFlashBoardComposerState {
  return {
    isOpen: composer.isOpen,
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

function serializeFlashBoardChatMessage(message: FlashBoardChatMessage): ProjectFlashBoardChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
    editOptions: message.editOptions,
    isError: message.isError,
    isPending: message.isPending,
    toolCalls: redactFlashBoardChatImageData(message.toolCalls),
  };
}

function serializeFlashBoardState(
  records: FlashBoardActiveGenerationRecord[],
  composer: FlashBoardComposerState,
  promptHistory: FlashBoardPromptHistoryEntry[],
  chatMessages: FlashBoardChatMessage[],
): ProjectFlashBoardState {
  const generationMetadataByMediaId: Record<string, ProjectFlashBoardGenerationMetadata> = {
    ...flashBoardMediaBridge.serializeMetadata(),
  };

  for (const record of records) {
    if (record.result?.mediaFileId && record.request) {
      generationMetadataByMediaId[record.result.mediaFileId] = {
        mediaFileId: record.result.mediaFileId,
        service: record.request.service,
        providerId: record.request.providerId,
        version: record.request.version,
        outputType: record.request.outputType,
        mediaType: record.result.mediaType,
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
    version: 1,
    composer: serializeFlashBoardComposerState(composer),
    promptHistory: promptHistory.map(serializeFlashBoardPromptHistoryEntry),
    chatMessages: chatMessages.map(serializeFlashBoardChatMessage),
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

    // Save current timeline to active composition first
    if (mediaState.activeCompositionId) {
      const activeCompositionId = mediaState.activeCompositionId;
      const timelineData = timelineStore.getSerializableState();
      useMediaStore.setState((state) => ({
        compositions: syncTransitionCompositionTimelineToParent(
          state.compositions.map((c) =>
            c.id === activeCompositionId ? { ...c, timelineData } : c
          ),
          activeCompositionId,
          timelineData,
        ),
      }));
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

    // Update project file data
    const projectMedia = convertMediaFiles(freshState.files);
    const projectCompositions = convertCompositions(freshState.compositions);
    projectFileService.updateMedia(projectMedia);
    projectFileService.updateCompositions(projectCompositions);
    projectFileService.updateFolders(convertFolders(freshState.folders));

    // Update active state
    if (projectData) {
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
      );
    }

    log.info(' Synced stores to project');
  });
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
