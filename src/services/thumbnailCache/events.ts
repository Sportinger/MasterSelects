import type {
  StatusListener,
  ThumbnailCacheEvent,
  ThumbnailCacheEventInput,
  ThumbnailStatus,
} from './types';

const DEFAULT_STATUS_EVENT: ThumbnailCacheEventInput = { type: 'status' };

export class ThumbnailCacheEventBus {
  private status = new Map<string, ThumbnailStatus>();
  private listeners = new Set<StatusListener>();

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(mediaFileId: string): ThumbnailStatus {
    return this.status.get(mediaFileId) ?? 'none';
  }

  notify(
    mediaFileId: string,
    status: ThumbnailStatus,
    event: ThumbnailCacheEventInput = DEFAULT_STATUS_EVENT,
  ): void {
    this.status.set(mediaFileId, status);
    const payload: ThumbnailCacheEvent = {
      mediaFileId,
      status,
      ...event,
    };
    for (const listener of this.listeners) {
      try {
        listener(mediaFileId, status, payload);
      } catch {
        // Ignore subscriber failures.
      }
    }
  }

  deleteStatus(mediaFileId: string): void {
    this.status.delete(mediaFileId);
  }

  clear(): void {
    this.status.clear();
  }
}

