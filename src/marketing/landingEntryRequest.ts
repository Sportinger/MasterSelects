import type { FlashBoardOutputType } from '../stores/flashboardStore';

export interface LandingEntryRequest {
  id: string;
  mode: 'chat' | 'generate';
  outputType?: FlashBoardOutputType;
  prompt?: string;
  providerId?: string;
  service?: 'cloud';
}

type LandingEntryRequestListener = (request: LandingEntryRequest) => void;

let pendingRequest: LandingEntryRequest | null = null;
const listeners = new Set<LandingEntryRequestListener>();

export function queueLandingEntryRequest(
  request: Omit<LandingEntryRequest, 'id'>,
): LandingEntryRequest {
  const nextRequest: LandingEntryRequest = {
    ...request,
    id: `landing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  };

  pendingRequest = nextRequest;
  listeners.forEach((listener) => listener(nextRequest));
  return nextRequest;
}

export function takeLandingEntryRequest(): LandingEntryRequest | null {
  const request = pendingRequest;
  pendingRequest = null;
  return request;
}

export function subscribeLandingEntryRequests(
  listener: LandingEntryRequestListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
