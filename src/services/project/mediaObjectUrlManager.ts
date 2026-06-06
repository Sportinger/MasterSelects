type ManagedMediaObjectUrlKey = string;

const PRIMARY_MEDIA_OBJECT_URL_KEY = 'primary';
const THUMBNAIL_MEDIA_OBJECT_URL_KEY = 'thumbnail';

type SequenceFrameWithUrls = {
  modelUrl?: string;
  splatUrl?: string;
};

type MediaObjectUrlFile = {
  id: string;
  url?: string;
  thumbnailUrl?: string;
  proxyVideoUrl?: string;
  audioProxyUrl?: string;
  modelSequence?: { frames: SequenceFrameWithUrls[] };
  gaussianSplatSequence?: { frames: SequenceFrameWithUrls[] };
};

function isBlobUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

export function getModelSequenceFrameObjectUrlKey(frameIndex: number): string {
  return `model-sequence-frame:${frameIndex}`;
}

export function getGaussianSplatSequenceFrameObjectUrlKey(frameIndex: number): string {
  return `gaussian-splat-sequence-frame:${frameIndex}`;
}

export function getPrimaryMediaObjectUrlKey(): string {
  return PRIMARY_MEDIA_OBJECT_URL_KEY;
}

export function getThumbnailMediaObjectUrlKey(): string {
  return THUMBNAIL_MEDIA_OBJECT_URL_KEY;
}

export function getLazyMediaElementObjectUrlKey(kind: 'video' | 'audio', clipId: string): string {
  return `lazy-media-element:${kind}:${clipId}`;
}

export function collectMediaFileObjectUrls(file: MediaObjectUrlFile): Set<string> {
  const urls = new Set<string>();
  const add = (url: unknown) => {
    if (isBlobUrl(url)) {
      urls.add(url);
    }
  };

  add(file.url);
  add(file.thumbnailUrl);
  add(file.proxyVideoUrl);
  add(file.audioProxyUrl);
  file.modelSequence?.frames.forEach((frame) => add(frame.modelUrl));
  file.gaussianSplatSequence?.frames.forEach((frame) => add(frame.splatUrl));
  return urls;
}

class MediaObjectUrlManager {
  private urlsByMediaId = new Map<string, Map<ManagedMediaObjectUrlKey, string>>();

  create(
    mediaId: string,
    key: ManagedMediaObjectUrlKey,
    file: File | Blob,
    options: { revokeExisting?: boolean } = {},
  ): string {
    if (options.revokeExisting !== false) {
      this.revoke(mediaId, key);
    } else {
      this.urlsByMediaId.get(mediaId)?.delete(key);
    }
    const url = URL.createObjectURL(file);
    let urls = this.urlsByMediaId.get(mediaId);
    if (!urls) {
      urls = new Map();
      this.urlsByMediaId.set(mediaId, urls);
    }
    urls.set(key, url);
    return url;
  }

  get(mediaId: string, key: ManagedMediaObjectUrlKey): string | undefined {
    return this.urlsByMediaId.get(mediaId)?.get(key);
  }

  revoke(mediaId: string, key: ManagedMediaObjectUrlKey): string | undefined {
    const urls = this.urlsByMediaId.get(mediaId);
    const url = urls?.get(key);
    if (!urls || !url) {
      return undefined;
    }

    URL.revokeObjectURL(url);
    urls.delete(key);
    if (urls.size === 0) {
      this.urlsByMediaId.delete(mediaId);
    }
    return url;
  }

  revokeMedia(mediaId: string, options: { keepUrls?: Iterable<string> } = {}): Set<string> {
    const revoked = new Set<string>();
    const urls = this.urlsByMediaId.get(mediaId);
    if (!urls) {
      return revoked;
    }

    const keepUrls = new Set(options.keepUrls ?? []);
    for (const [key, url] of urls) {
      if (keepUrls.has(url)) {
        continue;
      }
      URL.revokeObjectURL(url);
      revoked.add(url);
      urls.delete(key);
    }
    if (urls.size === 0) {
      this.urlsByMediaId.delete(mediaId);
    }
    return revoked;
  }

  clear(): Set<string> {
    const revoked = new Set<string>();
    for (const mediaId of [...this.urlsByMediaId.keys()]) {
      for (const url of this.revokeMedia(mediaId)) {
        revoked.add(url);
      }
    }
    return revoked;
  }

  getStats(): { mediaCount: number; urlCount: number } {
    let urlCount = 0;
    for (const urls of this.urlsByMediaId.values()) {
      urlCount += urls.size;
    }
    return {
      mediaCount: this.urlsByMediaId.size,
      urlCount,
    };
  }
}

export const mediaObjectUrlManager = new MediaObjectUrlManager();

export function createMediaObjectUrl(
  mediaId: string,
  key: ManagedMediaObjectUrlKey,
  file: File | Blob,
  options?: { revokeExisting?: boolean },
): string {
  return mediaObjectUrlManager.create(mediaId, key, file, options);
}

export function createPrimaryMediaObjectUrl(
  mediaId: string,
  file: File | Blob,
  options?: { revokeExisting?: boolean },
): string {
  return createMediaObjectUrl(mediaId, getPrimaryMediaObjectUrlKey(), file, options);
}

export function createThumbnailMediaObjectUrl(
  mediaId: string,
  file: File | Blob,
  options?: { revokeExisting?: boolean },
): string {
  return createMediaObjectUrl(mediaId, getThumbnailMediaObjectUrlKey(), file, options);
}

export function revokeMediaFileObjectUrls(
  file: MediaObjectUrlFile,
  options: { keepUrls?: Iterable<string> } = {},
): Set<string> {
  const keepUrls = new Set(options.keepUrls ?? []);
  const revoked = mediaObjectUrlManager.revokeMedia(file.id, { keepUrls });
  for (const url of collectMediaFileObjectUrls(file)) {
    if (!revoked.has(url) && !keepUrls.has(url)) {
      URL.revokeObjectURL(url);
      revoked.add(url);
    }
  }
  return revoked;
}

export function revokeAllMediaObjectUrls(): Set<string> {
  return mediaObjectUrlManager.clear();
}
