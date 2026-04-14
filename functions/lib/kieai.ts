import type { Env } from './env';

const KIEAI_BASE_URL = 'https://api.kie.ai';
const KIEAI_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
// Hosted customer credits are priced at 5x vendor Kie credits for a small margin.
const HOSTED_KIE_CREDIT_MULTIPLIER = 5;
const KIEAI_USD_PER_CREDIT = 0.005;
const KIEAI_IMAGE_USD_PRICING: Record<string, Record<string, number>> = {
  'nano-banana-2': {
    '1K': 0.04,
    '2K': 0.06,
    '4K': 0.09,
  },
};

export type HostedVideoTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface HostedVideoParams {
  aspectRatio?: string;
  duration: number;
  endImageUrl?: string;
  mode?: string;
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>;
  multiShots?: boolean;
  prompt: string;
  provider?: string;
  sound?: boolean;
  startImageUrl?: string;
}

export interface HostedVideoTask {
  completedAt?: string;
  createdAt: string;
  error?: string;
  id: string;
  imageUrl?: string;
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
  };
  success?: boolean;
}

interface KieAiStatusResponse {
  code: number;
  data?: {
    failMsg?: string;
    resultJson?: string;
    resultUrls?: string[];
    state?: string;
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
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    return imageUrl;
  }

  const blob = dataUrlToBlob(imageUrl);
  const filename = `image_${Date.now()}.jpg`;
  const formData = new FormData();
  formData.append('file', blob, filename);
  formData.append('uploadPath', 'images');
  formData.append('fileName', filename);

  const response = await fetch(KIEAI_UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getKieAiKey(env)}`,
    },
    body: formData,
  });

  const payload = (await response.json().catch(() => null)) as KieAiUploadResponse | null;
  const downloadUrl = payload?.data?.downloadUrl;

  if (!response.ok || !payload?.success || !downloadUrl) {
    throw new Error(`Kie.ai upload failed with status ${response.status}`);
  }

  return downloadUrl;
}

function normalizeTaskStatus(state: string | undefined): HostedVideoTaskStatus {
  switch ((state ?? '').toLowerCase()) {
    case 'success':
      return 'completed';
    case 'processing':
      return 'processing';
    case 'failed':
      return 'failed';
    case 'pending':
    default:
      return 'pending';
  }
}

function normalizeImageResolution(resolution?: string): '1K' | '2K' | '4K' {
  if (resolution === '2K' || resolution === '4K') {
    return resolution;
  }

  return '1K';
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

export async function createHostedKlingTask(
  env: Env,
  params: HostedVideoParams,
): Promise<{ taskId: string }> {
  const imageUrls: string[] = [];
  const multiPrompt = params.multiShots ? normalizeMultiPrompt(params.multiPrompt) : undefined;
  const effectiveSound = params.multiShots ? true : Boolean(params.sound);

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
    prompt: params.prompt,
    sound: effectiveSound,
  };

  if (imageUrls.length > 0) {
    input.image_urls = imageUrls;
  }

  if (multiPrompt) {
    input.multi_prompt = multiPrompt;
  }

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

export async function createHostedImageTask(
  env: Env,
  params: HostedImageParams,
): Promise<{ taskId: string }> {
  const uploadedInputs = params.imageInputs?.length
    ? await Promise.all(params.imageInputs.map((imageUrl) => uploadImage(env, imageUrl)))
    : undefined;

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

export async function getHostedKlingTask(
  env: Env,
  taskId: string,
): Promise<HostedVideoTask> {
  const payload = await kieAiJsonRequest<KieAiStatusResponse>(
    env,
    `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    'GET',
  );
  const status = normalizeTaskStatus(payload.data?.state);
  const resultUrl = getResultUrl(payload.data);
  const { imageUrl, videoUrl } = resolveResultType(resultUrl);

  return {
    completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
    error: payload.data?.failMsg ?? payload.msg,
    id: payload.data?.taskId ?? taskId,
    imageUrl,
    status,
    videoUrl,
  };
}
