export type FrameProviderSourceKind =
  | 'video'
  | 'html-video'
  | 'webcodecs'
  | 'native-decoder'
  | 'jpeg-proxy'
  | 'mp4-proxy'
  | 'image'
  | 'document'
  | 'vector'
  | 'model-3d'
  | 'cad'
  | 'data';

export type FrameProviderState =
  | 'cold'
  | 'warming'
  | 'pending'
  | 'ready'
  | 'stale'
  | 'hold'
  | 'dropped'
  | 'recovering'
  | 'failed'
  | 'disposed';

export type FrameProviderSubstatus =
  | 'pendingSeek'
  | 'pendingDecode'
  | 'pendingTransfer'
  | 'decodeAhead'
  | 'late'
  | 'canceled';

export type FrameProviderPriority = 'critical' | 'high' | 'normal' | 'low' | 'idle';

export type FrameProviderRequestMode = 'exact' | 'nearest' | 'hold' | 'prewarm';

export type FrameOwnershipState = 'borrowed' | 'owned' | 'transferred' | 'released' | 'closed';

export interface FrameProviderCounters {
  readonly created: number;
  readonly cloned: number;
  readonly transferred: number;
  readonly imported: number;
  readonly cached: number;
  readonly released: number;
  readonly closed: number;
  readonly lateClosed: number;
  readonly leaked: number;
  readonly fallbackUsed: number;
}

export interface FrameProviderStatus {
  readonly providerId: string;
  readonly sourceId: string;
  readonly sourceKind: FrameProviderSourceKind;
  readonly sessionKey: string;
  readonly generation: number;
  readonly requestId: string | null;
  readonly state: FrameProviderState;
  readonly substatus: readonly FrameProviderSubstatus[];
  readonly mediaTime: number | null;
  readonly frameTimestamp: number | null;
  readonly freshness: 'fresh' | 'nearest' | 'held' | 'stale' | 'missing';
  readonly deadlineTimeMs: number | null;
  readonly priority: FrameProviderPriority;
  readonly outstandingFrameCount: number;
  readonly lastDropReason: string | null;
  readonly fallbackUsed: boolean;
  readonly counters: FrameProviderCounters;
}

export interface FrameProviderRequest {
  readonly requestId: string;
  readonly providerId: string;
  readonly sourceId: string;
  readonly generation: number;
  readonly mediaTime: number;
  readonly deadlineTimeMs: number;
  readonly priority: FrameProviderPriority;
  readonly mode: FrameProviderRequestMode;
  readonly allowFallback: boolean;
}

export interface FramePayloadDescriptor {
  readonly frameId: string;
  readonly payloadKind: 'video-frame' | 'image-bitmap' | 'software-pixels' | 'gpu-ready' | 'none';
  readonly width: number;
  readonly height: number;
  readonly timestamp: number;
  readonly transferable: boolean;
}

export interface FrameReleaseToken {
  readonly tokenId: string;
  readonly providerId: string;
  readonly frameId: string;
  readonly generation: number;
  readonly ownership: FrameOwnershipState;
}

export interface FrameProviderResponse {
  readonly requestId: string;
  readonly providerId: string;
  readonly generation: number;
  readonly state: Extract<FrameProviderState, 'ready' | 'hold' | 'dropped' | 'failed' | 'stale'>;
  readonly payload: FramePayloadDescriptor | null;
  readonly releaseToken: FrameReleaseToken | null;
  readonly mediaTime: number;
  readonly frameTimestamp: number | null;
  readonly freshness: FrameProviderStatus['freshness'];
  readonly late: boolean;
  readonly dropReason: string | null;
}

export type FrameProviderEvent =
  | { readonly type: 'request'; readonly request: FrameProviderRequest }
  | {
      readonly type: 'decoded';
      readonly requestId: string;
      readonly providerId: string;
      readonly generation: number;
      readonly frameId: string;
      readonly timestamp: number;
    }
  | {
      readonly type: 'hold';
      readonly requestId: string;
      readonly providerId: string;
      readonly generation: number;
      readonly reason: string;
    }
  | {
      readonly type: 'drop';
      readonly requestId: string;
      readonly providerId: string;
      readonly generation: number;
      readonly reason: string;
    }
  | {
      readonly type: 'fail';
      readonly requestId: string;
      readonly providerId: string;
      readonly generation: number;
      readonly reason: string;
    }
  | { readonly type: 'release'; readonly token: FrameReleaseToken; readonly outcome: 'presented' | 'canceled' | 'evicted' }
  | { readonly type: 'dispose'; readonly reason: string };

export function createEmptyFrameProviderCounters(): FrameProviderCounters {
  return {
    created: 0,
    cloned: 0,
    transferred: 0,
    imported: 0,
    cached: 0,
    released: 0,
    closed: 0,
    lateClosed: 0,
    leaked: 0,
    fallbackUsed: 0,
  };
}

export function createFrameReleaseToken(input: {
  providerId: string;
  frameId: string;
  generation: number;
  ownership: Exclude<FrameOwnershipState, 'released' | 'closed'>;
}): FrameReleaseToken {
  return {
    tokenId: `${input.providerId}:${input.generation}:${input.frameId}`,
    providerId: input.providerId,
    frameId: input.frameId,
    generation: input.generation,
    ownership: input.ownership,
  };
}

export function isFrameProviderResponseStale(
  request: FrameProviderRequest,
  response: FrameProviderResponse,
): boolean {
  return response.requestId !== request.requestId
    || response.providerId !== request.providerId
    || response.generation !== request.generation;
}

export function isFrameProviderEventStale(
  status: FrameProviderStatus,
  event: Exclude<FrameProviderEvent, { readonly type: 'dispose' }>,
): boolean {
  switch (event.type) {
    case 'request':
      return event.request.providerId !== status.providerId
        || event.request.sourceId !== status.sourceId
        || event.request.generation < status.generation;
    case 'release':
      return event.token.providerId !== status.providerId
        || event.token.generation !== status.generation;
    default:
      return event.providerId !== status.providerId
        || event.generation !== status.generation
        || event.requestId !== status.requestId;
  }
}

export function advanceFrameProviderState(
  status: FrameProviderStatus,
  event: FrameProviderEvent,
): FrameProviderStatus {
  if (status.state === 'disposed') return status;
  if (event.type !== 'dispose' && isFrameProviderEventStale(status, event)) return status;

  switch (event.type) {
    case 'request':
      return {
        ...status,
        requestId: event.request.requestId,
        generation: event.request.generation,
        mediaTime: event.request.mediaTime,
        deadlineTimeMs: event.request.deadlineTimeMs,
        priority: event.request.priority,
        state: event.request.mode === 'prewarm' ? 'warming' : 'pending',
        substatus: event.request.mode === 'hold' ? ['pendingSeek'] : ['pendingDecode'],
      };
    case 'decoded':
      return {
        ...status,
        requestId: event.requestId,
        state: 'ready',
        substatus: [],
        frameTimestamp: event.timestamp,
        freshness: 'fresh',
        outstandingFrameCount: status.outstandingFrameCount + 1,
        counters: { ...status.counters, created: status.counters.created + 1 },
      };
    case 'hold':
      return {
        ...status,
        requestId: event.requestId,
        state: 'hold',
        freshness: 'held',
        lastDropReason: event.reason,
      };
    case 'drop':
      return {
        ...status,
        requestId: event.requestId,
        state: 'dropped',
        substatus: ['late'],
        freshness: 'missing',
        lastDropReason: event.reason,
      };
    case 'fail':
      return {
        ...status,
        requestId: event.requestId,
        state: 'failed',
        substatus: [],
        freshness: 'missing',
        lastDropReason: event.reason,
      };
    case 'release':
      return {
        ...status,
        outstandingFrameCount: Math.max(0, status.outstandingFrameCount - 1),
        counters: {
          ...status.counters,
          released: status.counters.released + 1,
          closed: event.outcome === 'presented' ? status.counters.closed + 1 : status.counters.closed,
          lateClosed: event.outcome === 'canceled' ? status.counters.lateClosed + 1 : status.counters.lateClosed,
        },
      };
    case 'dispose':
      return {
        ...status,
        state: 'disposed',
        substatus: [],
        lastDropReason: event.reason,
      };
  }
}
