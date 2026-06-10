import { Logger } from '../../logger';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useYouTubeStore } from '../../../stores/youtubeStore';
import { useDockStore } from '../../../stores/dockStore';
import { useSettingsStore } from '../../../stores/settingsStore';
import {
  hydrateFlashBoardActiveGenerationRecords,
  resetFlashBoardActiveGenerationState,
  type FlashBoardActiveGenerationRecord,
} from '../../../stores/flashboardStore/activeGenerationRecords';
import { useExportStore } from '../../../stores/exportStore';
import { useMIDIStore } from '../../../stores/midiStore';
import { hydrateHistoryStateFromProject } from '../../../stores/historyStore';
import { flashBoardMediaBridge } from '../../flashboard/FlashBoardMediaBridge';
import type {
  FlashBoardGenerationRequest,
  FlashBoardJobState,
  FlashBoardMediaType,
  FlashBoardOutputType,
  FlashBoardResult,
  FlashBoardService,
} from '../../../stores/flashboardStore/types';
import type {
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardState,
} from '../types/flashboard.types';
import type { ProjectFile } from '../../projectFileService';

const log = Logger.create('ProjectSync');
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';
const FLASHBOARD_SERVICES = new Set<FlashBoardService>(['piapi', 'kieai', 'evolink', 'cloud', 'elevenlabs', 'suno']);
const FLASHBOARD_OUTPUT_TYPES = new Set<FlashBoardOutputType>(['video', 'image', 'audio']);
const FLASHBOARD_MEDIA_TYPES = new Set<FlashBoardMediaType>(['video', 'image', 'audio']);

function removeLocalStorageKey(key: string): void {
  const storage = localStorage as Storage & { removeItem?: (name: string) => void };
  if (typeof storage.removeItem === 'function') {
    storage.removeItem(key);
    return;
  }
  storage.setItem(key, '');
}

function normalizeFlashBoardService(value: unknown): FlashBoardService {
  return typeof value === 'string' && FLASHBOARD_SERVICES.has(value as FlashBoardService)
    ? value as FlashBoardService
    : 'kieai';
}

function normalizeFlashBoardOutputType(
  value: unknown,
  service: FlashBoardService,
): FlashBoardOutputType | undefined {
  if (typeof value === 'string' && FLASHBOARD_OUTPUT_TYPES.has(value as FlashBoardOutputType)) {
    return value as FlashBoardOutputType;
  }

  return service === 'elevenlabs' || service === 'suno' ? 'audio' : undefined;
}

function normalizeFlashBoardMediaType(value: unknown): FlashBoardMediaType {
  return typeof value === 'string' && FLASHBOARD_MEDIA_TYPES.has(value as FlashBoardMediaType)
    ? value as FlashBoardMediaType
    : 'video';
}

function normalizeFlashBoardRequest(
  request: FlashBoardGenerationRequest | undefined,
): FlashBoardGenerationRequest | undefined {
  if (!request) return undefined;
  const service = normalizeFlashBoardService(request.service);

  return {
    ...request,
    service,
    outputType: normalizeFlashBoardOutputType(request.outputType, service),
    referenceMediaFileIds: Array.isArray(request.referenceMediaFileIds)
      ? request.referenceMediaFileIds.filter((id): id is string => typeof id === 'string')
      : [],
  };
}

function normalizeFlashBoardResult(result: FlashBoardResult | undefined): FlashBoardResult | undefined {
  if (!result) return undefined;
  return { ...result, mediaType: normalizeFlashBoardMediaType(result.mediaType) };
}

function normalizeFlashBoardJob(
  job: ProjectFlashBoardGenerationRecord['job'] | undefined,
): FlashBoardJobState | undefined {
  if (!job) return undefined;

  const interrupted = job.status === 'queued' || job.status === 'processing';
  return {
    ...job,
    status: interrupted ? 'failed' : job.status,
    error: interrupted && !job.error ? 'Job interrupted by reload' : job.error,
  };
}

function normalizeFlashBoardGenerationRecord(
  record: ProjectFlashBoardGenerationRecord,
): FlashBoardActiveGenerationRecord {
  return {
    id: record.id,
    kind: 'generation',
    createdAt: new Date(record.createdAt).getTime(),
    updatedAt: new Date(record.updatedAt).getTime(),
    request: normalizeFlashBoardRequest(record.request),
    job: normalizeFlashBoardJob(record.job),
    result: normalizeFlashBoardResult(record.result),
  };
}

function hydrateFlashBoardGenerationRecordsFromProject(data: ProjectFlashBoardState): void {
  hydrateFlashBoardActiveGenerationRecords(data.generationRecords.map(normalizeFlashBoardGenerationRecord));
}

export async function hydrateDockFlashboardAndWorkspaceFromProject(projectData: ProjectFile): Promise<void> {
  useYouTubeStore.getState().reset();

  if (projectData.uiState?.dockLayout) {
    useDockStore.getState().setLayoutFromProject(projectData.uiState.dockLayout);
    log.info(' Restored dock layout from project');
  }

  if (projectData.flashboard) {
    hydrateFlashBoardGenerationRecordsFromProject(projectData.flashboard);
    flashBoardMediaBridge.hydrateMetadata(projectData.flashboard.generationMetadataByMediaId ?? {});
    log.info(' Restored FlashBoard state from project');
  } else {
    resetFlashBoardActiveGenerationState();
    flashBoardMediaBridge.hydrateMetadata({});
  }

  if (projectData.uiState?.mediaPanelColumns) {
    localStorage.setItem('media-panel-column-order', JSON.stringify(projectData.uiState.mediaPanelColumns));
  }
  if (projectData.uiState?.mediaPanelNameWidth !== undefined) {
    localStorage.setItem('media-panel-name-width', String(projectData.uiState.mediaPanelNameWidth));
  }
  if (projectData.uiState?.mediaPanelViewMode) {
    localStorage.setItem('media-panel-view-mode', projectData.uiState.mediaPanelViewMode);
  }
  if (projectData.uiState?.mediaPanelBoardViewport) {
    localStorage.setItem('media-panel-board-viewport', JSON.stringify(projectData.uiState.mediaPanelBoardViewport));
  } else {
    removeLocalStorageKey('media-panel-board-viewport');
  }
  if (projectData.uiState?.mediaPanelBoardOrder) {
    localStorage.setItem('media-panel-board-order', JSON.stringify(projectData.uiState.mediaPanelBoardOrder));
  } else {
    removeLocalStorageKey('media-panel-board-order');
  }
  if (projectData.uiState?.mediaPanelBoardGroupOffsets) {
    localStorage.setItem('media-panel-board-group-offsets', JSON.stringify(projectData.uiState.mediaPanelBoardGroupOffsets));
  } else {
    removeLocalStorageKey('media-panel-board-group-offsets');
  }
  if (projectData.uiState?.mediaPanelBoardLayouts) {
    localStorage.setItem('media-panel-board-layouts', JSON.stringify(projectData.uiState.mediaPanelBoardLayouts));
  } else {
    removeLocalStorageKey('media-panel-board-layouts');
  }
  removeLocalStorageKey('media-panel-board-layout');
  window.dispatchEvent(new CustomEvent(MEDIA_PANEL_PROJECT_UI_LOADED_EVENT));
  if (projectData.uiState?.transcriptLanguage) {
    localStorage.setItem('transcriptLanguage', projectData.uiState.transcriptLanguage);
  }

  if (projectData.uiState) {
    const ui = projectData.uiState;
    const ts = useTimelineStore.getState();
    if (ui.thumbnailsEnabled !== undefined) ts.setThumbnailsEnabled(ui.thumbnailsEnabled);
    if (ui.waveformsEnabled !== undefined) ts.setWaveformsEnabled(ui.waveformsEnabled);
    if (ui.audioDisplayMode !== undefined) ts.setAudioDisplayMode(ui.audioDisplayMode);
    if (ui.trackFocusMode !== undefined) {
      ts.setTrackFocusMode(ui.trackFocusMode);
    } else if (ui.audioFocusMode !== undefined) {
      ts.setAudioFocusMode(ui.audioFocusMode);
    }
    if (ui.trackHeaderWidth !== undefined) ts.setTrackHeaderWidth(ui.trackHeaderWidth);
    if ('timelineSplitRatio' in ui) ts.setTimelineSplitRatio(ui.timelineSplitRatio ?? null);
    if (ui.showTranscriptMarkers !== undefined) ts.setShowTranscriptMarkers(ui.showTranscriptMarkers);
    if (ui.proxyEnabled !== undefined) useMediaStore.getState().setProxyEnabled(ui.proxyEnabled);

    const changelogSettings: Partial<{
      showChangelogOnStartup: boolean;
      lastSeenChangelogVersion: string | null;
    }> = {};
    if (ui.showChangelogOnStartup !== undefined) changelogSettings.showChangelogOnStartup = ui.showChangelogOnStartup;
    if ('lastSeenChangelogVersion' in ui) changelogSettings.lastSeenChangelogVersion = ui.lastSeenChangelogVersion ?? null;
    if (Object.keys(changelogSettings).length > 0) useSettingsStore.setState(changelogSettings);
  }

  const projectMIDIState = projectData.uiState?.midi;
  useMIDIStore.setState({
    isEnabled: projectMIDIState?.isEnabled ?? false,
    transportBindings: {
      playPause: projectMIDIState?.transportBindings?.playPause ?? null,
      stop: projectMIDIState?.transportBindings?.stop ?? null,
    },
    slotBindings: projectMIDIState?.slotBindings ?? {},
    parameterBindings: projectMIDIState?.parameterBindings ?? {},
    learnTarget: null,
  });

  useExportStore.getState().hydrateFromProject(projectData.uiState?.exportState);
  hydrateHistoryStateFromProject(projectData.uiState?.history);
  await useSettingsStore.getState().loadApiKeys();
}
