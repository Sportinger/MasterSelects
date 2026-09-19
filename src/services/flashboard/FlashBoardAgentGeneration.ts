import { useMediaStore } from '../../stores/mediaStore';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import {
  failFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecordByRequestKey,
  getFlashBoardActiveGenerationRecords,
  hasDurableFlashBoardProviderIdempotency,
  isFlashBoardCancellationRequested,
  prepareFlashBoardActiveGenerationRequest,
  startFlashBoardActiveGenerationRecord,
  subscribeFlashBoardActiveGenerationRecords,
  updateFlashBoardActiveGenerationJob,
  updateFlashBoardActiveGenerationOutputs,
} from '../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
  FlashBoardMediaType,
  FlashBoardMultiShotPrompt,
} from '../../stores/flashboardStore/types';
import { flashBoardJobService, type FlashBoardJobUpdateCallback } from './FlashBoardJobService';
import { flashBoardMediaBridge } from './FlashBoardMediaBridge';
import { getCatalogEntries, getCatalogEntry } from './FlashBoardModelCatalog';
import type { CatalogEntry, CatalogReferenceInputKind } from './types';

export type AgentMediaGenerationOutputType = 'image' | 'video';

export interface AgentMediaGenerationSelection {
  outputType: AgentMediaGenerationOutputType;
  providerId?: string | null;
}

export interface AgentMediaGenerationRequestInput extends AgentMediaGenerationSelection {
  aspectRatio?: string | null;
  duration?: number | null;
  endMediaFileId?: string | null;
  generateAudio?: boolean | null;
  idempotencyKey?: string | null;
  imageSize?: string | null;
  /** Browser-internal source binding; never supplied by the model. */
  originConversationRef?: string | null;
  mode?: string | null;
  multiPrompt?: FlashBoardMultiShotPrompt[] | null;
  multiShots?: boolean | null;
  negativePrompt?: string | null;
  prompt?: string | null;
  referenceMediaFileIds?: string[] | null;
  settingsToken: string;
  startMediaFileId?: string | null;
  version?: string | null;
}

export interface AgentMediaGenerationStatusInput {
  idempotencyKey?: string | null;
  recordId?: string | null;
}

interface AgentMediaGenerationModelSettings {
  acceptedReferenceKinds: CatalogReferenceInputKind[];
  aspectRatios: string[];
  constraints: string[];
  defaults: {
    aspectRatio?: string;
    duration?: number;
    generateAudio: false;
    imageSize?: string;
    mode?: string;
    multiShots: false;
    version: string;
  };
  description: string;
  durations: number[];
  imageSizes: string[];
  maxReferenceImages?: number;
  maxReferenceMedia?: number;
  maxReferenceAudio?: number;
  maxReferenceVideos?: number;
  modeControlLabel?: string;
  modeLabels: Record<string, string>;
  modes: string[];
  name: string;
  outputType: AgentMediaGenerationOutputType;
  providerId: string;
  requiredReferenceMediaType?: FlashBoardMediaType | 'visual';
  requiresPrompt: boolean;
  requiresReferenceMedia: boolean;
  service: 'cloud';
  supportsGenerateAudio: boolean;
  supportsImageToVideo: boolean;
  supportsMultiShot: boolean;
  supportsTextToImage: boolean;
  supportsTextToVideo: boolean;
  versions: string[];
}

const AGENT_GENERATION_KEY_PREFIX = 'kernel-media-generation:';
const DEFAULT_PROVIDER_BY_OUTPUT: Record<AgentMediaGenerationOutputType, string> = {
  image: 'nano-banana-2',
  video: 'cloud-kling',
};

function outputTypeFor(entry: CatalogEntry): 'audio' | 'image' | 'video' {
  return entry.outputType ?? 'video';
}

function compactProviderName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function entriesFor(outputType: AgentMediaGenerationOutputType): CatalogEntry[] {
  return getCatalogEntries().filter((entry) => outputTypeFor(entry) === outputType);
}

function resolveCatalogEntry(selection: AgentMediaGenerationSelection): CatalogEntry {
  if (selection.outputType !== 'image' && selection.outputType !== 'video') {
    throw new Error('outputType must be image or video.');
  }
  const requested = selection.providerId?.trim() || DEFAULT_PROVIDER_BY_OUTPUT[selection.outputType];
  const exact = getCatalogEntry('cloud', requested);
  if (exact && outputTypeFor(exact) === selection.outputType) return exact;

  const normalized = compactProviderName(requested);
  const matches = entriesFor(selection.outputType).filter((entry) => (
    compactProviderName(entry.providerId) === normalized
    || compactProviderName(entry.name) === normalized
  ));
  if (matches.length === 1 && matches[0]) return matches[0];

  const available = entriesFor(selection.outputType)
    .map((entry) => `${entry.name} (${entry.providerId})`)
    .join(', ');
  throw new Error(`Unknown ${selection.outputType} generation model "${requested}". Available: ${available}`);
}

function preferred<T>(values: readonly T[], preferredValue: T): T | undefined {
  return values.includes(preferredValue) ? preferredValue : values[0];
}

function modelSettings(entry: CatalogEntry): AgentMediaGenerationModelSettings {
  const outputType = outputTypeFor(entry);
  if (outputType !== 'image' && outputType !== 'video') {
    throw new Error('The selected model is not an image or video generation model.');
  }
  const version = entry.versions[0] ?? 'latest';
  const aspectRatio = preferred(entry.aspectRatios, '16:9');
  const duration = entry.providerId === 'cloud-kling'
    ? preferred(entry.durations, 5)
    : entry.durations[0];
  const mode = entry.providerId === 'cloud-kling'
    ? preferred(entry.modes, 'std')
    : entry.modes[0];
  const imageSize = preferred(entry.imageSizes ?? [], '1K');
  const constraints = entry.providerId === 'cloud-kling'
    ? [
        'When multiShots=true, generateAudio=true is required because Kling multi-shot always generates sound.',
        'Kling multi-shot accepts at most one image anchor and does not accept an end frame.',
      ]
    : entry.providerId === 'bytedance/seedance-2-5'
      ? ['Exact first/last frames and multimodal references are mutually exclusive.']
      : [];
  return {
    acceptedReferenceKinds: [...(entry.referenceInputKinds ?? [])],
    aspectRatios: [...entry.aspectRatios],
    constraints,
    defaults: {
      ...(aspectRatio === undefined ? {} : { aspectRatio }),
      ...(duration === undefined ? {} : { duration }),
      generateAudio: false,
      ...(imageSize === undefined ? {} : { imageSize }),
      ...(mode === undefined ? {} : { mode }),
      multiShots: false,
      version,
    },
    description: entry.description,
    durations: [...entry.durations],
    imageSizes: [...(entry.imageSizes ?? [])],
    ...(entry.maxReferenceImages === undefined ? {} : { maxReferenceImages: entry.maxReferenceImages }),
    ...(entry.maxReferenceMedia === undefined ? {} : { maxReferenceMedia: entry.maxReferenceMedia }),
    ...(entry.maxReferenceAudio === undefined ? {} : { maxReferenceAudio: entry.maxReferenceAudio }),
    ...(entry.maxReferenceVideos === undefined ? {} : { maxReferenceVideos: entry.maxReferenceVideos }),
    ...(entry.modeControlLabel === undefined ? {} : { modeControlLabel: entry.modeControlLabel }),
    modeLabels: { ...(entry.modeLabels ?? {}) },
    modes: [...entry.modes],
    name: entry.name,
    outputType,
    providerId: entry.providerId,
    ...(entry.requiredReferenceMediaType === undefined
      ? {}
      : { requiredReferenceMediaType: entry.requiredReferenceMediaType }),
    requiresPrompt: entry.requiresPrompt !== false,
    requiresReferenceMedia: entry.requiresReferenceMedia === true,
    service: 'cloud',
    supportsGenerateAudio: entry.supportsGenerateAudio === true,
    supportsImageToVideo: entry.supportsImageToVideo,
    supportsMultiShot: entry.supportsMultiShot === true,
    supportsTextToImage: entry.supportsTextToImage === true,
    supportsTextToVideo: entry.supportsTextToVideo,
    versions: [...entry.versions],
  };
}

async function sha256(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function settingsTokenFor(settings: AgentMediaGenerationModelSettings): Promise<string> {
  return `sha256:${await sha256(JSON.stringify({ schemaVersion: 1, settings }))}`;
}

export async function inspectAgentMediaGenerationModel(
  selection: AgentMediaGenerationSelection,
): Promise<Record<string, unknown>> {
  const entry = resolveCatalogEntry(selection);
  const settings = modelSettings(entry);
  return {
    availableModels: entriesFor(selection.outputType).map((candidate) => ({
      name: candidate.name,
      providerId: candidate.providerId,
    })),
    instruction:
      'Use only values listed in settings. Pass settingsToken unchanged to preview/start; inspect again when the token is rejected.',
    schemaVersion: 1,
    settings,
    settingsToken: await settingsTokenFor(settings),
  };
}

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function assertChoice(
  label: string,
  value: string | undefined,
  choices: readonly string[],
): string | undefined {
  if (value === undefined) return choices[0];
  if (!choices.includes(value)) throw new Error(`${label} must be one of: ${choices.join(', ')}`);
  return value;
}

function referenceKind(mediaType: FlashBoardMediaType): CatalogReferenceInputKind {
  if (mediaType === 'image') return 'image-reference';
  if (mediaType === 'video') return 'video-reference';
  return 'audio-reference';
}

function assertReferences(
  entry: CatalogEntry,
  input: AgentMediaGenerationRequestInput,
): string[] {
  const referenceMediaFileIds = [...new Set(input.referenceMediaFileIds ?? [])];
  const allIds = [...new Set([
    ...referenceMediaFileIds,
    ...(optionalString(input.startMediaFileId) ? [optionalString(input.startMediaFileId)!] : []),
    ...(optionalString(input.endMediaFileId) ? [optionalString(input.endMediaFileId)!] : []),
  ])];
  const files = useMediaStore.getState().files;
  const mediaById = new Map(files.map((file) => [file.id, file]));
  for (const id of allIds) {
    if (!mediaById.has(id)) throw new Error(`Reference media not found: ${id}`);
  }

  const startId = optionalString(input.startMediaFileId);
  const endId = optionalString(input.endMediaFileId);
  if (startId && !entry.referenceInputKinds?.includes('start-frame')) {
    throw new Error(`${entry.name} does not support a start frame.`);
  }
  if (endId && !entry.referenceInputKinds?.includes('end-frame')) {
    throw new Error(`${entry.name} does not support an end frame.`);
  }
  for (const id of referenceMediaFileIds) {
    const mediaType = mediaById.get(id)?.type;
    if (mediaType !== 'image' && mediaType !== 'video' && mediaType !== 'audio') {
      throw new Error(`Unsupported reference media: ${id}`);
    }
    const kind = referenceKind(mediaType);
    const supportsImageByLimit = mediaType === 'image' && (entry.maxReferenceImages ?? 0) > 0;
    const supportsVideoInput = mediaType === 'video'
      && entry.referenceInputKinds?.includes('video-input');
    if (!entry.referenceInputKinds?.includes(kind) && !supportsImageByLimit && !supportsVideoInput) {
      throw new Error(`${entry.name} does not support ${mediaType} references.`);
    }
  }

  const imageCount = referenceMediaFileIds
    .filter((id) => mediaById.get(id)?.type === 'image').length;
  const videoCount = referenceMediaFileIds
    .filter((id) => mediaById.get(id)?.type === 'video').length;
  const audioCount = referenceMediaFileIds
    .filter((id) => mediaById.get(id)?.type === 'audio').length;
  if (
    entry.maxReferenceMedia !== undefined
    && referenceMediaFileIds.length > entry.maxReferenceMedia
  ) {
    throw new Error(`${entry.name} accepts at most ${entry.maxReferenceMedia} reference media items.`);
  }
  if (entry.maxReferenceImages !== undefined && imageCount > entry.maxReferenceImages) {
    throw new Error(`${entry.name} accepts at most ${entry.maxReferenceImages} reference images.`);
  }
  if (entry.maxReferenceVideos !== undefined && videoCount > entry.maxReferenceVideos) {
    throw new Error(`${entry.name} accepts at most ${entry.maxReferenceVideos} reference videos.`);
  }
  if (entry.maxReferenceAudio !== undefined && audioCount > entry.maxReferenceAudio) {
    throw new Error(`${entry.name} accepts at most ${entry.maxReferenceAudio} reference audio files.`);
  }
  if (entry.providerId === 'bytedance/seedance-2-5' && (startId || endId) && referenceMediaFileIds.length > 0) {
    throw new Error('Seedance 2.5 exact first/last frames cannot be combined with multimodal references.');
  }
  if (entry.requiresReferenceMedia && allIds.length === 0) {
    throw new Error(`${entry.name} requires reference media.`);
  }
  if (entry.requiredReferenceMediaType) {
    const required = entry.requiredReferenceMediaType;
    const hasRequired = allIds.some((id) => {
      const type = mediaById.get(id)?.type;
      return required === 'visual' ? type === 'image' || type === 'video' : type === required;
    });
    if (!hasRequired) throw new Error(`${entry.name} requires ${required} reference media.`);
  }
  return referenceMediaFileIds;
}

function validateMultiPrompt(value: FlashBoardMultiShotPrompt[] | null | undefined): FlashBoardMultiShotPrompt[] | undefined {
  if (value === null || value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) {
    throw new Error('multiPrompt must contain between one and six shots.');
  }
  return value.map((shot, index) => {
    if (
      !Number.isInteger(shot.index)
      || shot.index < 1
      || typeof shot.prompt !== 'string'
      || !shot.prompt.trim()
      || shot.prompt.length > 2_000
      || !Number.isFinite(shot.duration)
      || shot.duration <= 0
    ) {
      throw new Error(`multiPrompt[${index}] is invalid.`);
    }
    return { index: shot.index, prompt: shot.prompt.trim(), duration: shot.duration };
  });
}

async function normalizedGenerationRequest(
  input: AgentMediaGenerationRequestInput,
): Promise<FlashBoardGenerationRequest> {
  const entry = resolveCatalogEntry(input);
  const settings = modelSettings(entry);
  const expectedToken = await settingsTokenFor(settings);
  if (input.settingsToken !== expectedToken) {
    throw new Error('The selected model settings changed or were not inspected. Inspect the model again.');
  }
  const prompt = optionalString(input.prompt) ?? '';
  if (prompt.length > 50_000) throw new Error('The generation prompt is too long.');
  if (entry.requiresPrompt !== false && !prompt) throw new Error(`${entry.name} requires a prompt.`);

  const version = assertChoice('version', optionalString(input.version), settings.versions)
    ?? settings.defaults.version;
  const mode = settings.modes.length > 0
    ? assertChoice('mode', optionalString(input.mode), settings.modes)
    : undefined;
  if (settings.modes.length === 0 && optionalString(input.mode)) {
    throw new Error(`${entry.name} does not expose a mode setting.`);
  }
  const aspectRatio = settings.aspectRatios.length > 0
    ? assertChoice('aspectRatio', optionalString(input.aspectRatio), settings.aspectRatios)
    : undefined;
  if (settings.aspectRatios.length === 0 && optionalString(input.aspectRatio)) {
    throw new Error(`${entry.name} does not expose an aspect-ratio setting.`);
  }
  const imageSize = settings.imageSizes.length > 0
    ? assertChoice('imageSize', optionalString(input.imageSize), settings.imageSizes)
    : undefined;
  if (settings.imageSizes.length === 0 && optionalString(input.imageSize)) {
    throw new Error(`${entry.name} does not expose an image-size setting.`);
  }

  let duration: number | undefined;
  if (input.duration !== null && input.duration !== undefined) {
    if (!Number.isFinite(input.duration) || !settings.durations.includes(input.duration)) {
      throw new Error(`duration must be one of: ${settings.durations.join(', ')}`);
    }
    duration = input.duration;
  } else {
    duration = settings.defaults.duration;
  }
  const generateAudio = input.generateAudio === true;
  const multiShots = input.multiShots === true;
  if (generateAudio && !settings.supportsGenerateAudio) {
    throw new Error(`${entry.name} does not support generated audio.`);
  }
  if (multiShots && !settings.supportsMultiShot) {
    throw new Error(`${entry.name} does not support multi-shot generation.`);
  }
  if (entry.providerId === 'cloud-kling' && multiShots && !generateAudio) {
    throw new Error('Kling multi-shot requires generateAudio=true because it always generates sound.');
  }
  const multiPrompt = validateMultiPrompt(input.multiPrompt);
  if (multiPrompt && !multiShots) throw new Error('multiPrompt requires multiShots=true.');
  const referenceMediaFileIds = assertReferences(entry, input);
  const mediaById = new Map(useMediaStore.getState().files.map((file) => [file.id, file]));
  if (entry.providerId === 'cloud-kling' && multiShots) {
    if (optionalString(input.endMediaFileId)) {
      throw new Error('Kling multi-shot does not accept an end frame.');
    }
    const imageAnchorCount = (optionalString(input.startMediaFileId) ? 1 : 0)
      + referenceMediaFileIds.filter((id) => mediaById.get(id)?.type === 'image').length;
    if (imageAnchorCount > 1) {
      throw new Error('Kling multi-shot accepts at most one image anchor.');
    }
  }
  const hasVideoImageInput = Boolean(
    input.startMediaFileId
    || input.endMediaFileId
    || referenceMediaFileIds.some((id) => mediaById.get(id)?.type === 'image'),
  );
  if (input.outputType === 'video') {
    if (hasVideoImageInput && !entry.supportsImageToVideo) {
      throw new Error(`${entry.name} does not support image-to-video generation.`);
    }
    if (!hasVideoImageInput && !entry.supportsTextToVideo) {
      throw new Error(`${entry.name} does not support text-to-video generation.`);
    }
  } else if (!entry.supportsTextToImage) {
    throw new Error(`${entry.name} does not support image generation.`);
  }

  const negativePrompt = optionalString(input.negativePrompt);
  const startMediaFileId = optionalString(input.startMediaFileId);
  const endMediaFileId = optionalString(input.endMediaFileId);
  const idempotencyKey = optionalString(input.idempotencyKey);
  if (idempotencyKey && (idempotencyKey.length > 240 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey))) {
    throw new Error('idempotencyKey is invalid.');
  }
  return {
    service: 'cloud',
    providerId: entry.providerId,
    version,
    ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    outputType: input.outputType,
    ...(mode === undefined ? {} : { mode }),
    prompt,
    ...(negativePrompt === undefined ? {} : { negativePrompt }),
    ...(duration === undefined ? {} : { duration }),
    ...(aspectRatio === undefined ? {} : { aspectRatio }),
    ...(imageSize === undefined ? {} : { imageSize }),
    generateAudio,
    multiShots,
    ...(multiPrompt === undefined ? {} : { multiPrompt }),
    ...(startMediaFileId === undefined ? {} : { startMediaFileId }),
    ...(endMediaFileId === undefined ? {} : { endMediaFileId }),
    referenceMediaFileIds,
  };
}

function publicRecord(record: FlashBoardActiveGenerationRecord): Record<string, unknown> {
  const results = record.results ?? (record.result ? [record.result] : []);
  const jobStatus = record.job?.status ?? 'queued';
  const phase = jobStatus === 'completed' && results.length === 0
    ? 'importing'
    : jobStatus;
  return {
    createdAt: record.createdAt,
    idempotencyKey: record.request?.idempotencyKey,
    ...(phase === 'importing'
      ? {
          instruction: 'Generation is complete and its media import is still in progress. Poll this same record; do not start another generation or switch providers.',
        }
      : {}),
    job: record.job,
    outputs: record.outputs?.map((output) => ({
      availability: output.availability,
      id: output.id,
      importError: output.importError,
      importStatus: output.importStatus,
      mediaFileId: output.mediaFileId,
      mediaType: output.mediaType,
      title: output.title,
    })),
    providerId: record.request?.providerId,
    recordId: record.id,
    phase,
    results,
    terminal: jobStatus === 'failed' || (jobStatus === 'completed' && results.length > 0),
    updatedAt: record.updatedAt,
  };
}

let agentRuntimeSubscribed = false;
const recoverySubmissionIds = new Set<string>();
const agentImportingRecordIds = new Set<string>();

const handleAgentJobUpdate: FlashBoardJobUpdateCallback = (recordId, update) => {
  const record = getFlashBoardActiveGenerationRecord(recordId);
  if (!record?.request?.idempotencyKey?.startsWith(AGENT_GENERATION_KEY_PREFIX)) return;
  if (update.status === 'completed') agentImportingRecordIds.add(recordId);
  if (update.outputs?.length) updateFlashBoardActiveGenerationOutputs(recordId, update.outputs);
  if (update.status === 'failed') {
    agentImportingRecordIds.delete(recordId);
    failFlashBoardActiveGenerationRecord(recordId, update.error || 'Generation failed', update.refund);
    return;
  }
  updateFlashBoardActiveGenerationJob(recordId, {
    status: update.status,
    ...(update.remoteTaskId === undefined ? {} : { remoteTaskId: update.remoteTaskId }),
    ...(update.progress === undefined ? {} : { progress: update.progress }),
    ...(update.startedAt === undefined ? {} : { startedAt: update.startedAt }),
    ...(update.status === 'completed' ? { completedAt: Date.now() } : {}),
    ...(update.error === undefined ? {} : { error: update.error }),
  });
  if (update.status !== 'completed') return;
  if (update.assets?.length) {
    void flashBoardMediaBridge.importGeneratedAssets(recordId, update.assets)
      .catch((error) => failFlashBoardActiveGenerationRecord(
        recordId,
        error instanceof Error ? error.message : 'Failed to import generated media.',
      ))
      .finally(() => agentImportingRecordIds.delete(recordId));
    return;
  }
  if (!update.mediaType || (!update.assetUrl && !update.assetFile)) {
    agentImportingRecordIds.delete(recordId);
    failFlashBoardActiveGenerationRecord(recordId, 'Generation finished without importable media.');
    return;
  }
  const outputId = update.outputs?.length === 1 ? update.outputs[0]?.id : undefined;
  const importPromise = update.assetFile
    ? flashBoardMediaBridge.importGeneratedFile(recordId, update.assetFile, update.mediaType, outputId)
    : flashBoardMediaBridge.importGeneratedMedia(
        recordId,
        update.assetUrl as string,
        update.mediaType,
        outputId,
      );
  void importPromise.catch((error) => failFlashBoardActiveGenerationRecord(
    recordId,
    error instanceof Error ? error.message : 'Failed to import generated media.',
  )).finally(() => agentImportingRecordIds.delete(recordId));
};

function ensureAgentGenerationRuntime(): void {
  if (agentRuntimeSubscribed) return;
  flashBoardJobService.subscribeUpdates(handleAgentJobUpdate);
  const recoverPendingJobs = () => {
    for (const record of getFlashBoardActiveGenerationRecords()) {
      const request = record.request;
      if (
        !request?.idempotencyKey?.startsWith(AGENT_GENERATION_KEY_PREFIX)
        || record.result
        || isFlashBoardCancellationRequested(record)
      ) continue;
      const jobStatus = record.job?.status;
      const remoteTaskId = record.job?.remoteTaskId;
      const canResumeExistingTask = Boolean(remoteTaskId)
        && (
          jobStatus === 'queued'
          || jobStatus === 'processing'
          || (jobStatus === 'completed' && !agentImportingRecordIds.has(record.id))
        );
      if (
        canResumeExistingTask
        && remoteTaskId
        && !flashBoardJobService.hasJob(record.id)
        && !recoverySubmissionIds.has(record.id)
      ) {
        recoverySubmissionIds.add(record.id);
        flashBoardJobService.resume({
          recordId: record.id,
          remoteTaskId,
          request,
        });
      } else if (
        (jobStatus === 'queued' || jobStatus === 'processing')
        &&
        hasDurableFlashBoardProviderIdempotency(request)
        && !flashBoardJobService.hasJob(record.id)
        && !recoverySubmissionIds.has(record.id)
      ) {
        recoverySubmissionIds.add(record.id);
        flashBoardJobService.submit({ recordId: record.id, request });
      }
    }
  };
  subscribeFlashBoardActiveGenerationRecords(recoverPendingJobs);
  agentRuntimeSubscribed = true;
  recoverPendingJobs();
}

export async function previewAgentMediaGeneration(
  input: AgentMediaGenerationRequestInput,
): Promise<Record<string, unknown>> {
  const request = await normalizedGenerationRequest(input);
  return {
    confirmationRequired: true,
    destination: request.outputType === 'image' ? 'AI Gen / Images' : 'AI Gen / Video',
    model: {
      aspectRatio: request.aspectRatio,
      duration: request.duration,
      generateAudio: request.generateAudio,
      imageSize: request.imageSize,
      mode: request.mode,
      multiShots: request.multiShots,
      outputType: request.outputType,
      providerId: request.providerId,
      version: request.version,
    },
    prompt: request.prompt,
    referenceMediaFileIds: [
      ...(request.startMediaFileId ? [request.startMediaFileId] : []),
      ...(request.endMediaFileId ? [request.endMediaFileId] : []),
      ...request.referenceMediaFileIds,
    ],
    schemaVersion: 1,
  };
}

export async function startAgentMediaGeneration(
  input: AgentMediaGenerationRequestInput,
): Promise<Record<string, unknown>> {
  ensureAgentGenerationRuntime();
  const request = await normalizedGenerationRequest(input);
  if (!request.idempotencyKey?.startsWith(AGENT_GENERATION_KEY_PREFIX)) {
    throw new Error(`idempotencyKey must start with ${AGENT_GENERATION_KEY_PREFIX}`);
  }
  const existing = getFlashBoardActiveGenerationRecordByRequestKey(request.idempotencyKey);
  if (existing) return publicRecord(startFlashBoardActiveGenerationRecord(existing.id));

  const workspaceState = useFlashBoardStore.getState();
  const originConversationRef = optionalString(input.originConversationRef);
  const originChatWorkspace = workspaceState.aiWorkspaces.find((workspace) => (
    workspace.kind === 'chat'
    && workspace.chatConversationRef === originConversationRef
  )) ?? workspaceState.aiWorkspaces.find((workspace) => (
    workspace.id === workspaceState.activeAIWorkspaceId && workspace.kind === 'chat'
  ));
  let destinationWorkspaceId = workspaceState.activeAIWorkspaceId;
  if (originChatWorkspace) {
    const generationCount = workspaceState.aiWorkspaces.filter((workspace) => (
      workspace.kind === 'generation'
    )).length;
    destinationWorkspaceId = workspaceState.createAIWorkspace({
      kind: 'generation',
      title: generationCount === 0 ? 'Gen' : `Gen ${generationCount + 1}`,
      outputType: request.outputType ?? 'image',
      providerId: request.providerId,
      draftPrompt: request.prompt,
    }, { activate: false });
  }
  const record = prepareFlashBoardActiveGenerationRequest(request, {
    workspaceId: destinationWorkspaceId,
  });
  return publicRecord(startFlashBoardActiveGenerationRecord(record.id));
}

export function getAgentMediaGenerationStatus(
  input: AgentMediaGenerationStatusInput,
): Record<string, unknown> {
  const recordId = optionalString(input.recordId);
  const idempotencyKey = optionalString(input.idempotencyKey);
  if (!recordId && !idempotencyKey) {
    throw new Error('recordId or idempotencyKey is required.');
  }
  const record = recordId
    ? getFlashBoardActiveGenerationRecord(recordId)
    : getFlashBoardActiveGenerationRecordByRequestKey(idempotencyKey!);
  if (!record?.request?.idempotencyKey?.startsWith(AGENT_GENERATION_KEY_PREFIX)) {
    throw new Error('Media generation job not found.');
  }
  return publicRecord(record);
}

ensureAgentGenerationRuntime();
