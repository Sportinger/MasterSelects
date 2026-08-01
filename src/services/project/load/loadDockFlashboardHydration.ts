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
import {
  mergeFlashBoardVideoJobRecovery,
  readFlashBoardVideoJobRecovery,
} from '../../flashboard/FlashBoardVideoJobRecovery';
import { normalizeFlashBoardChatMessages } from '../flashBoardChatProjectCodec';
import { readFlashBoardChatJournal } from '../flashBoardChatProjectJournal';
import type {
  FlashBoardGenerationRequest,
  FlashBoardGenerationMetadata,
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
  ProjectFlashBoardGenerationMetadata,
  ProjectFlashBoardGenerationRequest,
  ProjectFlashBoardGenerationRecord,
  ProjectFlashBoardPromptHistoryEntry,
  ProjectFlashBoardState,
} from '../types/flashboard.types';
import type { ProjectFile } from '../../projectFileService';

const log = Logger.create('ProjectSync');
const MEDIA_PANEL_PROJECT_UI_LOADED_EVENT = 'media-panel-project-ui-loaded';
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

function normalizeFlashBoardService(_value: unknown): FlashBoardService {
  return 'cloud';
}

function normalizeFlashBoardProviderId(service: unknown, providerId: string): string {
  if ((service === 'kieai' || service === 'piapi') && (providerId === 'kling-3.0' || providerId === 'kling')) {
    return 'cloud-kling';
  }
  if (service === 'evolink') {
    return 'nano-banana-2';
  }
  if (service === 'elevenlabs' && providerId === 'elevenlabs-tts') {
    return 'cloud-elevenlabs-tts';
  }
  return providerId;
}

function normalizeFlashBoardOutputType(
  value: unknown,
): FlashBoardOutputType | undefined {
  if (typeof value === 'string' && FLASHBOARD_OUTPUT_TYPES.has(value as FlashBoardOutputType)) {
    return value as FlashBoardOutputType;
  }

  return undefined;
}

function normalizeFlashBoardMediaType(value: unknown): FlashBoardMediaType {
  return typeof value === 'string' && FLASHBOARD_MEDIA_TYPES.has(value as FlashBoardMediaType)
    ? value as FlashBoardMediaType
    : 'video';
}

function normalizeFlashBoardRequest(
  request: ProjectFlashBoardGenerationRequest | undefined,
): FlashBoardGenerationRequest | undefined {
  if (!request) return undefined;
  const legacyService = request.service;
  const service = normalizeFlashBoardService(request.service);

  return {
    ...request,
    service,
    providerId: normalizeFlashBoardProviderId(legacyService, request.providerId),
    version: legacyService === 'kieai' ? 'latest' : request.version,
    outputType: normalizeFlashBoardOutputType(request.outputType),
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
    providerId: normalizeFlashBoardProviderId(
      composer.service,
      composer.providerId ?? defaults.providerId ?? 'cloud-kling',
    ),
    outputType: normalizeFlashBoardOutputType(composer.outputType) ?? defaults.outputType,
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

function normalizeFlashBoardResult(result: FlashBoardResult | undefined): FlashBoardResult | undefined {
  if (!result) return undefined;
  return { ...result, mediaType: normalizeFlashBoardMediaType(result.mediaType) };
}

function normalizeFlashBoardJob(
  job: ProjectFlashBoardGenerationRecord['job'] | undefined,
): FlashBoardJobState | undefined {
  if (!job) return undefined;

  const resumable = (job.status === 'queued' || job.status === 'processing') && Boolean(job.remoteTaskId);
  const legacyReloadFailure = job.status === 'failed' && job.error === 'Job interrupted by reload';
  return {
    ...job,
    status: legacyReloadFailure ? 'queued' : resumable ? 'processing' : job.status,
    error: legacyReloadFailure ? undefined : job.error,
  };
}

function normalizeFlashBoardGenerationMetadata(
  metadata: ProjectFlashBoardGenerationMetadata,
): FlashBoardGenerationMetadata {
  const legacyService = metadata.service;
  const service = metadata.service ? normalizeFlashBoardService(metadata.service) : undefined;

  return {
    ...metadata,
    service,
    providerId: normalizeFlashBoardProviderId(legacyService, metadata.providerId),
    version: legacyService === 'kieai' ? 'latest' : metadata.version,
    outputType: normalizeFlashBoardOutputType(metadata.outputType),
    mediaType: metadata.mediaType ? normalizeFlashBoardMediaType(metadata.mediaType) : undefined,
    referenceMediaFileIds: normalizeStringArray(metadata.referenceMediaFileIds),
  };
}

function normalizeFlashBoardGenerationMetadataRecord(
  metadataByMediaId: Record<string, ProjectFlashBoardGenerationMetadata>,
): Record<string, FlashBoardGenerationMetadata> {
  return Object.fromEntries(
    Object.entries(metadataByMediaId).map(([mediaFileId, metadata]) => [
      mediaFileId,
      normalizeFlashBoardGenerationMetadata(metadata),
    ]),
  );
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
    outputs: record.outputs?.map((output) => ({
      ...output,
      mediaType: normalizeFlashBoardMediaType(output.mediaType),
    })),
    result: normalizeFlashBoardResult(record.result),
    results: record.results?.map((result) => normalizeFlashBoardResult(result) as FlashBoardResult),
  };
}

function hydrateFlashBoardGenerationRecordsFromProject(
  data: ProjectFlashBoardState,
  journalMessages: FlashBoardChatMessage[] | null,
  projectCreatedAt: string,
): void {
  const projectRecords = data.generationRecords.map(normalizeFlashBoardGenerationRecord);
  hydrateFlashBoardActiveGenerationRecords(
    mergeFlashBoardVideoJobRecovery(
      projectRecords,
      readFlashBoardVideoJobRecovery(projectCreatedAt),
    ),
    normalizeFlashBoardComposer(data.composer),
    normalizeFlashBoardPromptHistory(data.promptHistory),
    journalMessages ?? normalizeFlashBoardChatMessages(data.chatMessages),
  );
}

export async function hydrateDockFlashboardAndWorkspaceFromProject(projectData: ProjectFile): Promise<void> {
  useYouTubeStore.getState().reset();
  const journalMessages = await readFlashBoardChatJournal(projectData.createdAt);

  if (projectData.uiState?.dockLayout) {
    useDockStore.getState().setLayoutFromProject(projectData.uiState.dockLayout);
    log.info(' Restored dock layout from project');
  }

  if (projectData.flashboard) {
    hydrateFlashBoardGenerationRecordsFromProject(
      projectData.flashboard,
      journalMessages,
      projectData.createdAt,
    );
    flashBoardMediaBridge.hydrateMetadata(normalizeFlashBoardGenerationMetadataRecord(
      projectData.flashboard.generationMetadataByMediaId ?? {},
    ));
    log.info(' Restored FlashBoard state from project');
  } else if (journalMessages) {
    hydrateFlashBoardActiveGenerationRecords(
      readFlashBoardVideoJobRecovery(projectData.createdAt),
      createDefaultFlashBoardComposer(),
      [],
      journalMessages,
    );
    flashBoardMediaBridge.hydrateMetadata({});
    log.info(' Restored FlashBoard chat journal from project folder');
  } else {
    const recoveredRecords = readFlashBoardVideoJobRecovery(projectData.createdAt);
    if (recoveredRecords.length > 0) {
      hydrateFlashBoardActiveGenerationRecords(recoveredRecords);
    } else {
      resetFlashBoardActiveGenerationState();
    }
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
  await useSettingsStore.getState().loadIntegrationCredentials();
}
