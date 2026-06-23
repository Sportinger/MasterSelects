import type { Env } from './env';

const KIEAI_BASE_URL = 'https://api.kie.ai';
const KIEAI_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
const DEFAULT_SUNO_CALLBACK_URL = 'https://www.masterselects.com/api/ai/suno/callback';
// Hosted customer credits are priced at 6x vendor Kie credits to keep margin after VAT, Stripe, and FX.
const HOSTED_KIE_CREDIT_MULTIPLIER = 6;
const KIEAI_USD_PER_CREDIT = 0.005;
const HOSTED_SUNO_VENDOR_CREDITS = 12;
const SEEDANCE_2_PROVIDER_ID = 'bytedance/seedance-2';
const SEEDANCE_2_FAST_PROVIDER_ID = 'bytedance/seedance-2-fast';
const FLUX_KONTEXT_PRO_PROVIDER_ID = 'flux-kontext-pro';
const FLUX_KONTEXT_MAX_PROVIDER_ID = 'flux-kontext-max';
const RECRAFT_REMOVE_BACKGROUND_PROVIDER_ID = 'recraft/remove-background';
const RECRAFT_CRISP_UPSCALE_PROVIDER_ID = 'recraft/crisp-upscale';
const TOPAZ_IMAGE_UPSCALE_PROVIDER_ID = 'topaz/image-upscale';
const TOPAZ_VIDEO_UPSCALE_PROVIDER_ID = 'topaz/video-upscale';
const VEO_3_1_PROVIDER_ID = 'veo-3.1';
const RUNWAY_VIDEO_PROVIDER_ID = 'runway-video';
const KIEAI_IMAGE_USD_PRICING: Record<string, Record<string, number>> = {
  'nano-banana-2': {
    '1K': 0.04,
    '2K': 0.06,
    '4K': 0.09,
  },
};
const SEEDANCE_CREDITS_PER_SECOND: Record<string, Record<string, { normal: number; videoInput: number }>> = {
  [SEEDANCE_2_PROVIDER_ID]: {
    '480p': { normal: 19, videoInput: 11.5 },
    '720p': { normal: 41, videoInput: 25 },
    '1080p': { normal: 102, videoInput: 62 },
  },
  [SEEDANCE_2_FAST_PROVIDER_ID]: {
    '480p': { normal: 15.5, videoInput: 9 },
    '720p': { normal: 33, videoInput: 20 },
  },
};

export type HostedVideoTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type HostedSunoModelId = 'V5_5' | 'V5' | 'V4_5PLUS' | 'V4_5' | 'V4';
export type HostedSunoVocalGender = 'm' | 'f';

export interface HostedVideoParams {
  aspectRatio?: string;
  duration: number;
  endImageUrl?: string;
  mode?: string;
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>;
  multiShots?: boolean;
  prompt: string;
  provider?: string;
  referenceMedia?: HostedReferenceMedia[];
  sound?: boolean;
  startImageUrl?: string;
}

export type HostedReferenceMediaType = 'audio' | 'image' | 'video';

export interface HostedReferenceMedia {
  fileName?: string;
  label?: string;
  mediaType: HostedReferenceMediaType;
  mimeType?: string;
  source: string;
}

export interface HostedVideoTask {
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  imageUrl?: string;
  progress?: number;
  status: HostedVideoTaskStatus;
  videoUrl?: string;
}

export interface HostedImageParams {
  aspectRatio?: string;
  imageInputs?: string[];
  outputFormat?: 'png' | 'jpeg' | 'webp';
  prompt: string;
  provider: string;
  resolution?: string;
}

export interface HostedSunoParams {
  audioWeight?: number;
  callBackUrl?: string;
  customMode?: boolean;
  instrumental?: boolean;
  model?: string;
  negativeTags?: string;
  prompt: string;
  soundLoop?: boolean;
  style?: string;
  styleWeight?: number;
  title?: string;
  vocalGender?: HostedSunoVocalGender;
  weirdnessConstraint?: number;
}

export interface HostedSunoResult {
  audioUrl: string;
  duration?: number;
  id?: string;
  imageUrl?: string;
  prompt?: string;
  streamAudioUrl?: string;
  tags?: string;
  title?: string;
}

export interface HostedSunoTask {
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  progress?: number;
  results?: HostedSunoResult[];
  status: HostedVideoTaskStatus;
}

interface KieAiCreateTaskResponse {
  code: number;
  data?: {
    taskId?: string;
  };
  msg?: string;
}

interface KieAiUploadResponse {
  data?: {
    downloadUrl?: string;
    fileUrl?: string;
  };
  success?: boolean;
}

interface KieAiStatusResponse {
  code: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    failCode?: string;
    failMsg?: string;
    progress?: number;
    resultJson?: string;
    resultUrls?: string[];
    state?: string;
    taskId?: string;
    updateTime?: number;
  };
  msg?: string;
}

interface KieSunoCreateResponse {
  code?: number;
  data?: {
    taskId?: string;
  };
  msg?: string;
}

interface KieSunoRecordResponse {
  code?: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    errorCode?: string;
    errorMessage?: string;
    response?: {
      sunoData?: unknown[];
    };
    status?: string;
    taskId?: string;
  };
  msg?: string;
}

function getKieAiKey(env: Env): string {
  const apiKey = env.KIEAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error('KIEAI_API_KEY is not configured');
  }

  return apiKey;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);

  if (!match) {
    throw new Error('Invalid data URL');
  }

  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type: mimeType });
}

function getExtensionFromMimeType(mimeType: string | undefined, fallback: string): string {
  switch ((mimeType ?? '').toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/flac':
      return 'flac';
    default:
      return fallback;
  }
}

function getReferenceUploadPath(mediaType: HostedReferenceMediaType): string {
  switch (mediaType) {
    case 'audio':
      return 'audios';
    case 'video':
      return 'videos';
    case 'image':
    default:
      return 'images';
  }
}

function getReferenceFallbackExtension(mediaType: HostedReferenceMediaType): string {
  switch (mediaType) {
    case 'audio':
      return 'mp3';
    case 'video':
      return 'mp4';
    case 'image':
    default:
      return 'jpg';
  }
}

function hasFileExtension(value: string | undefined): boolean {
  return Boolean(value && /\.[a-z0-9]{1,8}$/i.test(value));
}

function sanitizeUploadBaseName(value: string | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  const withoutExtension = trimmed.replace(/\.[a-z0-9]{1,8}$/i, '');
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48);

  return sanitized || fallback;
}

function createReferenceUploadFileName(reference: HostedReferenceMedia, blob: Blob): string {
  const fallbackExtension = getReferenceFallbackExtension(reference.mediaType);
  const extension = hasFileExtension(reference.fileName)
    ? reference.fileName!.split('.').pop()!.toLowerCase()
    : getExtensionFromMimeType(reference.mimeType || blob.type, fallbackExtension);
  const baseName = sanitizeUploadBaseName(reference.fileName || reference.label, reference.mediaType);

  return `${baseName}_${Date.now()}.${extension}`;
}

async function kieAiJsonRequest<T>(
  env: Env,
  endpoint: string,
  method: 'GET' | 'POST',
  body?: object,
): Promise<T> {
  const response = await fetch(`${KIEAI_BASE_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${getKieAiKey(env)}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseText = await response.text();
  let payload: T;

  try {
    payload = JSON.parse(responseText) as T;
  } catch {
    throw new Error(`Kie.ai error: ${response.status} - Invalid JSON response`);
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload &&
      'msg' in payload &&
      typeof payload.msg === 'string'
        ? payload.msg
        : `Kie.ai request failed with status ${response.status}`;

    throw new Error(message);
  }

  return payload;
}

async function uploadImage(env: Env, imageUrl: string): Promise<string> {
  return uploadReferenceMedia(env, {
    fileName: `image_${Date.now()}.jpg`,
    mediaType: 'image',
    source: imageUrl,
  });
}

async function uploadReferenceMedia(env: Env, reference: HostedReferenceMedia): Promise<string> {
  if (reference.source.startsWith('http://') || reference.source.startsWith('https://')) {
    return reference.source;
  }

  const blob = dataUrlToBlob(reference.source);
  const filename = createReferenceUploadFileName(reference, blob);
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('uploadPath', getReferenceUploadPath(reference.mediaType));
  formData.append('fileName', filename);

  const response = await fetch(KIEAI_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKieAiKey(env)}`,
    },
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as KieAiUploadResponse | null;
  const uploadedUrl = payload?.data?.fileUrl ?? payload?.data?.downloadUrl;

  if (!response.ok || !payload?.success || !uploadedUrl) {
    throw new Error(`Kie.ai upload failed with status ${response.status}`);
  }

  return uploadedUrl;
}

async function uploadReferenceMediaList(
  env: Env,
  references: HostedReferenceMedia[] | undefined,
): Promise<Array<HostedReferenceMedia & { url: string }>> {
  const validReferences = (references ?? []).filter((reference) => (
    reference.mediaType === 'image' || reference.mediaType === 'video' || reference.mediaType === 'audio'
  ));

  if (validReferences.length === 0) {
    return [];
  }

  return Promise.all(validReferences.map(async (reference) => ({
    ...reference,
    url: await uploadReferenceMedia(env, reference),
  })));
}

function normalizeTaskStatus(state: string | undefined): HostedVideoTaskStatus {
  switch ((state ?? '').trim().toLowerCase()) {
    case 'success':
    case 'completed':
      return 'completed';
    case 'fail':
    case 'failed':
    case 'failure':
    case 'error':
      return 'failed';
    case 'generating':
    case 'processing':
    case 'running':
      return 'processing';
    case 'queued':
    case 'queuing':
    case 'waiting':
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeKieProgress(progress: number | undefined, status: HostedVideoTaskStatus): number | undefined {
  if (status === 'completed') {
    return 1;
  }

  if (typeof progress !== 'number' || !Number.isFinite(progress)) {
    return undefined;
  }

  if (progress > 1) {
    return Math.max(0, Math.min(1, progress / 100));
  }

  return Math.max(0, Math.min(1, progress));
}

function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
}

function normalizeUpscaleFactor(value: string | undefined): '2' | '4' {
  return value === '4' || value === '4x' || value === '4X' ? '4' : '2';
}

function isFluxKontextProvider(provider: string): boolean {
  return provider === FLUX_KONTEXT_PRO_PROVIDER_ID || provider === FLUX_KONTEXT_MAX_PROVIDER_ID;
}

function isImageUtilityProvider(provider: string): boolean {
  return provider === RECRAFT_REMOVE_BACKGROUND_PROVIDER_ID
    || provider === RECRAFT_CRISP_UPSCALE_PROVIDER_ID
    || provider === TOPAZ_IMAGE_UPSCALE_PROVIDER_ID;
}

function createHostedTaskId(kind: string, taskId: string): string {
  return `${kind}:${taskId}`;
}

function parseHostedTaskId(taskId: string): { kind: string | null; taskId: string } {
  const separatorIndex = taskId.indexOf(':');
  if (separatorIndex <= 0) {
    return { kind: null, taskId };
  }

  const kind = taskId.slice(0, separatorIndex);
  if (kind !== 'flux' && kind !== 'runway' && kind !== 'veo') {
    return { kind: null, taskId };
  }

  return { kind, taskId: taskId.slice(separatorIndex + 1) };
}

function getResultUrl(data: KieAiStatusResponse['data'] | undefined): string | undefined {
  let resultUrl = data?.resultUrls?.[0];

  if (!resultUrl && data?.resultJson) {
    try {
      const parsed = JSON.parse(data.resultJson) as {
        resultUrls?: string[];
        result_urls?: string[];
      };
      resultUrl = parsed.resultUrls?.[0] ?? parsed.result_urls?.[0];
    } catch {
      resultUrl = undefined;
    }
  }

  return resultUrl;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function clampWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.min(1, value));
}

function normalizeSunoModel(model: string | undefined): HostedSunoModelId {
  switch (model) {
    case 'V4':
    case 'V4_5':
    case 'V4_5PLUS':
    case 'V5_5':
    case 'V5':
      return model;
    default:
      return 'V5_5';
  }
}

function normalizeSunoStatus(status: string | undefined): HostedVideoTaskStatus {
  switch ((status ?? '').toUpperCase()) {
    case 'SUCCESS':
      return 'completed';
    case 'CREATE_TASK_FAILED':
    case 'GENERATE_AUDIO_FAILED':
    case 'CALLBACK_EXCEPTION':
    case 'SENSITIVE_WORD_ERROR':
      return 'failed';
    case 'PENDING':
      return 'pending';
    case 'TEXT_SUCCESS':
    case 'FIRST_SUCCESS':
    default:
      return 'processing';
  }
}

function normalizeSunoProgress(status: string | undefined): number | undefined {
  switch ((status ?? '').toUpperCase()) {
    case 'PENDING':
      return 0.05;
    case 'TEXT_SUCCESS':
      return 0.35;
    case 'FIRST_SUCCESS':
      return 0.75;
    case 'SUCCESS':
      return 1;
    default:
      return undefined;
  }
}

function normalizeSunoMusicResult(value: unknown): HostedSunoResult | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const audioUrl = asString(record.audioUrl ?? record.audio_url ?? record.sourceAudioUrl ?? record.source_audio_url);
  if (!audioUrl) {
    return null;
  }

  return {
    audioUrl,
    duration: asNumber(record.duration),
    id: asString(record.id),
    imageUrl: asString(record.imageUrl ?? record.image_url),
    prompt: asString(record.prompt),
    streamAudioUrl: asString(record.streamAudioUrl ?? record.stream_audio_url),
    tags: asString(record.tags),
    title: asString(record.title),
  };
}

function resolveResultType(url: string | undefined): { imageUrl?: string; videoUrl?: string } {
  if (!url) {
    return {};
  }

  const normalizedUrl = url.toLowerCase();
  if (/\.(mp4|mov|m4v|webm|avi)(\?|$)/.test(normalizedUrl)) {
    return { videoUrl: url };
  }

  if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?|$)/.test(normalizedUrl)) {
    return { imageUrl: url };
  }

  return {
    imageUrl: url,
    videoUrl: url,
  };
}

function normalizeMultiPrompt(
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>,
): Array<{ index: number; prompt: string; duration: string }> | undefined {
  const normalized = (multiPrompt ?? [])
    .map((shot, index) => ({
      index: index + 1,
      prompt: typeof shot.prompt === 'string' ? shot.prompt.trim() : '',
      duration: String(Math.max(1, Math.floor(Number(shot.duration) || 0))),
    }))
    .filter((shot) => shot.prompt.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

interface KieAiFluxStatusResponse {
  code?: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    errorMessage?: string;
    failMsg?: string;
    response?: {
      resultImageUrl?: string;
    };
    successFlag?: number;
  };
  msg?: string;
}

interface KieAiVeoStatusResponse {
  code?: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    errorMessage?: string;
    failMsg?: string;
    response?: {
      resultUrl?: string;
      resultUrls?: string[];
      videoUrl?: string;
    };
    successFlag?: number;
  };
  msg?: string;
}

interface KieAiRunwayStatusResponse {
  code?: number;
  data?: {
    completeTime?: number;
    createTime?: number;
    errorMessage?: string;
    failMsg?: string;
    state?: string;
    videoInfo?: {
      videoUrl?: string;
    };
  };
  msg?: string;
}

function getKlingReferenceToken(index: number): string {
  return `ref_${index + 1}`;
}

function applyKlingReferenceTokens(
  prompt: string,
  references: Array<HostedReferenceMedia & { url: string }>,
): string {
  if (references.length === 0) {
    return prompt;
  }

  let nextPrompt = prompt;
  const tokens = references.map((_, index) => getKlingReferenceToken(index));

  tokens.forEach((token, index) => {
    const pattern = new RegExp(`\\bREF\\s*${index + 1}\\b`, 'gi');
    nextPrompt = nextPrompt.replace(pattern, `@${token}`);
  });

  const mentionsReference = tokens.some((token) => new RegExp(`@${token}\\b`, 'i').test(nextPrompt));
  if (mentionsReference) {
    return nextPrompt;
  }

  return `${nextPrompt.trim()} ${tokens.map((token) => `@${token}`).join(' ')}`.trim();
}

function addHostedKlingReferenceInput(
  input: Record<string, unknown>,
  references: Array<HostedReferenceMedia & { url: string }>,
): void {
  if (references.length === 0) {
    return;
  }

  input.kling_elements = references.map((reference, index) => ({
    name: getKlingReferenceToken(index),
    description: reference.label || `Reference ${index + 1}`,
    element_input_urls: [reference.url],
  }));
}

function isSeedanceProvider(provider: string | undefined): provider is typeof SEEDANCE_2_PROVIDER_ID | typeof SEEDANCE_2_FAST_PROVIDER_ID {
  return provider === SEEDANCE_2_PROVIDER_ID || provider === SEEDANCE_2_FAST_PROVIDER_ID;
}

function normalizeSeedanceProvider(provider: string | undefined): typeof SEEDANCE_2_PROVIDER_ID | typeof SEEDANCE_2_FAST_PROVIDER_ID {
  return isSeedanceProvider(provider) ? provider : SEEDANCE_2_PROVIDER_ID;
}

function normalizeSeedanceResolution(
  provider: string | undefined,
  mode: string | undefined,
): '480p' | '720p' | '1080p' {
  if (mode === '480p') {
    return '480p';
  }

  if (mode === '1080p' && provider !== SEEDANCE_2_FAST_PROVIDER_ID) {
    return '1080p';
  }

  return '720p';
}

function normalizeSeedanceDuration(duration: number): number {
  return Math.max(4, Math.min(15, Math.floor(duration)));
}

export function calculateHostedKlingCost(
  mode: string,
  duration: number,
  sound: boolean,
  multiShots = false,
): number {
  const normalizedMode = mode === 'pro' ? 'pro' : 'std';
  const durationSeconds = Math.max(3, Math.min(15, Math.floor(duration)));
  const effectiveSound = multiShots ? true : sound;
  const baseCost =
    normalizedMode === 'pro'
      ? durationSeconds * (effectiveSound ? 27 : 18)
      : durationSeconds * (effectiveSound ? 20 : 14);

  return baseCost * HOSTED_KIE_CREDIT_MULTIPLIER;
}

export function calculateHostedSeedanceCost(
  provider: string,
  mode: string | undefined,
  duration: number,
  hasVideoInput = false,
): number {
  const normalizedProvider = normalizeSeedanceProvider(provider);
  const normalizedMode = normalizeSeedanceResolution(normalizedProvider, mode);
  const durationSeconds = normalizeSeedanceDuration(duration);
  const rates = SEEDANCE_CREDITS_PER_SECOND[normalizedProvider]?.[normalizedMode];
  const vendorCredits = durationSeconds * (hasVideoInput ? rates.videoInput : rates.normal);

  return Math.ceil(vendorCredits * HOSTED_KIE_CREDIT_MULTIPLIER);
}

export function calculateHostedImageCost(provider: string, resolution?: string): number {
  const normalizedResolution = normalizeImageResolution(resolution);
  const usd =
    KIEAI_IMAGE_USD_PRICING[provider]?.[normalizedResolution]
    ?? KIEAI_IMAGE_USD_PRICING['nano-banana-2']?.[normalizedResolution]
    ?? KIEAI_IMAGE_USD_PRICING['nano-banana-2']?.['1K']
    ?? 0.04;
  const vendorCredits = Math.round(usd / KIEAI_USD_PER_CREDIT);

  return vendorCredits * HOSTED_KIE_CREDIT_MULTIPLIER;
}

export function calculateHostedSunoCost(): number {
  return HOSTED_SUNO_VENDOR_CREDITS * HOSTED_KIE_CREDIT_MULTIPLIER;
}

export async function createHostedKlingTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  if (params.provider === RUNWAY_VIDEO_PROVIDER_ID) {
    return createHostedRunwayTask(env, params);
  }

  if (params.provider === VEO_3_1_PROVIDER_ID) {
    return createHostedVeoTask(env, params);
  }

  if (params.provider === TOPAZ_VIDEO_UPSCALE_PROVIDER_ID) {
    return createHostedTopazVideoTask(env, params);
  }

  const imageUrls: string[] = [];
  const multiPrompt = params.multiShots ? normalizeMultiPrompt(params.multiPrompt) : undefined;
  const effectiveSound = params.multiShots ? true : Boolean(params.sound);
  const elementReferences = await uploadReferenceMediaList(
    env,
    (params.referenceMedia ?? [])
      .filter((reference) => reference.mediaType === 'image' || reference.mediaType === 'video')
      .slice(0, 3),
  );
  const prompt = applyKlingReferenceTokens(params.prompt, elementReferences);

  if (params.startImageUrl) {
    imageUrls.push(await uploadImage(env, params.startImageUrl));
  }

  if (params.endImageUrl && !params.multiShots) {
    imageUrls.push(await uploadImage(env, params.endImageUrl));
  }

  const input: Record<string, unknown> = {
    aspect_ratio: params.aspectRatio ?? '16:9',
    duration: String(params.duration),
    mode: params.mode === 'pro' ? 'pro' : 'std',
    multi_shots: Boolean(params.multiShots),
    prompt,
    sound: effectiveSound,
  };

  if (imageUrls.length > 0) {
    input.image_urls = imageUrls;
  }

  if (multiPrompt) {
    input.multi_prompt = multiPrompt.map((shot) => ({
      ...shot,
      prompt: applyKlingReferenceTokens(shot.prompt, elementReferences),
    }));
  }

  addHostedKlingReferenceInput(input, elementReferences);

  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/jobs/createTask', 'POST', {
    input,
    model: 'kling-3.0/video',
  });
  const taskId = payload.data?.taskId;

  if (payload.code !== 200 || !taskId) {
    throw new Error(payload.msg ?? 'Failed to create Kling 3.0 task');
  }

  return { taskId };
}

async function createHostedRunwayTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  const duration = params.duration === 10 ? '10' : '5';
  const referenceImages = params.startImageUrl
    ? []
    : await uploadReferenceMediaList(
        env,
        (params.referenceMedia ?? []).filter((reference) => reference.mediaType === 'image').slice(0, 1),
      );
  const imageUrl = params.startImageUrl ? await uploadImage(env, params.startImageUrl) : referenceImages[0]?.url;
  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/runway/generate', 'POST', {
    aspectRatio: params.aspectRatio ?? '16:9',
    duration,
    ...(imageUrl ? { imageUrl } : {}),
    prompt: params.prompt,
    quality: params.mode === '1080p' && duration !== '10' ? '1080p' : '720p',
    waterMark: '',
  });
  const taskId = payload.data?.taskId;

  if (!taskId) {
    throw new Error(payload.msg ?? 'Failed to create Runway task');
  }

  return { taskId: createHostedTaskId('runway', taskId) };
}

async function createHostedVeoTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  const startImageUrl = params.startImageUrl ? await uploadImage(env, params.startImageUrl) : undefined;
  const endImageUrl = params.endImageUrl ? await uploadImage(env, params.endImageUrl) : undefined;
  const referenceImages = await uploadReferenceMediaList(
    env,
    (params.referenceMedia ?? []).filter((reference) => reference.mediaType === 'image'),
  );
  const imageUrls = [startImageUrl, endImageUrl, ...referenceImages.map((reference) => reference.url)]
    .filter((url): url is string => Boolean(url))
    .slice(0, 3);
  const generationType = startImageUrl && endImageUrl
    ? 'FIRST_AND_LAST_FRAMES_2_VIDEO'
    : imageUrls.length > 0
      ? 'REFERENCE_2_VIDEO'
      : 'TEXT_2_VIDEO';
  const model = params.mode === 'veo3' || params.mode === 'veo3_lite' ? params.mode : 'veo3_fast';
  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/veo/generate', 'POST', {
    aspect_ratio: params.aspectRatio ?? '16:9',
    enableFallback: false,
    enableTranslation: true,
    generationType,
    imageUrls,
    model,
    prompt: params.prompt,
    watermark: '',
  });
  const taskId = payload.data?.taskId;

  if (!taskId) {
    throw new Error(payload.msg ?? 'Failed to create Veo task');
  }

  return { taskId: createHostedTaskId('veo', taskId) };
}

async function createHostedTopazVideoTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  const uploadedVideos = await uploadReferenceMediaList(
    env,
    (params.referenceMedia ?? []).filter((reference) => reference.mediaType === 'video').slice(0, 1),
  );
  const videoUrl = uploadedVideos[0]?.url;

  if (!videoUrl) {
    throw new Error('Add a reference video for Topaz Video Upscale.');
  }

  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/jobs/createTask', 'POST', {
    input: {
      upscale_factor: normalizeUpscaleFactor(params.mode),
      video_url: videoUrl,
    },
    model: TOPAZ_VIDEO_UPSCALE_PROVIDER_ID,
  });
  const taskId = payload.data?.taskId;

  if (payload.code !== 200 || !taskId) {
    throw new Error(payload.msg ?? 'Failed to create Topaz Video Upscale task');
  }

  return { taskId };
}

export async function createHostedSeedanceTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  const provider = normalizeSeedanceProvider(params.provider);
  const uploadedReferences = await uploadReferenceMediaList(env, params.referenceMedia);
  const hasReferenceMedia = uploadedReferences.length > 0;
  const firstFrameUrl = !hasReferenceMedia && params.startImageUrl
    ? await uploadImage(env, params.startImageUrl)
    : undefined;
  const lastFrameUrl = !hasReferenceMedia && params.endImageUrl
    ? await uploadImage(env, params.endImageUrl)
    : undefined;
  const referenceImageUrls = uploadedReferences
    .filter((reference) => reference.mediaType === 'image')
    .map((reference) => reference.url)
    .slice(0, 9);
  const referenceVideoUrls = uploadedReferences
    .filter((reference) => reference.mediaType === 'video')
    .map((reference) => reference.url)
    .slice(0, 3);
  const referenceAudioUrls = uploadedReferences
    .filter((reference) => reference.mediaType === 'audio')
    .map((reference) => reference.url)
    .slice(0, 3);
  const promptGuidance: string[] = [];

  const input: Record<string, unknown> = {
    aspect_ratio: params.aspectRatio ?? '16:9',
    duration: normalizeSeedanceDuration(params.duration),
    generate_audio: hasReferenceMedia ? false : Boolean(params.sound),
    prompt: params.prompt,
    resolution: normalizeSeedanceResolution(provider, params.mode),
    return_last_frame: false,
    web_search: false,
  };

  if (hasReferenceMedia) {
    const startReferenceUrl = params.startImageUrl ? await uploadImage(env, params.startImageUrl) : undefined;
    const endReferenceUrl = params.endImageUrl ? await uploadImage(env, params.endImageUrl) : undefined;
    const anchorImageUrls = [startReferenceUrl, endReferenceUrl].filter((url): url is string => Boolean(url));

    if (anchorImageUrls.length > 0) {
      referenceImageUrls.unshift(...anchorImageUrls);
      referenceImageUrls.length = Math.min(referenceImageUrls.length, 9);
    }

    if (startReferenceUrl) {
      promptGuidance.push('Use the first reference image as the opening image.');
    }

    if (endReferenceUrl) {
      promptGuidance.push(
        startReferenceUrl
          ? 'Use the second reference image as the final image.'
          : 'Use the first reference image as the final image.',
      );
    }
  }

  if (referenceAudioUrls.length > 0) {
    promptGuidance.push('Synchronize visible speech, mouth shapes, and performance timing to the reference audio.');
  }

  if (promptGuidance.length > 0) {
    input.prompt = `${params.prompt.trim()}\n\n${promptGuidance.join(' ')}`.trim();
  }

  if (firstFrameUrl) {
    input.first_frame_url = firstFrameUrl;
  }

  if (lastFrameUrl) {
    input.last_frame_url = lastFrameUrl;
  }

  if (referenceImageUrls.length > 0) {
    input.reference_image_urls = referenceImageUrls;
  }

  if (referenceVideoUrls.length > 0) {
    input.reference_video_urls = referenceVideoUrls;
  }

  if (referenceAudioUrls.length > 0) {
    input.reference_audio_urls = referenceAudioUrls;
  }

  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/jobs/createTask', 'POST', {
    input,
    model: provider,
  });
  const taskId = payload.data?.taskId;

  if (payload.code !== 200 || !taskId) {
    throw new Error(payload.msg ?? 'Failed to create Seedance 2.0 task');
  }

  return { taskId };
}

export async function createHostedImageTask(
  env: Env,
  params: HostedImageParams,
): Promise<{ taskId: string }> {
  const uploadedInputs = params.imageInputs?.length
    ? await Promise.all(params.imageInputs.map((imageUrl) => uploadImage(env, imageUrl)))
    : undefined;
  const firstInput = uploadedInputs?.[0];

  if (isFluxKontextProvider(params.provider)) {
    const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/flux/kontext/generate', 'POST', {
      aspectRatio: params.aspectRatio ?? '16:9',
      enableTranslation: true,
      ...(firstInput ? { inputImage: firstInput } : {}),
      model: params.provider,
      outputFormat: params.outputFormat ?? 'png',
      prompt: params.prompt,
      promptUpsampling: false,
      safetyTolerance: 2,
    });
    const taskId = payload.data?.taskId;

    if (!taskId) {
      throw new Error(payload.msg ?? 'Failed to create Flux Kontext task');
    }

    return { taskId: createHostedTaskId('flux', taskId) };
  }

  if (isImageUtilityProvider(params.provider)) {
    if (!firstInput) {
      throw new Error('Add a reference image for this hosted image utility.');
    }

    const input = params.provider === TOPAZ_IMAGE_UPSCALE_PROVIDER_ID
      ? { image_url: firstInput, upscale_factor: normalizeUpscaleFactor(params.resolution) }
      : { image: firstInput };
    const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/jobs/createTask', 'POST', {
      input,
      model: params.provider,
    });
    const taskId = payload.data?.taskId;

    if (payload.code !== 200 || !taskId) {
      throw new Error(payload.msg ?? 'Failed to create hosted image utility task');
    }

    return { taskId };
  }

  const payload = await kieAiJsonRequest<KieAiCreateTaskResponse>(env, '/api/v1/jobs/createTask', 'POST', {
    input: {
      aspect_ratio: params.aspectRatio ?? '1:1',
      ...(uploadedInputs?.length ? { image_input: uploadedInputs } : {}),
      output_format: params.outputFormat ?? 'png',
      prompt: params.prompt,
      resolution: normalizeImageResolution(params.resolution),
    },
    model: params.provider,
  });
  const taskId = payload.data?.taskId;

  if (payload.code !== 200 || !taskId) {
    throw new Error(payload.msg ?? 'Failed to create hosted image task');
  }

  return { taskId };
}

export async function createHostedSunoMusicTask(
  env: Env,
  params: HostedSunoParams,
): Promise<{ taskId: string }> {
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('Describe the music before generating with Suno.');
  }

  const customMode = params.customMode ?? false;
  const instrumental = params.instrumental ?? true;
  const body: Record<string, unknown> = {
    callBackUrl: params.callBackUrl?.trim() || DEFAULT_SUNO_CALLBACK_URL,
    customMode,
    instrumental,
    model: normalizeSunoModel(params.model),
    prompt,
  };

  if (customMode) {
    const style = params.style?.trim();
    const title = params.title?.trim();
    if (!style || !title) {
      throw new Error('Custom Suno mode needs a title and style.');
    }

    body.style = style;
    body.title = title;
  }

  if (params.negativeTags?.trim()) {
    body.negativeTags = params.negativeTags.trim();
  }
  if (params.vocalGender) {
    body.vocalGender = params.vocalGender;
  }

  body.styleWeight = clampWeight(params.styleWeight, 0.65);
  body.weirdnessConstraint = clampWeight(params.weirdnessConstraint, 0.65);
  body.audioWeight = clampWeight(params.audioWeight, 0.65);

  const payload = await kieAiJsonRequest<KieSunoCreateResponse>(env, '/api/v1/generate', 'POST', body);
  const taskId = payload.data?.taskId;

  if (payload.code !== 200 || !taskId) {
    throw new Error(payload.msg ?? 'Failed to create hosted Suno music task');
  }

  return { taskId };
}

export async function createHostedSunoSoundsTask(
  env: Env,
  params: HostedSunoParams,
): Promise<{ taskId: string }> {
  const prompt = params.prompt.trim();
  if (!prompt) {
    throw new Error('Describe the sound before generating with Suno Sounds.');
  }

  const payload = await kieAiJsonRequest<KieSunoCreateResponse>(env, '/api/v1/generate/sounds', 'POST', {
    callBackUrl: params.callBackUrl?.trim() || DEFAULT_SUNO_CALLBACK_URL,
    grabLyrics: false,
    model: normalizeSunoModel(params.model),
    prompt,
    soundLoop: params.soundLoop === true,
  });
  const taskId = payload.data?.taskId;

  if (!taskId) {
    throw new Error(payload.msg ?? 'Failed to create hosted Suno Sounds task');
  }

  return { taskId };
}

export async function getHostedKlingTask(
  env: Env,
  taskId: string,
): Promise<HostedVideoTask> {
  const parsedTaskId = parseHostedTaskId(taskId);
  if (parsedTaskId.kind === 'flux') {
    return getHostedFluxTask(env, parsedTaskId.taskId, taskId);
  }
  if (parsedTaskId.kind === 'runway') {
    return getHostedRunwayTask(env, parsedTaskId.taskId, taskId);
  }
  if (parsedTaskId.kind === 'veo') {
    return getHostedVeoTask(env, parsedTaskId.taskId, taskId);
  }

  const payload = await kieAiJsonRequest<KieAiStatusResponse>(
    env,
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(parsedTaskId.taskId)}`,
    'GET',
  );
  const status = normalizeTaskStatus(payload.data?.state);
  const resultUrl = getResultUrl(payload.data);
  const { imageUrl, videoUrl } = resolveResultType(resultUrl);

  return {
    completedAt: payload.data?.completeTime
      ? new Date(payload.data.completeTime).toISOString()
      : status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: payload.data?.createTime ? new Date(payload.data.createTime).toISOString() : new Date().toISOString(),
    error: status === 'failed' ? payload.data?.failMsg ?? payload.msg : undefined,
    id: payload.data?.taskId ?? taskId,
    imageUrl,
    progress: normalizeKieProgress(payload.data?.progress, status),
    status,
    videoUrl,
  };
}

async function getHostedFluxTask(env: Env, rawTaskId: string, visibleTaskId: string): Promise<HostedVideoTask> {
  const payload = await kieAiJsonRequest<KieAiFluxStatusResponse>(
    env,
    `/api/v1/flux/kontext/record-info?taskId=${encodeURIComponent(rawTaskId)}`,
    'GET',
  );
  const successFlag = payload.data?.successFlag;
  const status: HostedVideoTaskStatus = successFlag === 1
    ? 'completed'
    : successFlag === 2 || successFlag === 3
      ? 'failed'
      : 'processing';

  return {
    completedAt: payload.data?.completeTime
      ? new Date(payload.data.completeTime).toISOString()
      : status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: payload.data?.createTime ? new Date(payload.data.createTime).toISOString() : new Date().toISOString(),
    error: status === 'failed' ? payload.data?.errorMessage ?? payload.data?.failMsg ?? payload.msg : undefined,
    id: visibleTaskId,
    imageUrl: payload.data?.response?.resultImageUrl,
    progress: normalizeKieProgress(undefined, status),
    status,
  };
}

async function getHostedRunwayTask(env: Env, rawTaskId: string, visibleTaskId: string): Promise<HostedVideoTask> {
  const payload = await kieAiJsonRequest<KieAiRunwayStatusResponse>(
    env,
    `/api/v1/runway/record-detail?taskId=${encodeURIComponent(rawTaskId)}`,
    'GET',
  );
  const status = normalizeTaskStatus(payload.data?.state);

  return {
    completedAt: payload.data?.completeTime
      ? new Date(payload.data.completeTime).toISOString()
      : status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: payload.data?.createTime ? new Date(payload.data.createTime).toISOString() : new Date().toISOString(),
    error: status === 'failed' ? payload.data?.errorMessage ?? payload.data?.failMsg ?? payload.msg : undefined,
    id: visibleTaskId,
    progress: normalizeKieProgress(undefined, status),
    status,
    videoUrl: payload.data?.videoInfo?.videoUrl,
  };
}

async function getHostedVeoTask(env: Env, rawTaskId: string, visibleTaskId: string): Promise<HostedVideoTask> {
  const payload = await kieAiJsonRequest<KieAiVeoStatusResponse>(
    env,
    `/api/v1/veo/record-info?taskId=${encodeURIComponent(rawTaskId)}`,
    'GET',
  );
  const successFlag = payload.data?.successFlag;
  const status: HostedVideoTaskStatus = successFlag === 1
    ? 'completed'
    : successFlag === 2 || successFlag === 3
      ? 'failed'
      : 'processing';

  return {
    completedAt: payload.data?.completeTime
      ? new Date(payload.data.completeTime).toISOString()
      : status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: payload.data?.createTime ? new Date(payload.data.createTime).toISOString() : new Date().toISOString(),
    error: status === 'failed' ? payload.data?.errorMessage ?? payload.data?.failMsg ?? payload.msg : undefined,
    id: visibleTaskId,
    progress: normalizeKieProgress(undefined, status),
    status,
    videoUrl: payload.data?.response?.resultUrls?.[0]
      ?? payload.data?.response?.resultUrl
      ?? payload.data?.response?.videoUrl,
  };
}

export async function getHostedSunoMusicTask(
  env: Env,
  taskId: string,
): Promise<HostedSunoTask> {
  const payload = await kieAiJsonRequest<KieSunoRecordResponse>(
    env,
    `/api/v1/generate/record-info?taskId=${encodeURIComponent(taskId)}`,
    'GET',
  );
  const providerStatus = payload.data?.status;
  const status = normalizeSunoStatus(providerStatus);
  const results = payload.data?.response?.sunoData
    ?.map(normalizeSunoMusicResult)
    .filter((item): item is HostedSunoResult => item !== null);

  return {
    completedAt: payload.data?.completeTime
      ? new Date(payload.data.completeTime).toISOString()
      : status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: payload.data?.createTime ? new Date(payload.data.createTime).toISOString() : new Date().toISOString(),
    error: status === 'failed' ? payload.data?.errorMessage ?? payload.msg : undefined,
    id: payload.data?.taskId ?? taskId,
    progress: normalizeSunoProgress(providerStatus),
    results,
    status,
  };
}
