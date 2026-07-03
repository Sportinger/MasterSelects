import type { MediaBoardGroupOffset } from './types';

const MEDIA_BOARD_PLACEMENT_EVENT = 'masterselects:media-board-placement';

export interface MediaBoardPlacementRequest {
  itemIds: string[];
  point?: MediaBoardGroupOffset;
  nearItemId?: string;
}

export function requestMediaBoardPlacement(request: MediaBoardPlacementRequest): void {
  if (typeof window === 'undefined' || request.itemIds.length === 0) return;
  window.dispatchEvent(new CustomEvent(MEDIA_BOARD_PLACEMENT_EVENT, { detail: request }));
}

export function subscribeMediaBoardPlacementRequests(
  handler: (request: MediaBoardPlacementRequest) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const listener = (event: Event) => {
    const detail = (event as CustomEvent<MediaBoardPlacementRequest>).detail;
    if (!detail?.itemIds?.length) return;
    handler(detail);
  };

  window.addEventListener(MEDIA_BOARD_PLACEMENT_EVENT, listener);
  return () => window.removeEventListener(MEDIA_BOARD_PLACEMENT_EVENT, listener);
}
