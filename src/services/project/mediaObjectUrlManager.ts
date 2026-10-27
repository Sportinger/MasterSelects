import { getRenderableImageBlob } from '../rawImage/rawImageDecode';
import { Logger } from '../logger';

const log = Logger.create('MediaObjectUrls');
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

/** Recently replaced primary URLs, so consumers holding one can switch to the current URL. */
const MAX_REPLACED_PRIMARY_URLS = 256;
/**
 * A replaced primary URL is revoked after this grace period instead of at once: elements of a
 * reopened project may still stream from it until they rebuild from the new URL on their next
 * frame. Revoking under them made each in-flight range request fail with ERR_FILE_NOT_FOUND.
 */
export const REPLACED_PRIMARY_URL_GRACE_MS = 5000;

type RetiredPrimaryUrlListener = (url: string, mediaId: string) => void;
const retiredPrimaryUrlListeners = new Set<RetiredPrimaryUrlListener>();

/**
 * Consumers that stream a primary media URL (lazy timeline elements, scrub preloads) rebuild from
 * the current source when it is retired, instead of failing on the revoked URL.
 */
export function onPrimaryMediaObjectUrlRetired(listener: RetiredPrimaryUrlListener): () => void {
  retiredPrimaryUrlListeners.add(listener);
  return () => { retiredPrimaryUrlListeners.delete(listener); };
}

class MediaObjectUrlManager {
  private primaryBlobs = new Map<string, Blob>();
  private urlsByMediaId = new Map<string, Map<ManagedMediaObjectUrlKey, string>>();
  private replacedPrimaryUrls = new Map<string, string>();

  create(
    mediaId: string,
    key: ManagedMediaObjectUrlKey,
    file: File | Blob,
    options: { revokeExisting?: boolean } = {},
  ): string {
    if (options.revokeExisting !== false && key === PRIMARY_MEDIA_OBJECT_URL_KEY) {
      this.retirePrimary(mediaId);
    } else if (options.revokeExisting !== false) {
      this.revoke(mediaId, key);
    } else {
      this.urlsByMediaId.get(mediaId)?.delete(key);
    }
    if (key === PRIMARY_MEDIA_OBJECT_URL_KEY) this.primaryBlobs.set(mediaId, file);
    const url = URL.createObjectURL(file);
    let urls = this.urlsByMediaId.get(mediaId);
    if (!urls) {
      urls = new Map();
      this.urlsByMediaId.set(mediaId, urls);
    }
    urls.set(key, url);
    return url;
  }

  clonePrimary(sourceId: string, targetId: string): string | undefined {
    const blob = this.primaryBlobs.get(sourceId);
    return blob ? this.create(targetId, PRIMARY_MEDIA_OBJECT_URL_KEY, blob) : undefined;
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
    if (key === PRIMARY_MEDIA_OBJECT_URL_KEY) {
      this.primaryBlobs.delete(mediaId);
      this.rememberReplacedPrimary(url, mediaId);
    }
    urls.delete(key);
    if (urls.size === 0) {
      this.urlsByMediaId.delete(mediaId);
    }
    return url;
  }

  /** Replaces the primary URL: consumers see it as revoked now, the browser releases it after the grace period. */
  private retirePrimary(mediaId: string): void {
    const urls = this.urlsByMediaId.get(mediaId);
    const url = urls?.get(PRIMARY_MEDIA_OBJECT_URL_KEY);
    if (!urls || !url) return;
    this.primaryBlobs.delete(mediaId);
    this.rememberReplacedPrimary(url, mediaId);
    urls.delete(PRIMARY_MEDIA_OBJECT_URL_KEY);
    if (urls.size === 0) this.urlsByMediaId.delete(mediaId);
    setTimeout(() => URL.revokeObjectURL(url), REPLACED_PRIMARY_URL_GRACE_MS);
  }

  private rememberReplacedPrimary(url: string, mediaId: string): void {
    this.replacedPrimaryUrls.delete(url);
    this.replacedPrimaryUrls.set(url, mediaId);
    if (this.replacedPrimaryUrls.size > MAX_REPLACED_PRIMARY_URLS) {
      this.replacedPrimaryUrls.delete(this.replacedPrimaryUrls.keys().next().value!);
    }
    for (const listener of [...retiredPrimaryUrlListeners]) {
      try { listener(url, mediaId); } catch (error) { log.warn('A consumer could not release a retired media URL', { mediaId, error }); }
    }
  }

  /**
   * A revoked primary URL of this media is answered with the current one (or undefined when the
   * media has none): a revoked blob URL only fails with ERR_FILE_NOT_FOUND. Other URLs pass through.
   */
  /** True while `url` is a live URL this manager created and still owns (any media, any key). */
  owns(url: string | undefined): boolean {
    if (!url) return false;
    for (const urls of this.urlsByMediaId.values()) {
      for (const candidate of urls.values()) if (candidate === url) return true;
    }
    return false;
  }

  isRevokedPrimary(url: string | undefined): boolean {
    return url !== undefined && this.replacedPrimaryUrls.has(url);
  }

  resolveCurrentPrimary(mediaId: string, url: string): string | undefined {
    if (this.replacedPrimaryUrls.get(url) !== mediaId) return url;
    return this.get(mediaId, PRIMARY_MEDIA_OBJECT_URL_KEY);
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
      if (key === PRIMARY_MEDIA_OBJECT_URL_KEY) {
        this.primaryBlobs.delete(mediaId);
        this.rememberReplacedPrimary(url, mediaId);
      }
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

export function getPrimaryMediaObjectUrl(mediaId: string): string | undefined {
  return mediaObjectUrlManager.get(mediaId, getPrimaryMediaObjectUrlKey());
}

/** True for a primary media URL this manager revoked: loading it only fails with ERR_FILE_NOT_FOUND. */
/** True while the manager owns `url`: only the manager may revoke it (other media and clips share it). */
export function isManagedMediaObjectUrl(url: string | undefined): boolean {
  return mediaObjectUrlManager.owns(url);
}

export function isRevokedPrimaryMediaObjectUrl(url: string | undefined): boolean {
  return mediaObjectUrlManager.isRevokedPrimary(url);
}

/** See MediaObjectUrlManager.resolveCurrentPrimary. */
export function resolveCurrentPrimaryMediaObjectUrl(mediaId: string, url: string): string | undefined {
  return mediaObjectUrlManager.resolveCurrentPrimary(mediaId, url);
}

export function createPrimaryMediaObjectUrl(
  mediaId: string,
  file: File | Blob,
  options?: { revokeExisting?: boolean },
): string {
  return createMediaObjectUrl(mediaId, getPrimaryMediaObjectUrlKey(), file, options);
}

/** Prepare camera RAW images before granting the normal primary URL ownership. */
export async function createRenderablePrimaryMediaObjectUrl(
  mediaId: string,
  file: File,
  options?: { revokeExisting?: boolean },
): Promise<string> {
  return createPrimaryMediaObjectUrl(mediaId, await getRenderableImageBlob(file), options);
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
