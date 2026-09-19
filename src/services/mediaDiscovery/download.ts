import type { MediaDiscoveryAsset, MediaDiscoveryKind } from './types';

const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/ogg': 'ogv',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};

function normalizedMimeType(mimeType: string, kind: MediaDiscoveryKind): string {
  const clean = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  if (clean === 'application/ogg') return kind === 'video' ? 'video/ogg' : 'audio/ogg';
  return clean;
}

function bestMimeType(responseMimeType: string, assetMimeType: string | undefined, kind: MediaDiscoveryKind): string {
  const responseType = normalizedMimeType(responseMimeType, kind);
  if (responseType && responseType !== 'application/octet-stream') return responseType;
  return normalizedMimeType(assetMimeType ?? '', kind) || `${kind}/unknown`;
}

function replaceAsciiControlCharacters(value: string, replacement: string): string {
  return Array.from(value, (character) => (
    character.charCodeAt(0) <= 0x1f ? replacement : character
  )).join('');
}

function safeFilename(title: string, mimeType: string, downloadUrl: string): string {
  const extension = EXTENSION_BY_MIME[mimeType]
    ?? (() => {
      try {
        return new URL(downloadUrl).pathname.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/gu, '');
      } catch {
        return undefined;
      }
    })()
    ?? 'bin';
  const stem = replaceAsciiControlCharacters(title, '_')
    .replace(/\.[a-z\d]{1,8}$/iu, '')
    .replace(/[<>:"/\\|?*]/gu, '_')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 180) || 'download';
  return `${stem}.${extension}`;
}

export async function downloadDiscoveredAsset(
  asset: MediaDiscoveryAsset,
  signal?: AbortSignal,
): Promise<File> {
  if (asset.fileSize && asset.fileSize > MAX_DOWNLOAD_BYTES) {
    throw new Error('This source file is larger than the 250 MB import limit.');
  }
  let response: Response;
  try {
    response = await fetch(asset.downloadUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new Error('The source blocks direct browser downloads. Open the source page to download it manually.');
  }
  if (!response.ok) throw new Error(`The source download failed (${response.status}).`);
  const announcedSize = Number(response.headers.get('Content-Length') ?? 0);
  if (announcedSize > MAX_DOWNLOAD_BYTES) {
    throw new Error('This source file is larger than the 250 MB import limit.');
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('The source returned an empty file.');
  if (blob.size > MAX_DOWNLOAD_BYTES) throw new Error('This source file is larger than the 250 MB import limit.');

  const mimeType = bestMimeType(
    response.headers.get('Content-Type') || blob.type,
    asset.mimeType,
    asset.kind,
  );
  return new File([blob], safeFilename(asset.title, mimeType, asset.downloadUrl), {
    lastModified: Date.now(),
    type: mimeType,
  });
}
