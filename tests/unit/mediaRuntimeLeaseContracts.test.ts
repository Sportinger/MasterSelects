import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import { completeArchitectureGateIds } from '../../src/architecture';
import {
  mediaRuntimeLeaseOwnerContracts,
  mediaRuntimeMigrationSourceContracts,
  type MediaRuntimeHandleKind,
} from '../../src/services/mediaRuntime/leaseOwnership';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { validatePersistedStateRuntimeFree } from '../../src/services/mediaRuntime/persistedStateGuard';
import type {
  MediaAssetRef,
  MediaRuntimeLease,
  RenderFrameSource,
  TimelineSourceRef,
} from '../../src/services/mediaRuntime/types';

const repoRoot = process.cwd();

const requiredHandleKinds: readonly MediaRuntimeHandleKind[] = [
  'file',
  'file-system-handle',
  'object-url',
  'html-media-element',
  'video-frame',
  'image-bitmap',
  'gpu-resource',
  'audio-context',
  'worker',
  'decoder-player',
  'service-singleton',
];

function jsonRoundtrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('media runtime lease contracts', () => {
  beforeEach(() => {
    mediaRuntimeRegistry.clear();
  });

  it('keeps durable media and frame refs serializable', () => {
    const assetRef: MediaAssetRef = {
      mediaFileId: 'media-1',
      kind: 'video',
      fileName: 'scene.mp4',
      fingerprint: {
        fileHash: 'sha256-demo',
        fileSize: 1000,
        fileLastModified: 1,
        sourcePath: 'assets/scene.mp4',
      },
      metadata: {
        duration: 12,
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'h264',
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
    const runtimeLease: MediaRuntimeLease = {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:clip-1',
      ownerId: 'clip-1',
      policy: 'interactive',
      acquiredAt: 1,
    };
    const frameSource: RenderFrameSource = {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:clip-1',
      sourceTime: 1.25,
      frameNumber: 30,
      mediaFileId: 'media-1',
      kind: 'video',
    };

    const persistedShape = {
      assetRef,
      sourceRef,
      runtimeLease,
      frameSource,
    };

    expect(structuredClone(persistedShape)).toEqual(persistedShape);
    expect(jsonRoundtrip(persistedShape)).toEqual(persistedShape);
    expect(validatePersistedStateRuntimeFree(persistedShape)).toMatchObject({
      serializable: true,
      structuredClonePassed: true,
      jsonRoundtripPassed: true,
      violations: [],
    });
  });

  it('makes services/mediaRuntime the canonical lease owner for every runtime handle kind', () => {
    const gateIds = new Set(completeArchitectureGateIds);
    const contractKinds = mediaRuntimeLeaseOwnerContracts.map((contract) => contract.handleKind);

    expect(new Set(contractKinds)).toEqual(new Set(requiredHandleKinds));
    expect(contractKinds).toHaveLength(requiredHandleKinds.length);

    for (const contract of mediaRuntimeLeaseOwnerContracts) {
      expect(contract.owner).toBe('services/mediaRuntime');
      expect(contract.owningPath).toMatch(/^src\/services\/mediaRuntime\//);
      expect(gateIds.has(contract.gateId), `${contract.handleKind} references unknown gate`).toBe(true);
    }

    for (const source of mediaRuntimeMigrationSourceContracts) {
      expect(source.targetOwner).toBe('services/mediaRuntime');
      expect(source.legacyOwner).not.toBe(source.targetOwner);
      expect(gateIds.has(source.handoffGate), `${source.id} references unknown gate`).toBe(true);
    }
  });

  it('keeps the registry as the single retained runtime domain', () => {
    const runtime = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-1',
        fileName: 'scene.mp4',
      },
      'clip-1',
    );

    expect(runtime?.sourceId).toBe('media:media-1');
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(1);
    expect(mediaRuntimeRegistry.getRuntime('media:media-1')).toBe(runtime);

    const secondOwner = mediaRuntimeRegistry.retainRuntime(
      {
        kind: 'video',
        mediaFileId: 'media-1',
        fileName: 'scene-renamed.mp4',
      },
      'clip-2',
    );
    expect(secondOwner).toBe(runtime);
    expect(mediaRuntimeRegistry.getRuntime('media:media-1')?.ownerCount()).toBe(2);

    const session = runtime?.getSession('interactive:clip-1', {
      ownerId: 'clip-1',
      policy: 'interactive',
    });
    expect(session?.sourceId).toBe('media:media-1');
    expect(mediaRuntimeRegistry.getSession('media:media-1', 'interactive:clip-1')).toBe(session);

    mediaRuntimeRegistry.releaseRuntime('media:media-1', 'clip-1');
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(1);
    mediaRuntimeRegistry.releaseRuntime('media:media-1', 'clip-2');
    expect(mediaRuntimeRegistry.listRuntimes()).toHaveLength(0);
  });

  it('keeps mediaRuntimeRegistry HMR-safe instead of recreating on every update', () => {
    const source = readFileSync(
      path.join(repoRoot, 'src', 'services', 'mediaRuntime', 'registry.ts'),
      'utf8',
    );

    expect(source).toContain('let mediaRuntimeRegistryInstance');
    expect(source).toContain('import.meta.hot');
    expect(source).toContain('import.meta.hot.accept()');
    expect(source).toContain('hotData.mediaRuntimeRegistry');
    expect(source).toContain('import.meta.hot.dispose');
    expect(source).toContain('data.mediaRuntimeRegistry = mediaRuntimeRegistryInstance');
  });
});
