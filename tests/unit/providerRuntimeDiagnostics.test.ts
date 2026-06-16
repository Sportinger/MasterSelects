import { describe, expect, it } from 'vitest';

import {
  buildWorkerFirstProviderRuntimeSnapshot,
} from '../../src/services/timeline/providerRuntimeDiagnostics';
import {
  createEmptyTimelineRuntimeBridgeStats,
  type RenderResourceDescriptor,
  type RuntimeProviderHealthDiagnostics,
} from '../../src/services/timeline/runtimeCoordinatorContracts';

describe('provider runtime diagnostics', () => {
  it('builds cloneable provider runtime records from retained resources and provider health', () => {
    const provider: RuntimeProviderHealthDiagnostics = {
      providerId: 'provider-a',
      providerKind: 'webcodecs',
      status: 'ok',
      isReady: true,
      bufferedFrameCount: 2,
      averageDecodeLatencyMs: 7,
      currentTimeSeconds: 1.5,
      lastFrameTimeSeconds: 1.5,
      lastFrameAtMs: 123,
    };
    const providerResource: RenderResourceDescriptor = {
      id: 'resource-provider-a',
      kind: 'video-frame-provider',
      policyId: 'interactive',
      owner: {
        ownerId: 'clip-a',
        ownerType: 'clip',
        clipId: 'clip-a',
        mediaFileId: 'media-a',
      },
      source: {
        sourceId: 'source-a',
        mediaFileId: 'media-a',
      },
      runtime: {
        runtimeSourceId: 'source-a',
        runtimeSessionKey: 'interactive:clip-a:source-a',
      },
      memoryCost: {
        decodedFrameBytes: 2048,
      },
      diagnostics: {
        status: 'ok',
        provider,
      },
      providerId: 'provider-a',
      providerKind: 'runtime-frame-provider',
      frameFormat: 'video-frame',
    };
    const htmlVideoResource: RenderResourceDescriptor = {
      id: 'resource-html-video',
      kind: 'html-media',
      policyId: 'interactive',
      owner: {
        ownerId: 'clip-b',
        ownerType: 'clip',
      },
      mediaElementKind: 'video',
      elementId: 'html-video-b',
      diagnostics: {
        status: 'warning',
      },
    };
    const htmlAudioResource: RenderResourceDescriptor = {
      ...htmlVideoResource,
      id: 'resource-html-audio',
      mediaElementKind: 'audio',
      elementId: 'html-audio-b',
    };
    const empty = createEmptyTimelineRuntimeBridgeStats(500);
    const snapshot = buildWorkerFirstProviderRuntimeSnapshot({
      ...empty,
      diagnostics: {
        ...empty.diagnostics,
        resources: [providerResource, htmlVideoResource, htmlAudioResource],
        providers: [provider],
      },
    });

    expect(snapshot.generatedAtMs).toBe(500);
    expect(snapshot.providers).toHaveLength(2);
    expect(snapshot.providers[0]).toMatchObject({
      providerId: 'provider-a',
      providerKind: 'webcodecs',
      resourceId: 'resource-provider-a',
      sourceId: 'source-a',
      sessionKey: 'interactive:clip-a:source-a',
      memoryBytes: 2048,
      bufferedFrameCount: 2,
      averageDecodeLatencyMs: 7,
    });
    expect(snapshot.providers[1]).toMatchObject({
      providerId: 'html-video-b',
      providerKind: 'html-video',
      status: 'warning',
    });
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
  });
});
