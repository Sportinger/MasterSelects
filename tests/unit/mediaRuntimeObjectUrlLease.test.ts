import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  MediaRuntimeObjectUrlLeaseOwner,
  mediaRuntimeObjectUrlLeaseOwner,
  toObjectUrlRuntimeSourceId,
} from '../../src/services/mediaRuntime/objectUrlLeases';
import type { RuntimeSourceId } from '../../src/services/mediaRuntime/types';
import { blobUrlManager } from '../../src/stores/timeline/helpers/blobUrlManager';

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

function runtimeSourceId(value: string): RuntimeSourceId {
  return value as RuntimeSourceId;
}

function installUrlMocks(urls: string[]) {
  let nextUrl = 0;
  const createObjectURL = vi.fn<[Blob], string>(() => urls[nextUrl++] ?? `blob:lease-${nextUrl}`);
  const revokeObjectURL = vi.fn<[string], void>();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectURL,
  });

  return { createObjectURL, revokeObjectURL };
}

function restoreUrlMocks(): void {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL,
  });
}

describe('media runtime object URL lease owner', () => {
  afterEach(() => {
    mediaRuntimeObjectUrlLeaseOwner.clear();
    restoreUrlMocks();
    vi.restoreAllMocks();
  });

  it('acquires and releases object URL leases idempotently', () => {
    const { createObjectURL, revokeObjectURL } = installUrlMocks(['blob:lease-one']);
    const owner = new MediaRuntimeObjectUrlLeaseOwner();
    const sourceId = runtimeSourceId('object-url:clip-1:file');
    const blob = new Blob(['clip']);

    const lease = owner.acquire({
      runtimeSourceId: sourceId,
      ownerId: 'clip-1',
      blob,
    });

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(lease.status).toBe('active');
    expect(lease.getRuntimeHandles()?.url).toBe('blob:lease-one');
    expect(owner.getStats()).toEqual({ liveLeases: 1, created: 1, revoked: 0 });

    lease.release('done');
    lease.release('again');
    owner.release(sourceId);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lease-one');
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(lease.status).toBe('released');
    expect(lease.getRuntimeHandles()).toBeNull();
    expect(owner.getStats()).toEqual({ liveLeases: 0, created: 1, revoked: 1 });
  });

  it('replaces same-key leases and keeps leak accounting current', () => {
    const { revokeObjectURL } = installUrlMocks(['blob:lease-one', 'blob:lease-two']);
    const owner = new MediaRuntimeObjectUrlLeaseOwner();
    const sourceId = runtimeSourceId('object-url:clip-1:image');

    const firstLease = owner.acquire({
      runtimeSourceId: sourceId,
      ownerId: 'clip-1',
      blob: new Blob(['one']),
    });
    const secondLease = owner.acquire({
      runtimeSourceId: sourceId,
      ownerId: 'clip-1',
      blob: new Blob(['two']),
    });

    expect(firstLease.status).toBe('released');
    expect(secondLease.getRuntimeHandles()?.url).toBe('blob:lease-two');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lease-one');
    expect(owner.getStats()).toEqual({ liveLeases: 1, created: 2, revoked: 1 });

    owner.clear();
    owner.clear();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:lease-two');
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(owner.getStats()).toEqual({ liveLeases: 0, created: 2, revoked: 2 });
  });

  it('keeps the legacy blobUrlManager facade delegated and signature-compatible', () => {
    const { createObjectURL, revokeObjectURL } = installUrlMocks([
      'blob:facade-one',
      'blob:facade-two',
    ]);
    const firstBlob = new Blob(['one']);
    const secondBlob = new Blob(['two']);

    expect(blobUrlManager.create('clip-1', firstBlob, 'image')).toBe('blob:facade-one');
    expect(blobUrlManager.get('clip-1', 'image')).toBe('blob:facade-one');
    expect(blobUrlManager.has('clip-1', 'image')).toBe(true);

    expect(blobUrlManager.create('clip-1', secondBlob, 'image')).toBe('blob:facade-two');
    expect(createObjectURL).toHaveBeenCalledWith(firstBlob);
    expect(createObjectURL).toHaveBeenCalledWith(secondBlob);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:facade-one');
    expect(blobUrlManager.getStats()).toEqual({ active: 1, created: 2, revoked: 1 });

    expect(blobUrlManager.share('clip-1', 'clip-copy', 'image')).toBe('blob:facade-two');
    expect(blobUrlManager.getStats()).toEqual({ active: 2, created: 2, revoked: 1 });

    blobUrlManager.transfer('clip-copy', 'clip-moved', 'image');
    expect(blobUrlManager.get('clip-copy', 'image')).toBeUndefined();
    expect(blobUrlManager.get('clip-moved', 'image')).toBe('blob:facade-two');

    blobUrlManager.revokeAll('clip-1');
    blobUrlManager.revokeMany(['clip-moved']);

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:facade-two');
    expect(blobUrlManager.getStats()).toEqual({ active: 0, created: 2, revoked: 3 });
  });

  it('uses RuntimeSourceId keys for timeline facade entries', () => {
    installUrlMocks(['blob:facade-key']);

    blobUrlManager.create('clip-key', new Blob(['key']), 'model');

    expect(mediaRuntimeObjectUrlLeaseOwner.getUrl(
      toObjectUrlRuntimeSourceId('clip-key', 'model'),
    )).toBe('blob:facade-key');
  });

  it('clears timeline URLs after sharing and transfer while preserving independent cache owners', () => {
    const { revokeObjectURL } = installUrlMocks(['blob:timeline', 'blob:proxy']);
    blobUrlManager.create('clip-source', new Blob(['timeline']), 'audio');
    blobUrlManager.share('clip-source', 'clip-copy', 'audio');
    blobUrlManager.transfer('clip-copy', 'clip-moved', 'audio');
    const proxyLease = mediaRuntimeObjectUrlLeaseOwner.acquire({
      runtimeSourceId: toObjectUrlRuntimeSourceId('proxy-cache', 'audio-proxy'),
      ownerId: 'proxy-cache',
      blob: new Blob(['proxy']),
    });

    blobUrlManager.clear();

    expect(blobUrlManager.has('clip-source', 'audio')).toBe(false);
    expect(blobUrlManager.has('clip-moved', 'audio')).toBe(false);
    expect(proxyLease.status).toBe('active');
    expect(proxyLease.getRuntimeHandles()?.url).toBe('blob:proxy');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:proxy');

    // A full runtime shutdown still owns the independent cache lease.
    mediaRuntimeObjectUrlLeaseOwner.clear();
    expect(proxyLease.status).toBe('released');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:proxy');
  });
});
