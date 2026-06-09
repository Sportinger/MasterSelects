import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import type {
  MediaAssetRef,
  MediaRuntimeLease,
  RuntimeSourceId,
  TimelineSourceRef,
} from '../../src/services/mediaRuntime/contracts';
import { validatePersistedStateRuntimeFree } from '../../src/services/mediaRuntime/persistedStateGuard';

const repoRoot = process.cwd();
const runtimeHandlePattern =
  /\b(File|Blob|FileSystemFileHandle|HTMLMediaElement|HTMLVideoElement|HTMLAudioElement|HTMLCanvasElement|AudioContext|VideoFrame|ImageBitmap|GPU[A-Za-z]+|Worker|WebCodecsPlayer|NativeDecoder)\b|createObjectURL|revokeObjectURL/g;

function jsonRoundtrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readContractsSource(): string {
  return readFileSync(
    path.join(repoRoot, 'src', 'services', 'mediaRuntime', 'contracts.ts'),
    'utf8',
  );
}

function extractExportedDeclaration(source: string, name: string): string {
  const match = source.match(
    new RegExp(`export (?:interface|type) ${name}[\\s\\S]*?(?=\\nexport (?:interface|type) |\\n$)`),
  );
  return match?.[0] ?? '';
}

describe('media runtime target contracts', () => {
  it('keeps durable media and timeline source refs runtime-free', () => {
    const mediaAssetRef: MediaAssetRef = {
      origin: 'media-file',
      mediaFileId: 'media-1',
      kind: 'video',
      fileName: 'scene.mp4',
      fingerprint: {
        fileHash: 'sha256-demo',
        fileSize: 1000,
        fileLastModified: 1,
        sourcePath: 'assets/scene.mp4',
        projectPath: 'Raw/scene.mp4',
      },
      metadata: {
        duration: 12,
        width: 1920,
        height: 1080,
        fps: 24,
        codec: 'h264',
        mimeType: 'video/mp4',
      },
    };
    const signalAssetRef: MediaAssetRef = {
      origin: 'signal-asset',
      signalAssetId: 'signal-asset-1',
      signalRefId: 'signal-ref-1',
      artifactId: 'artifact-1',
      kind: 'signal',
      metadata: {
        mimeType: 'application/json',
      },
    };
    const sourceRef: TimelineSourceRef = {
      clipId: 'clip-1',
      sourceType: 'video',
      assetRef: mediaAssetRef,
      mediaFileId: 'media-1',
      sourcePath: 'assets/scene.mp4',
      projectPath: 'Raw/scene.mp4',
    };

    const persistedShape = {
      sourceRef,
      refs: [mediaAssetRef, signalAssetRef],
    };

    expect(structuredClone(persistedShape)).toEqual(persistedShape);
    expect(jsonRoundtrip(persistedShape)).toEqual(persistedShape);
    expect(validatePersistedStateRuntimeFree(persistedShape)).toMatchObject({
      serializable: true,
      structuredClonePassed: true,
      jsonRoundtripPassed: true,
      violations: [],
    });
    expect('runtimeSourceId' in sourceRef).toBe(false);
    expect('runtimeSessionKey' in sourceRef).toBe(false);
  });

  it('keeps runtime leases on the non-persisted lifecycle side', async () => {
    const runtimeHandles = {
      decoderToken: 'runtime-only',
    };
    const lease: MediaRuntimeLease<typeof runtimeHandles> = {
      runtimeSourceId: 'media:media-1' as RuntimeSourceId,
      runtimeSessionKey: 'interactive:clip-1',
      ownerId: 'clip-1',
      policy: 'interactive',
      status: 'pending',
      acquiredAt: 1,
      acquire() {
        this.status = 'active';
        return this;
      },
      release() {
        this.status = 'released';
        this.releasedAt = 2;
      },
      getRuntimeHandles() {
        return runtimeHandles;
      },
    };

    const acquired = await lease.acquire();
    expect(acquired).toBe(lease);
    expect(lease.status).toBe('active');
    expect(lease.getRuntimeHandles()).toBe(runtimeHandles);

    lease.release('test-complete');
    expect(lease.status).toBe('released');
    expect(lease.releasedAt).toBe(2);
    expect(validatePersistedStateRuntimeFree(lease)).toMatchObject({
      serializable: false,
      structuredClonePassed: false,
      jsonRoundtripPassed: true,
      violations: [],
    });
  });

  it('does not define durable ref contracts with runtime handle types or object URL APIs', () => {
    const source = readContractsSource();
    const durableDeclarations = [
      'MediaAssetFingerprint',
      'MediaSourceMetadata',
      'MediaFileAssetRef',
      'SignalMediaAssetRef',
      'ExternalMediaAssetRef',
      'MediaAssetRef',
      'TimelineSourceRef',
    ];

    for (const declarationName of durableDeclarations) {
      const declaration = extractExportedDeclaration(source, declarationName);
      expect(declaration, `${declarationName} declaration should exist`).not.toBe('');
      expect(
        declaration.match(runtimeHandlePattern),
        `${declarationName} must not mention runtime handles`,
      ).toBeNull();
    }
  });
});
