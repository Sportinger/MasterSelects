import type { GenerationReferenceMedia } from '../piApiService';
import type { KieAiUploadResponse, UploadedReferenceMedia } from './apiContracts';
import {
  BYO_PROXY_UPLOAD_URL,
  UPLOAD_URL,
  canUseSameOriginProxy,
  isRemoteUrl,
} from './config';
import { log } from './log';

export interface KieAiMediaTools {
  uploadImage: (imageSource: string) => Promise<string>;
  uploadReferenceMedia: (
    references: GenerationReferenceMedia[] | undefined,
    allowedTypes?: GenerationReferenceMedia['mediaType'][],
  ) => Promise<UploadedReferenceMedia[]>;
  compressImage: (dataUrl: string, maxWidth?: number, quality?: number) => Promise<string>;
  uploadOptionalImageSource: (imageSource: string | undefined) => Promise<string | undefined>;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }
  const mimeType = match[1];
  const base64 = match[2];
  const binary = atob(base64);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: mimeType });
}

async function sourceToBlob(source: Blob | string): Promise<Blob> {
  if (source instanceof Blob) {
    return source;
  }

  if (source.startsWith('data:')) {
    return dataUrlToBlob(source);
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Failed to read reference media: ${response.status}`);
  }

  return response.blob();
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

function getReferenceUploadPath(mediaType: GenerationReferenceMedia['mediaType']): string {
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

function getReferenceFallbackExtension(mediaType: GenerationReferenceMedia['mediaType']): string {
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

function createUploadFileName(reference: GenerationReferenceMedia, blob: Blob): string {
  const fallbackExtension = getReferenceFallbackExtension(reference.mediaType);
  const extension = hasFileExtension(reference.fileName)
    ? reference.fileName!.split('.').pop()!.toLowerCase()
    : getExtensionFromMimeType(reference.mimeType || blob.type, fallbackExtension);
  const baseName = sanitizeUploadBaseName(reference.fileName || reference.label, reference.mediaType);
  return `${baseName}_${Date.now()}.${extension}`;
}

async function compressImage(dataUrl: string, maxWidth = 1280, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Failed to get canvas context'));
        return;
      }

      ctx.drawImage(img, 0, 0, width, height);
      const compressed = canvas.toDataURL('image/jpeg', quality);
      const sizeKB = Math.round((compressed.length * 0.75) / 1024);
      log.debug(`Compressed image: ${img.width}x${img.height} -> ${width}x${height}, ~${sizeKB}KB`);
      resolve(compressed);
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

export function createKieAiMediaTools(getApiKey: () => string, hasApiKey: () => boolean): KieAiMediaTools {
  const uploadMedia = async (reference: GenerationReferenceMedia): Promise<string> => {
    if (!hasApiKey()) {
      throw new Error('Kie.ai API key not set');
    }

    if (typeof reference.source === 'string' && isRemoteUrl(reference.source)) {
      return reference.source;
    }

    const blob = await sourceToBlob(reference.source);
    const filename = createUploadFileName(reference, blob);
    const formData = new FormData();
    formData.append('file', blob, filename);
    formData.append('uploadPath', getReferenceUploadPath(reference.mediaType));
    formData.append('fileName', filename);

    log.debug('Uploading reference media to Kie.ai', {
      filename,
      mediaType: reference.mediaType,
      sizeKB: Math.round(blob.size / 1024),
    });

    const response = canUseSameOriginProxy()
      ? await fetch(BYO_PROXY_UPLOAD_URL, {
          method: 'POST',
          headers: {
            'x-kieai-api-key': getApiKey(),
          },
          body: formData,
        })
      : await fetch(UPLOAD_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${getApiKey()}`,
          },
          body: formData,
        });

    if (!response.ok) {
      throw new Error(`Kie.ai upload failed: ${response.status}`);
    }

    const result = await response.json() as KieAiUploadResponse;
    const uploadedUrl = result.data?.fileUrl ?? result.data?.downloadUrl;
    if (!result.success || !uploadedUrl) {
      throw new Error('Kie.ai upload failed: no download URL returned');
    }

    log.debug('Uploaded to Kie.ai:', uploadedUrl);
    return uploadedUrl;
  };

  const uploadImage = async (imageSource: string): Promise<string> => uploadMedia({
    mediaType: 'image',
    source: imageSource,
    fileName: `image_${Date.now()}.jpg`,
  });

  return {
    uploadImage,
    uploadReferenceMedia: async (references, allowedTypes) => {
      const filteredReferences = (references ?? []).filter((reference) => (
        !allowedTypes || allowedTypes.includes(reference.mediaType)
      ));

      if (filteredReferences.length === 0) {
        return [];
      }

      return Promise.all(filteredReferences.map(async (reference) => ({
        label: reference.label || reference.fileName,
        mediaType: reference.mediaType,
        url: await uploadMedia(reference),
      })));
    },
    compressImage,
    uploadOptionalImageSource: async (imageSource) => {
      if (!imageSource) {
        return undefined;
      }

      if (isRemoteUrl(imageSource)) {
        return imageSource;
      }

      return uploadImage(await compressImage(imageSource));
    },
  };
}
