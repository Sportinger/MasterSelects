import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MediaRuntimeScrubAudioLeaseOwner,
  mediaRuntimeScrubAudioLeaseOwner,
  toScrubAudioRuntimeSourceId,
} from '../../src/services/mediaRuntime/scrubAudioLeases';
import type { RuntimeSourceId } from '../../src/services/mediaRuntime/types';

function runtimeSourceId(value: string): RuntimeSourceId {
  return value as RuntimeSourceId;
}

function createFakeAudioContext(state: AudioContextState = 'running') {
  const close = vi.fn<[], Promise<void>>(() => Promise.resolve());
  const context = {
    state,
    close,
  } as unknown as AudioContext & { close: typeof close };
  return { context, close };
}

function createFakeAudioBuffer(): AudioBuffer {
  return {
    duration: 1,
    length: 48000,
    numberOfChannels: 2,
    sampleRate: 48000,
  } as AudioBuffer;
}

describe('media runtime scrub audio lease owner', () => {
  afterEach(() => {
    mediaRuntimeScrubAudioLeaseOwner.clear();
    vi.restoreAllMocks();
  });

  it('acquires and releases scrub AudioContext leases idempotently', () => {
    const owner = new MediaRuntimeScrubAudioLeaseOwner();
    const sourceId = runtimeSourceId('scrub-audio:proxy-frame-cache:audio-context');
    const { context, close } = createFakeAudioContext();

    const lease = owner.acquireAudioContext({
      runtimeSourceId: sourceId,
      ownerId: 'proxy-frame-cache:scrub-audio-context',
      createContext: () => context,
    });

    expect(lease.getRuntimeHandles()?.context).toBe(context);
    expect(owner.getStats()).toEqual({
      liveContexts: 1,
      liveElements: 0,
      liveBuffers: 0,
      contextsCreated: 1,
      contextsClosed: 0,
      elementsCreated: 0,
      elementsReleased: 0,
      buffersTracked: 0,
      buffersReleased: 0,
    });

    owner.releaseAudioContext(sourceId, 'done');
    owner.releaseAudioContext(sourceId, 'again');

    expect(close).toHaveBeenCalledTimes(1);
    expect(lease.status).toBe('released');
    expect(owner.getStats()).toEqual({
      liveContexts: 0,
      liveElements: 0,
      liveBuffers: 0,
      contextsCreated: 1,
      contextsClosed: 1,
      elementsCreated: 0,
      elementsReleased: 0,
      buffersTracked: 0,
      buffersReleased: 0,
    });
  });

  it('owns scrub audio element creation and source detachment', () => {
    const owner = new MediaRuntimeScrubAudioLeaseOwner();
    const audio = document.createElement('audio');
    const pause = vi.spyOn(audio, 'pause').mockImplementation(() => undefined);
    const load = vi.spyOn(audio, 'load').mockImplementation(() => undefined);

    const lease = owner.acquireAudioElement({
      runtimeSourceId: runtimeSourceId('scrub-audio:proxy-frame-cache:clip-1:audio-proxy'),
      ownerId: 'proxy-frame-cache:clip-1:audio-proxy',
      createElement: () => audio,
    });
    audio.src = 'blob:scrub-audio';

    expect(lease.getRuntimeHandles()?.element).toBe(audio);
    expect(owner.getAudioElement(lease.runtimeSourceId)).toBe(lease);

    const src = owner.releaseAudioElement(audio, 'done');
    owner.releaseAudioElement(audio, 'again');

    expect(src).toBe('blob:scrub-audio');
    expect(pause).toHaveBeenCalled();
    expect(load).toHaveBeenCalled();
    expect(audio.hasAttribute('src')).toBe(false);
    expect(lease.status).toBe('released');
    expect(owner.getStats()).toMatchObject({
      liveElements: 0,
      elementsCreated: 1,
      elementsReleased: 1,
    });
  });

  it('tracks decoded AudioBuffer leases and releases replaced buffers', () => {
    const owner = new MediaRuntimeScrubAudioLeaseOwner();
    const sourceId = toScrubAudioRuntimeSourceId('proxy-frame-cache:clip-1', 'audio-buffer');
    const firstBuffer = createFakeAudioBuffer();
    const secondBuffer = createFakeAudioBuffer();

    const firstLease = owner.trackAudioBuffer({
      runtimeSourceId: sourceId,
      ownerId: 'proxy-frame-cache:clip-1:audio-buffer',
      buffer: firstBuffer,
      mediaFileId: 'clip-1',
    });
    const secondLease = owner.trackAudioBuffer({
      runtimeSourceId: sourceId,
      ownerId: 'proxy-frame-cache:clip-1:audio-buffer',
      buffer: secondBuffer,
      mediaFileId: 'clip-1',
    });

    expect(firstLease.status).toBe('released');
    expect(secondLease.getRuntimeHandles()?.buffer).toBe(secondBuffer);
    expect(owner.getAudioBuffer(sourceId)).toBe(secondLease);
    expect(owner.getStats()).toMatchObject({
      liveBuffers: 1,
      buffersTracked: 2,
      buffersReleased: 1,
    });

    owner.releaseAudioBuffer(sourceId, 'evict');

    expect(secondLease.status).toBe('released');
    expect(owner.getStats()).toMatchObject({
      liveBuffers: 0,
      buffersTracked: 2,
      buffersReleased: 2,
    });
  });
});
