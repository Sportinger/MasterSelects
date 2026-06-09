import { describe, expect, it } from 'vitest';

import {
  findPersistedRuntimeHandleViolations,
  isPersistedStateRuntimeFree,
  validatePersistedStateRuntimeFree,
} from '../../src/services/mediaRuntime/persistedStateGuard';
import type {
  MediaAssetRef,
  MediaRuntimeLease,
  TimelineSourceRef,
} from '../../src/services/mediaRuntime/types';

class GPUTextureMock {
  label = 'render-target';
}

describe('persisted state runtime handle guard', () => {
  it('allows durable media refs and runtime ids to roundtrip', () => {
    const assetRef: MediaAssetRef = {
      mediaFileId: 'media-1',
      kind: 'video',
      fileName: 'clip.mp4',
      fingerprint: {
        fileHash: 'hash-1',
        fileSize: 42,
        fileLastModified: 1,
        sourcePath: 'assets/clip.mp4',
      },
      metadata: {
        duration: 5,
        width: 1280,
        height: 720,
        fps: 30,
      },
    };
    const sourceRef: TimelineSourceRef = {
      clipId: 'clip-1',
      mediaFileId: 'media-1',
      sourceType: 'video',
      assetRef,
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:clip-1',
    };
    const lease: MediaRuntimeLease = {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:clip-1',
      ownerId: 'clip-1',
      policy: 'interactive',
      acquiredAt: 1,
    };
    const persisted = {
      clips: [{ id: 'clip-1', sourceRef }],
      runtimeRefs: [lease],
      curve: {
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 1, y: 1 },
      },
    };

    const result = validatePersistedStateRuntimeFree(persisted);

    expect(result).toMatchObject({
      serializable: true,
      structuredClonePassed: true,
      jsonRoundtripPassed: true,
      violations: [],
    });
    expect(isPersistedStateRuntimeFree(persisted)).toBe(true);
  });

  it('classifies live runtime handles, object URLs, and runtime objects', () => {
    const unsafe = {
      media: {
        file: new File(['demo'], 'demo.mp4', { type: 'video/mp4', lastModified: 1 }),
        fileHandle: { name: 'demo.mp4' },
      },
      source: {
        url: 'blob:http://localhost/runtime-object-url',
        objectUrl: 'blob:http://localhost/object-url-field',
        videoElement: { currentTime: 0 },
        webCodecsPlayer: { currentTime: 0 },
      },
      frame: {
        videoFrame: { timestamp: 1 },
        texture: { label: 'texture' },
        gpuLease: new GPUTextureMock(),
      },
      audio: {
        mixdownBuffer: { duration: 1 },
      },
      curve: {
        handleIn: { x: 0, y: 0 },
        handleOut: { x: 1, y: 1 },
      },
    };

    const violations = findPersistedRuntimeHandleViolations(unsafe);
    const violationPaths = violations.map((violation) => violation.path);

    expect(violationPaths).toEqual(
      expect.arrayContaining([
        'media.file',
        'media.fileHandle',
        'source.url',
        'source.objectUrl',
        'source.videoElement',
        'source.webCodecsPlayer',
        'frame.videoFrame',
        'frame.texture',
        'frame.gpuLease',
        'audio.mixdownBuffer',
      ]),
    );
    expect(violationPaths).not.toContain('curve.handleIn');
    expect(violationPaths).not.toContain('curve.handleOut');
    expect(violations.find((violation) => violation.path === 'source.url')?.reason).toBe(
      'blob object URL',
    );
    expect(violations.find((violation) => violation.path === 'frame.gpuLease')?.reason).toBe(
      'GPU resource',
    );
    expect(validatePersistedStateRuntimeFree(unsafe).serializable).toBe(false);
    expect(isPersistedStateRuntimeFree(unsafe)).toBe(false);
  });

  it('fails the structured clone side of the guard for non-cloneable persisted state', () => {
    const unsafe = {
      clipId: 'clip-1',
      callback: () => undefined,
    };

    const result = validatePersistedStateRuntimeFree(unsafe);

    expect(result.violations).toEqual([]);
    expect(result.structuredClonePassed).toBe(false);
    expect(result.jsonRoundtripPassed).toBe(true);
    expect(result.serializable).toBe(false);
  });
});
