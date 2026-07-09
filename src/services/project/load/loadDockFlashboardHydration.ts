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
import { createDefaultFlashBoardComposer } from '../../../stores/flashboardStore/defaults';
import { useExportStore } from '../../../stores/exportStore';
import { useMIDIStore } from '../../../stores/midiStore';
import { hydrateHistoryStateFromProject } from '../../../stores/historyStore';
import { flashBoardMediaBridge } from '../../flashboard/FlashBoardMediaBridge';
import type {
  FlashBoardGenerationRequest,
  FlashBoardChatMessage,
  FlashBoardComposerModelSettings,
  FlashBoardComposerState,
  FlashBoardJobState,
  FlashBoardMediaType,
  FlashBoardOutputType,
  FlashBoardPromptHistoryEntry,
  FlashBoardResult,
  FlashBoardService,
} from '../../../stores/flashboardStore/types';
import type {
  ProjectFlashBoardComposerModelSettings,
  ProjectFlashBoardComposerState,
  ProjectFlashBoardChatMessage,
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardPromptHistoryEntry,
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

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : [];
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeFlashBoardComposerModelSettings(
  settings: ProjectFlashBoardComposerModelSettings | undefined,
): FlashBoardComposerModelSettings {
  if (!settings) return {};

  return {
    version: typeof settings.version === 'string' ? settings.version : undefined,
    mode: typeof settings.mode === 'string' ? settings.mode : undefined,
    duration: normalizeNumber(settings.duration),
    aspectRatio: typeof settings.aspectRatio === 'string' ? settings.aspectRatio : undefined,
    imageSize: typeof settings.imageSize === 'string' ? settings.imageSize : undefined,
    generateAudio: typeof settings.generateAudio === 'boolean' ? settings.generateAudio : undefined,
    multiShots: typeof settings.multiShots === 'boolean' ? settings.multiShots : undefined,
  };
}

function normalizeFlashBoardComposerModelSettingsByKey(
  value: ProjectFlashBoardComposerState['modelSettingsByKey'],
): Record<string, FlashBoardComposerModelSettings> {
  if (!value || typeof value !== 'object') return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key.trim().length > 0)
      .map(([key, settings]) => [key, normalizeFlashBoardComposerModelSettings(settings)]),
  );
}

function normalizeFlashBoardComposer(
  composer: ProjectFlashBoardComposerState | undefined,
): FlashBoardComposerState {
  const defaults = createDefaultFlashBoardComposer();
  if (!composer) return defaults;
  const service = composer.service ? normalizeFlashBoardService(composer.service) : normalizeFlashBoardService(defaults.service);

  return {
    ...defaults,
    ...composer,
    service,
    outputType: normalizeFlashBoardOutputType(composer.outputType, service) ?? defaults.outputType,
    mode: typeof composer.mode === 'string' ? composer.mode : defaults.mode,
    duration: normalizeNumber(composer.duration) ?? defaults.duration,
    aspectRatio: typeof composer.aspectRatio === 'string' ? composer.aspectRatio : defaults.aspectRatio,
    imageSize: typeof composer.imageSize === 'string' ? composer.imageSize : defaults.imageSize,
    generateAudio: typeof composer.generateAudio === 'boolean' ? composer.generateAudio : defaults.generateAudio,
    multiShots: typeof composer.multiShots === 'boolean' ? composer.multiShots : defaults.multiShots,
    multiPrompt: Array.isArray(composer.multiPrompt)
      ? composer.multiPrompt.filter((shot) => (
        typeof shot.index === 'number'
        && typeof shot.prompt === 'string'
        && typeof shot.duration === 'number'
      ))
      : defaults.multiPrompt,
    referenceMediaFileIds: normalizeStringArray(composer.referenceMediaFileIds),
    modelSettingsByKey: normalizeFlashBoardComposerModelSettingsByKey(composer.modelSettingsByKey),
  };
}

function normalizeFlashBoardPromptHistoryEntry(
  entry: ProjectFlashBoardPromptHistoryEntry,
): FlashBoardPromptHistoryEntry | null {
  if (
    (entry.kind !== 'generation' && entry.kind !== 'chat')
    || typeof entry.prompt !== 'string'
    || !entry.prompt.trim()
  ) {
    return null;
  }

  const createdAt = new Date(entry.createdAt).getTime();
  return {
    id: typeof entry.id === 'string' && entry.id.trim() ? entry.id : crypto.randomUUID(),
    kind: entry.kind,
    prompt: entry.prompt.trim(),
    createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
  };
}

function normalizeFlashBoardPromptHistory(
  history: ProjectFlashBoardState['promptHistory'],
): FlashBoardPromptHistoryEntry[] {
  return Array.isArray(history)
    ? history.map(normalizeFlashBoardPromptHistoryEntry).filter((entry): entry is FlashBoardPromptHistoryEntry => entry !== null)
    : [];
}

function normalizeFlashBoardChatMessage(
  message: ProjectFlashBoardChatMessage,
): FlashBoardChatMessage | null {
  if (
    (message.role !== 'user' && message.role !== 'assistant')
    || typeof message.text !== 'string'
  ) {
    return null;
  }

  const createdAt = message.createdAt ? new Date(message.createdAt).getTime() : undefined;
  const wasPending = message.isPending === true;
  return {
    id: typeof message.id === 'string' && message.id.trim() ? message.id : crypto.randomUUID(),
    role: message.role,
    text: wasPending ? 'Chat interrupted by reload.' : message.text,
    createdAt: createdAt !== undefined && Number.isFinite(createdAt) ? createdAt : undefined,
    editOptions: Array.isArray(message.editOptions) ? message.editOptions : undefined,
    isError: message.isError || wasPending || undefined,
    isPending: false,
    toolCalls: Array.isArray(message.toolCalls) ? message.toolCalls : undefined,
  };
}

function normalizeFlashBoardChatMessages(
  messages: ProjectFlashBoardState['chatMessages'],
): FlashBoardChatMessage[] {
  return Array.isArray(messages)
    ? messages.map(normalizeFlashBoardChatMessage).filter((message): message is FlashBoardChatMessage => message !== null)
    : [];
}

function normalizeFlashBoardResult(result: FlashBoardResult | undefined): FlashBoardResult | undefined {
  if (!result) return undefined;
  return { ...result, mediaType: normalizeFlashBoardMediaType(result.mediaType) };
}

function normalizeFlashBoardJob(
  job: ProjectFlashBoardGenerationRecord['job'] | undefined,
): FlashBoardJobState | undefined {
  if (!job) return undefined;

  const resumable = (job.status === 'queued' || job.status === 'processing') && Boolean(job.remoteTaskId);
  const interrupted = (job.status === 'queued' || job.status === 'processing') && !job.remoteTaskId;
  return {
    ...job,
    status: interrupted ? 'failed' : resumable ? 'processing' : job.status,
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
  hydrateFlashBoardActiveGenerationRecords(
    data.generationRecords.map(normalizeFlashBoardGenerationRecord),
    normalizeFlashBoardComposer(data.composer),
    normalizeFlashBoardPromptHistory(data.promptHistory),
    normalizeFlashBoardChatMessages(data.chatMessages),
  );
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
