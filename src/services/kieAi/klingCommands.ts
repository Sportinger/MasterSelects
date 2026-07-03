import type { ImageToVideoParams, TextToVideoParams } from '../piApiService';
import type { KieAiTaskResponse, UploadedReferenceMedia } from './apiContracts';
import { isRemoteUrl } from './config';
import type { KieAiMediaTools } from './mediaUpload';
import type { KieAiRequest } from './transport';
import { log } from './log';

function normalizeMultiShotPrompt(
  multiPrompt?: Array<{ index: number; prompt: string; duration: number }>
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

function getReferenceToken(index: number): string {
  return `ref_${index + 1}`;
}

interface KlingReferenceElement {
  description: string;
  element_input_urls: string[];
  name: string;
}

function createKlingReferenceElements(references: UploadedReferenceMedia[]): KlingReferenceElement[] {
  const elements: KlingReferenceElement[] = [];
  const imageReferences = references
    .filter((reference) => reference.mediaType === 'image')
    .slice(0, 4);

  if (imageReferences.length >= 2) {
    elements.push({
      description: imageReferences
        .map((reference, index) => reference.label || `Reference ${index + 1}`)
        .join(', '),
      element_input_urls: imageReferences.map((reference) => reference.url),
      name: getReferenceToken(elements.length),
    });
  }

  for (const reference of references) {
    if (reference.mediaType !== 'video' || elements.length >= 3) {
      continue;
    }

    elements.push({
      description: reference.label || `Reference ${elements.length + 1}`,
      element_input_urls: [reference.url],
      name: getReferenceToken(elements.length),
    });
  }

  return elements;
}

function applyKlingReferenceTokens(prompt: string, elements: KlingReferenceElement[]): string {
  if (elements.length === 0) {
    return prompt;
  }

  let nextPrompt = prompt;
  const tokens = elements.map((element) => element.name);

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

function addKlingReferenceInput(input: Record<string, unknown>, elements: KlingReferenceElement[]): void {
  if (elements.length === 0) {
    return;
  }

  input.kling_elements = elements;
}

function addMultiPromptInput(
  input: Record<string, unknown>,
  multiPrompt: ReturnType<typeof normalizeMultiShotPrompt>,
  references: KlingReferenceElement[],
): void {
  if (!multiPrompt) {
    return;
  }

  input.multi_prompt = multiPrompt.map((shot) => ({
    ...shot,
    prompt: applyKlingReferenceTokens(shot.prompt, references),
  }));
}

async function createKlingTask(request: KieAiRequest, body: object, failureMessage: string): Promise<string> {
  const result = await request<KieAiTaskResponse>('/api/v1/jobs/createTask', 'POST', body);

  if (result.code !== 200 || !result.data?.taskId) {
    throw new Error(`Kie.ai error: ${result.msg || failureMessage}`);
  }

  return result.data.taskId;
}

export async function createKlingTextToVideo(
  params: TextToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
  const effectiveSound = params.multiShots ? true : (params.sound ?? false);
  const elementReferences = (await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image', 'video'])).slice(0, 3);
  const referenceElements = createKlingReferenceElements(elementReferences);
  const prompt = applyKlingReferenceTokens(params.prompt, referenceElements);

  const input: Record<string, unknown> = {
    prompt,
    duration: String(params.duration),
    aspect_ratio: params.aspectRatio || '16:9',
    mode: params.mode || 'std',
    sound: effectiveSound,
    multi_shots: Boolean(params.multiShots),
  };

  addMultiPromptInput(input, multiPrompt, referenceElements);
  addKlingReferenceInput(input, referenceElements);

  const body = {
    model: 'kling-3.0/video',
    input,
  };

  log.debug('Creating text-to-video task:', JSON.stringify(body, null, 2));
  return createKlingTask(request, body, 'Failed to create task');
}

export async function createKlingImageToVideo(
  params: ImageToVideoParams,
  request: KieAiRequest,
  mediaTools: KieAiMediaTools,
): Promise<string> {
  const imageUrls: string[] = [];
  const multiPrompt = params.multiShots ? normalizeMultiShotPrompt(params.multiPrompt) : undefined;
  const effectiveSound = params.multiShots ? true : (params.sound ?? false);
  const elementReferences = (await mediaTools.uploadReferenceMedia(params.referenceMedia, ['image', 'video'])).slice(0, 3);
  const referenceElements = createKlingReferenceElements(elementReferences);
  const prompt = applyKlingReferenceTokens(params.prompt, referenceElements);

  if (params.startImageUrl) {
    log.debug('Compressing and uploading start image...');
    const url = isRemoteUrl(params.startImageUrl)
      ? params.startImageUrl
      : await mediaTools.uploadImage(await mediaTools.compressImage(params.startImageUrl));
    imageUrls.push(url);
  }

  if (params.endImageUrl && !params.multiShots) {
    log.debug('Compressing and uploading end image...');
    const url = isRemoteUrl(params.endImageUrl)
      ? params.endImageUrl
      : await mediaTools.uploadImage(await mediaTools.compressImage(params.endImageUrl));
    imageUrls.push(url);
  }

  const input: Record<string, unknown> = {
    prompt,
    duration: String(params.duration),
    aspect_ratio: params.aspectRatio || '16:9',
    mode: params.mode || 'std',
    sound: effectiveSound,
    multi_shots: Boolean(params.multiShots),
  };

  if (imageUrls.length > 0) {
    input.image_urls = imageUrls;
  }

  addMultiPromptInput(input, multiPrompt, referenceElements);
  addKlingReferenceInput(input, referenceElements);

  const body = {
    model: 'kling-3.0/video',
    input,
  };

  log.debug('Creating image-to-video task:', {
    hasStartImage: imageUrls.length >= 1,
    hasEndImage: imageUrls.length >= 2,
  });

  return createKlingTask(request, body, 'Failed to create task');
}
