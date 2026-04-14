import type { Env } from './env';

const KIEAI_BASE_URL = 'https://api.kie.ai';
const KIEAI_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
// Hosted customer credits are priced at 4x the Kie.ai base cost for break-even.
const HOSTED_KLING_BREAK_EVEN_MULTIPLIER = 4;

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
  status: HostedVideoTaskStatus;
  videoUrl?: string;
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
      ? durationSeconds * (effectiveSound ? 40 : 27)
      : durationSeconds * (effectiveSound ? 30 : 20);

  return baseCost * HOSTED_KLING_BREAK_EVEN_MULTIPLIER;
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
  let videoUrl = payload.data?.resultUrls?.[0];

  if (!videoUrl && payload.data?.resultJson) {
    try {
      const parsed = JSON.parse(payload.data.resultJson) as {
        resultUrls?: string[];
      };
      videoUrl = parsed.resultUrls?.[0];
    } catch {
      videoUrl = undefined;
    }
  }

  return {
    completedAt: status === 'completed' ? new Date().toISOString() : undefined,
    createdAt: new Date().toISOString(),
    error: payload.data?.failMsg ?? payload.msg,
    id: payload.data?.taskId ?? taskId,
    status,
    videoUrl,
  };
}
