import { Logger } from '../../../services/logger';
import {
  mediaRuntimeObjectUrlLeaseOwner,
  toObjectUrlRuntimeSourceId,
} from '../../../services/mediaRuntime/objectUrlLeases';

const log = Logger.create('BlobUrlManager');

type UrlType = 'video' | 'audio' | 'image' | 'model' | 'file';

const URL_TYPES: readonly UrlType[] = ['video', 'audio', 'image', 'model', 'file'];

/**
 * Legacy timeline facade for mediaRuntime-owned object URL leases.
 */
class BlobUrlManager {
  /**
   * Create a blob URL for a file and associate it with a clip.
   * Automatically revokes any existing URL of the same type for this clip.
   */
  create(clipId: string, file: File | Blob, type: UrlType = 'file'): string {
    const lease = mediaRuntimeObjectUrlLeaseOwner.acquire({
      runtimeSourceId: toObjectUrlRuntimeSourceId(clipId, type),
      ownerId: clipId,
      blob: file,
      policy: 'interactive',
      cleanupScope: 'timeline-clip',
    });
    return lease.getRuntimeHandles()?.url ?? '';
  }

  /**
   * Get the URL for a clip and type, if it exists.
   */
  get(clipId: string, type: UrlType = 'file'): string | undefined {
    return mediaRuntimeObjectUrlLeaseOwner.getUrl(toObjectUrlRuntimeSourceId(clipId, type));
  }

  /**
   * Check if a clip has a URL of a specific type.
   */
  has(clipId: string, type: UrlType = 'file'): boolean {
    return mediaRuntimeObjectUrlLeaseOwner.has(toObjectUrlRuntimeSourceId(clipId, type));
  }

  /**
   * Revoke a specific URL type for a clip.
   */
  revokeType(clipId: string, type: UrlType): void {
    mediaRuntimeObjectUrlLeaseOwner.release(toObjectUrlRuntimeSourceId(clipId, type));
  }

  /**
   * Revoke all URLs associated with a clip.
   * Call this when removing a clip from the timeline.
   */
  revokeAll(clipId: string): void {
    for (const type of URL_TYPES) {
      this.revokeType(clipId, type);
    }
  }

  /**
   * Revoke URLs for multiple clips.
   * Useful when removing multiple clips at once.
   */
  revokeMany(clipIds: string[]): void {
    for (const clipId of clipIds) {
      this.revokeAll(clipId);
    }
  }

  /**
   * Transfer URL ownership from one clip to another.
   * Useful when splitting clips.
   */
  transfer(fromClipId: string, toClipId: string, type: UrlType): void {
    mediaRuntimeObjectUrlLeaseOwner.transfer(
      toObjectUrlRuntimeSourceId(fromClipId, type),
      toObjectUrlRuntimeSourceId(toClipId, type),
      toClipId,
      { replaceExisting: false },
    );
  }

  /**
   * Clone URL reference for a new clip (e.g., when splitting).
   * The URL is shared, so only the last clip should revoke it.
   * Returns the shared URL.
   */
  share(fromClipId: string, toClipId: string, type: UrlType): string | undefined {
    return mediaRuntimeObjectUrlLeaseOwner.share(
      toObjectUrlRuntimeSourceId(fromClipId, type),
      toObjectUrlRuntimeSourceId(toClipId, type),
      toClipId,
      { replaceExisting: false },
    );
  }

  /**
   * Get statistics about URL usage.
   */
  getStats(): { active: number; created: number; revoked: number } {
    const stats = mediaRuntimeObjectUrlLeaseOwner.getStats();
    return {
      active: stats.liveLeases,
      created: stats.created,
      revoked: stats.revoked,
    };
  }

  /**
   * Clear timeline-owned URLs without revoking media-wide proxy cache leases.
   */
  clear(): void {
    mediaRuntimeObjectUrlLeaseOwner.clear('timeline-clip');
  }

  /**
   * Debug: log all tracked URLs.
   */
  debug(): void {
    log.debug('Active URLs:');
    for (const lease of mediaRuntimeObjectUrlLeaseOwner.listLeases()) {
      log.debug('URL entry', {
        runtimeSourceId: lease.runtimeSourceId,
        ownerId: lease.ownerId,
        url: lease.url,
        ageMs: Date.now() - lease.createdAt,
      });
    }
    log.debug('Stats', this.getStats());
  }
}

export const blobUrlManager = new BlobUrlManager();

// Export class for testing
export { BlobUrlManager };
