export type ThumbnailStatus = 'none' | 'generating' | 'ready' | 'error';

export type ThumbnailCacheEventType =
  | 'status'
  | 'frames-loaded'
  | 'frame-ready'
  | 'memory-evicted'
  | 'source-cleared';

export interface ThumbnailCacheEvent {
  type: ThumbnailCacheEventType;
  mediaFileId: string;
  status: ThumbnailStatus;
  secondIndex?: number;
  secondIndices?: readonly number[];
  count?: number;
}

// Event listeners for status/frame changes (so React can re-render). The third
// argument is optional to keep existing two-argument subscribers compatible.
export type StatusListener = (
  mediaFileId: string,
  status: ThumbnailStatus,
  event?: ThumbnailCacheEvent,
) => void;

export type ThumbnailCacheEventInput = Omit<ThumbnailCacheEvent, 'mediaFileId' | 'status'>;

export type ThumbnailCacheNotify = (
  mediaFileId: string,
  status: ThumbnailStatus,
  event?: ThumbnailCacheEventInput,
) => void;

export interface SourceThumbnailFrame {
  secondIndex: number;
  blob: Blob;
}

export interface StoredSourceThumbnailFrame extends SourceThumbnailFrame {
  id: string;
  mediaFileId: string;
  fileHash?: string;
}

export interface ThumbnailCacheLogger {
  debug(message: string, data?: unknown): void;
  warn(message: string, data?: unknown): void;
}

