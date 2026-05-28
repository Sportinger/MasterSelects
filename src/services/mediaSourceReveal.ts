export type MediaSourceRevealSource = 'timeline' | 'media-queue';

export interface MediaSourceRevealRequest {
  requestId: number;
  mediaFileId: string;
  source: MediaSourceRevealSource;
  createdAt: number;
}

export const MEDIA_SOURCE_REVEAL_EVENT = 'masterselects:media-source-reveal';

let nextRevealRequestId = 1;
let lastRevealRequest: MediaSourceRevealRequest | null = null;

export function requestMediaSourceReveal(
  mediaFileId: string,
  source: MediaSourceRevealSource = 'timeline',
): MediaSourceRevealRequest | null {
  if (!mediaFileId) {
    return null;
  }

  const request: MediaSourceRevealRequest = {
    requestId: nextRevealRequestId,
    mediaFileId,
    source,
    createdAt: Date.now(),
  };
  nextRevealRequestId += 1;
  lastRevealRequest = request;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<MediaSourceRevealRequest>(MEDIA_SOURCE_REVEAL_EVENT, {
      detail: request,
    }));
  }

  return request;
}

export function getLastMediaSourceRevealRequest(): MediaSourceRevealRequest | null {
  return lastRevealRequest;
}

export function isMediaSourceRevealEvent(event: Event): event is CustomEvent<MediaSourceRevealRequest> {
  if (!(event instanceof CustomEvent)) {
    return false;
  }

  const detail = event.detail as Partial<MediaSourceRevealRequest> | undefined;
  return Boolean(
    detail
    && typeof detail.requestId === 'number'
    && typeof detail.mediaFileId === 'string'
    && typeof detail.createdAt === 'number',
  );
}
