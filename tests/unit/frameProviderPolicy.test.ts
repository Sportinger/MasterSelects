import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  advanceFrameProviderState,
  createEmptyFrameProviderCounters,
  createFrameReleaseToken,
  isFrameProviderEventStale,
  isFrameProviderResponseStale,
  type FrameProviderRequest,
  type FrameProviderResponse,
  type FrameProviderStatus,
} from '../../src/engine/render/contracts/frameProviderPolicy';

const repoRoot = process.cwd();
const contractPath = path.join(repoRoot, 'src', 'engine', 'render', 'contracts', 'frameProviderPolicy.ts');
const forbiddenRuntimePattern =
  /\b(HTMLVideoElement|HTMLImageElement|HTMLCanvasElement|GPU[A-Za-z]+|VideoFrame|ImageBitmap|File|Blob|Map|Set|Layer\[\])\b|from ['"].*(stores|WebGPUEngine|RenderDispatcher)['"]/g;

const request: FrameProviderRequest = {
  requestId: 'request-1',
  providerId: 'provider-1',
  sourceId: 'source-1',
  generation: 3,
  mediaTime: 1.25,
  deadlineTimeMs: 100,
  priority: 'high',
  mode: 'exact',
  allowFallback: true,
};

function status(): FrameProviderStatus {
  return {
    providerId: 'provider-1',
    sourceId: 'source-1',
    sourceKind: 'webcodecs',
    sessionKey: 'source-1:session',
    generation: 2,
    requestId: null,
    state: 'cold',
    substatus: [],
    mediaTime: null,
    frameTimestamp: null,
    freshness: 'missing',
    deadlineTimeMs: null,
    priority: 'normal',
    outstandingFrameCount: 0,
    lastDropReason: null,
    fallbackUsed: false,
    counters: createEmptyFrameProviderCounters(),
  };
}

describe('frame provider policy contracts', () => {
  it('creates deterministic release tokens without runtime frame handles', () => {
    expect(createFrameReleaseToken({
      providerId: 'provider-1',
      frameId: 'frame-9',
      generation: 3,
      ownership: 'owned',
    })).toEqual({
      tokenId: 'provider-1:3:frame-9',
      providerId: 'provider-1',
      frameId: 'frame-9',
      generation: 3,
      ownership: 'owned',
    });
  });

  it('detects stale provider responses by request, provider, and generation', () => {
    const response: FrameProviderResponse = {
      requestId: 'request-1',
      providerId: 'provider-1',
      generation: 3,
      state: 'ready',
      payload: {
        frameId: 'frame-1',
        payloadKind: 'video-frame',
        width: 1920,
        height: 1080,
        timestamp: 1.25,
        transferable: true,
      },
      releaseToken: createFrameReleaseToken({
        providerId: 'provider-1',
        frameId: 'frame-1',
        generation: 3,
        ownership: 'transferred',
      }),
      mediaTime: 1.25,
      frameTimestamp: 1.25,
      freshness: 'fresh',
      late: false,
      dropReason: null,
    };

    expect(isFrameProviderResponseStale(request, response)).toBe(false);
    expect(isFrameProviderResponseStale({ ...request, generation: 4 }, response)).toBe(true);
    expect(structuredClone(response)).toEqual(response);
    expect(JSON.parse(JSON.stringify(response))).toEqual(response);
  });

  it('advances request, decode, release, and dispose states with lifetime counters', () => {
    const pending = advanceFrameProviderState(status(), { type: 'request', request });
    const ready = advanceFrameProviderState(pending, {
      type: 'decoded',
      requestId: 'request-1',
      providerId: 'provider-1',
      generation: 3,
      frameId: 'frame-1',
      timestamp: 1.25,
    });
    const released = advanceFrameProviderState(ready, {
      type: 'release',
      token: createFrameReleaseToken({
        providerId: 'provider-1',
        frameId: 'frame-1',
        generation: 3,
        ownership: 'owned',
      }),
      outcome: 'presented',
    });
    const disposed = advanceFrameProviderState(released, { type: 'dispose', reason: 'project-close' });

    expect(pending.state).toBe('pending');
    expect(pending.substatus).toEqual(['pendingDecode']);
    expect(ready.state).toBe('ready');
    expect(ready.outstandingFrameCount).toBe(1);
    expect(ready.counters.created).toBe(1);
    expect(released.outstandingFrameCount).toBe(0);
    expect(released.counters.released).toBe(1);
    expect(released.counters.closed).toBe(1);
    expect(disposed.state).toBe('disposed');
  });

  it('rejects stale provider events by request, provider, and generation', () => {
    const pending = advanceFrameProviderState(status(), { type: 'request', request });
    const staleDecoded = {
      type: 'decoded',
      requestId: 'old-request',
      providerId: 'provider-1',
      generation: 3,
      frameId: 'frame-old',
      timestamp: 1,
    } as const;
    const staleRelease = {
      type: 'release',
      token: createFrameReleaseToken({
        providerId: 'provider-1',
        frameId: 'frame-old',
        generation: 2,
        ownership: 'owned',
      }),
      outcome: 'canceled',
    } as const;

    expect(isFrameProviderEventStale(pending, staleDecoded)).toBe(true);
    expect(advanceFrameProviderState(pending, staleDecoded)).toBe(pending);
    expect(isFrameProviderEventStale(pending, staleRelease)).toBe(true);
    expect(advanceFrameProviderState(pending, staleRelease)).toBe(pending);
  });

  it('keeps provider policy contracts free of runtime handle tokens', () => {
    const source = readFileSync(contractPath, 'utf8');

    expect(source.match(forbiddenRuntimePattern)).toBeNull();
  });
});
