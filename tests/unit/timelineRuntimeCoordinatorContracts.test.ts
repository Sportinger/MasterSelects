import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip, TimelineTrack } from '../../src/types';
import {
  RUNTIME_PROVIDER_DEMAND_OWNER_TYPES,
  RUNTIME_PROVIDER_LEASE_POLICIES,
  TIMELINE_RUNTIME_PROVIDER_POLICIES,
  TIMELINE_RUNTIME_RESOURCE_KINDS,
  isRuntimeProviderDemand,
  type RuntimeProviderDemand,
} from '../../src/timeline';
import type { FrameContext } from '../../src/services/layerBuilder/types';
import {
  hydrateTimelineMediaWindow,
  releaseAllLazyTimelineMediaElements,
} from '../../src/services/timeline/lazyMediaElements';
import {
  releaseReportedClipRuntimeResources,
  reportClipRuntimeResources,
  reservePlannedClipRuntimeResources,
} from '../../src/services/timeline/runtimeResourceReporting';
import {
  RENDER_RESOURCE_KINDS,
  TIMELINE_RUNTIME_POLICY_DESCRIPTORS,
  TIMELINE_RUNTIME_POLICY_IDS,
  createEmptyTimelineRuntimeBridgeStats,
  createTimelineRuntimePolicyRegistry,
  isPlainTimelineRuntimeBridgeStats,
  isRenderResourceDescriptor,
} from '../../src/services/timeline/runtimeCoordinatorContracts';
import {
  createRenderResourceDescriptorFromDemand,
  reserveRuntimeProviderDemandResource,
} from '../../src/services/timeline/runtimeProviderDemandBridge';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';
import {
  getNativeDecoderForTimelineClip,
  getNativeDecoderRuntimeRecordCount,
  registerNativeDecoderForTimelineClip,
  releaseAllNativeDecoderRuntimeRecords,
} from '../../src/services/timeline/nativeDecoderRuntimeRegistry';
import type {
  RenderResourceDescriptor,
  RuntimeProviderHealthDiagnostics,
  RuntimeSessionHealthDiagnostics,
  TimelineRuntimeCoordinatorBridgeStats,
} from '../../src/services/timeline/runtimeCoordinatorTypes';

const noop = () => undefined;

const owner = {
  ownerId: 'clip-1',
  ownerType: 'clip' as const,
  clipId: 'clip-1',
  trackId: 'track-1',
};

const sampleResources: readonly RenderResourceDescriptor[] = [
  {
    id: 'resource-frame-provider',
    kind: 'video-frame-provider',
    policyId: 'interactive',
    owner,
    providerId: 'provider-1',
    providerKind: 'webcodecs',
    frameFormat: 'video-frame',
    runtime: {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:track-1:media:media-1',
    },
    memoryCost: {
      decodedFrameBytes: 1920 * 1080 * 4,
    },
    diagnostics: {
      status: 'ok',
      provider: {
        providerId: 'provider-1',
        providerKind: 'webcodecs',
        status: 'ok',
        decodeQueueDepth: 1,
      },
    },
  },
  {
    id: 'resource-html-media',
    kind: 'html-media',
    policyId: 'thumbnail',
    owner,
    mediaElementKind: 'video',
    elementId: 'video-element-1',
    srcKind: 'blob-url',
    diagnostics: {
      status: 'warning',
      provider: {
        providerId: 'video-element-1',
        providerKind: 'html-video',
        status: 'warning',
        readyState: 2,
        networkState: 1,
      },
    },
  },
  {
    id: 'resource-image-canvas',
    kind: 'image-canvas',
    policyId: 'render-target',
    owner,
    imageKind: 'offscreen-canvas',
    imageId: 'canvas-1',
    dimensions: {
      width: 1920,
      height: 1080,
    },
  },
  {
    id: 'resource-native-decoder',
    kind: 'native-decoder',
    policyId: 'export',
    owner,
    decoderId: 'native-decoder-1',
    codec: 'prores',
    container: 'mov',
  },
  {
    id: 'resource-nested-composition',
    kind: 'nested-composition-texture',
    policyId: 'composition-render',
    owner: {
      ownerId: 'composition-1',
      ownerType: 'composition',
      compositionId: 'composition-1',
    },
    compositionId: 'composition-1',
    textureId: 'nested-texture-1',
    depth: 2,
    layerCount: 4,
    memoryCost: {
      gpuBytes: 1920 * 1080 * 4,
    },
  },
  {
    id: 'resource-gpu-texture',
    kind: 'gpu-texture',
    policyId: 'ram-preview',
    owner: {
      ownerId: 'ram-preview:frame-cache',
      ownerType: 'ram-preview',
    },
    textureId: 'ram-preview-frame-texture-1',
    textureKind: 'ram-preview-frame',
    format: 'rgba8unorm',
    dimensions: {
      width: 1920,
      height: 1080,
    },
    memoryCost: {
      gpuBytes: 1920 * 1080 * 4,
    },
  },
  {
    id: 'resource-model',
    kind: 'model',
    policyId: 'interactive',
    owner,
    modelId: 'model-1',
    modelKind: 'gltf',
  },
  {
    id: 'resource-gaussian-splat',
    kind: 'gaussian-splat',
    policyId: 'background',
    owner,
    splatId: 'splat-1',
    splatCount: 1000,
  },
  {
    id: 'resource-motion',
    kind: 'motion-data',
    policyId: 'slot-deck',
    owner,
    payloadId: 'motion-1',
    payloadKind: 'motion-layer',
  },
  {
    id: 'resource-audio-buffer',
    kind: 'audio-buffer',
    policyId: 'export',
    owner,
    audioBufferId: 'audio-buffer-1',
    dimensions: {
      sampleRate: 48_000,
      channelCount: 2,
      durationSeconds: 1,
    },
    memoryCost: {
      heapBytes: 48_000 * 2 * 4,
    },
  },
  {
    id: 'resource-audio-clock',
    kind: 'audio-source-clock',
    policyId: 'ram-preview',
    owner,
    audioSourceId: 'audio-source-1',
    clockId: 'clock-1',
    diagnostics: {
      status: 'ok',
      audioClock: {
        clockId: 'clock-1',
        status: 'ok',
        currentTimeSeconds: 2,
        driftMs: 3,
      },
    },
  },
  {
    id: 'resource-runtime-binding',
    kind: 'runtime-binding',
    policyId: 'interactive',
    owner,
    runtime: {
      runtimeSourceId: 'media:media-1',
      runtimeSessionKey: 'interactive:track-1:media:media-1',
    },
  },
  {
    id: 'resource-job',
    kind: 'job',
    policyId: 'thumbnail',
    owner: {
      ownerId: 'thumbnail:media-1',
      ownerType: 'thumbnail',
      mediaFileId: 'media-1',
    },
    jobId: 'thumbnail-job-1',
    jobKind: 'thumbnail-generation',
  },
];

describe('timeline runtime coordinator contracts', () => {
  beforeEach(() => {
    releaseAllNativeDecoderRuntimeRecords();
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
  });

  afterEach(() => {
    releaseAllNativeDecoderRuntimeRecords();
    releaseAllLazyTimelineMediaElements();
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
  });

  it('keeps the Phase 0 runtime policy list stable', () => {
    expect(TIMELINE_RUNTIME_POLICY_IDS).toEqual([
      'interactive',
      'background',
      'slot-deck',
      'composition-render',
      'thumbnail',
      'render-target',
      'ram-preview',
      'export',
    ]);

    const registry = createTimelineRuntimePolicyRegistry();
    expect(registry.listPolicies().map((policy) => policy.id)).toEqual(
      TIMELINE_RUNTIME_POLICY_IDS
    );
    expect(registry.getPolicy('export')?.defaultBudget.maxSessions).toBeGreaterThan(0);
    expect(registry.getBudgetReport()).toHaveLength(TIMELINE_RUNTIME_POLICY_IDS.length);
  });

  it('defines every policy as a budget-reportable registry entry', () => {
    const stats = createEmptyTimelineRuntimeBridgeStats(123);
    expect(stats.policyOrder).toEqual(TIMELINE_RUNTIME_POLICY_IDS);

    for (const policy of TIMELINE_RUNTIME_POLICY_DESCRIPTORS) {
      expect(stats.policies[policy.id].descriptor.id).toBe(policy.id);
      expect(stats.policies[policy.id].budgetReport.policyId).toBe(policy.id);
      expect(stats.policies[policy.id].budgetReport.pressure.length).toBeGreaterThan(0);
      expect(policy.allowedResourceKinds.length).toBeGreaterThan(0);
    }
  });

  it('keeps kernel runtime provider demand categories aligned with service coordinator policies', () => {
    expect(TIMELINE_RUNTIME_PROVIDER_POLICIES).toEqual(TIMELINE_RUNTIME_POLICY_IDS);
    expect(TIMELINE_RUNTIME_RESOURCE_KINDS).toEqual(RENDER_RESOURCE_KINDS);
    expect(RUNTIME_PROVIDER_LEASE_POLICIES).toEqual([
      'lease-visible',
      'prewarm-nearby',
      'background-cache',
      'retain-until-release',
    ]);
    expect(RUNTIME_PROVIDER_DEMAND_OWNER_TYPES).toEqual([
      'clip',
      'track',
      'composition',
      'timeline',
      'slot',
      'thumbnail',
      'render-target',
      'export',
      'ram-preview',
      'tool',
      'unknown',
    ]);
  });

  it('keeps runtime provider demands plain-data before services allocate resources', () => {
    const demand: RuntimeProviderDemand = {
      id: 'demand-visible-frame',
      facetId: 'facet:clip-v1:video-frame',
      resourceKind: 'video-frame-provider',
      policyId: 'interactive',
      leasePolicy: 'lease-visible',
      owner,
      source: {
        sourceId: 'media:media-1',
        mediaFileId: 'media-1',
        clipId: 'clip-1',
        trackId: 'track-1',
        fileHash: 'hash-1',
        projectPath: 'media/clip.mp4',
      },
      dimensions: {
        width: 1920,
        height: 1080,
        fps: 30,
        durationSeconds: 4,
      },
      priority: 'visible',
      cacheKey: 'media:media-1@visible',
      tags: ['preview', 'video'],
    };

    expect(isRuntimeProviderDemand(demand)).toBe(true);
    expect(structuredClone(demand)).toEqual(demand);
    expect(JSON.parse(JSON.stringify(demand))).toEqual(demand);
    expect(isRenderResourceDescriptor(demand)).toBe(false);
  });

  it('rejects runtime objects and invalid enum values in provider demands', () => {
    const demand: RuntimeProviderDemand = {
      id: 'demand-visible-frame',
      facetId: 'facet:clip-v1:video-frame',
      resourceKind: 'video-frame-provider',
      policyId: 'interactive',
      leasePolicy: 'lease-visible',
      owner,
    };

    expect(isRuntimeProviderDemand({ ...demand, element: document.createElement('video') })).toBe(false);
    expect(isRuntimeProviderDemand({ ...demand, resourceKind: 'image-bitmap' })).toBe(false);
    expect(isRuntimeProviderDemand({ ...demand, policyId: 'visible' })).toBe(false);
    expect(isRuntimeProviderDemand({ ...demand, leasePolicy: 'hold-forever' })).toBe(false);
    expect(isRuntimeProviderDemand({ ...demand, owner: { ...owner, ownerType: 'legacy-source' } })).toBe(false);
  });

  it('bridges runtime provider demands into coordinator render resource descriptors', () => {
    const demand: RuntimeProviderDemand = {
      id: 'demand-visible-frame',
      facetId: 'facet:clip-v1:video-frame',
      resourceKind: 'video-frame-provider',
      policyId: 'interactive',
      leasePolicy: 'lease-visible',
      owner,
      source: {
        sourceId: 'media:media-1',
        mediaFileId: 'media-1',
        clipId: 'clip-1',
        trackId: 'track-1',
      },
      dimensions: {
        width: 1920,
        height: 1080,
        durationSeconds: 4,
      },
      tags: ['preview'],
    };

    const resource = createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'video-frame-provider',
      providerId: 'provider-1',
      providerKind: 'runtime-frame-provider',
      canSeek: true,
      frameFormat: 'video-frame',
      memoryCost: {
        decodedFrameBytes: 1920 * 1080 * 4,
      },
      diagnostics: {
        status: 'ok',
      },
    });

    expect(resource).toMatchObject({
      id: demand.id,
      kind: 'video-frame-provider',
      policyId: 'interactive',
      owner,
      source: demand.source,
      dimensions: demand.dimensions,
      providerId: 'provider-1',
      providerKind: 'runtime-frame-provider',
      canSeek: true,
      frameFormat: 'video-frame',
    });
    expect(resource.tags).toEqual(['runtime-provider-demand', 'lease-visible', 'preview']);
    expect(isRenderResourceDescriptor(resource)).toBe(true);
    expect(JSON.parse(JSON.stringify(resource))).toEqual(resource);
    expect(() => createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'html-media',
      mediaElementKind: 'video',
    })).toThrow(/kind mismatch/);
  });

  it('reserves and releases coordinator resources from provider demands', () => {
    const registry = createTimelineRuntimePolicyRegistry();
    const demand: RuntimeProviderDemand = {
      id: 'demand-audio-clock',
      facetId: 'facet:clip-v1:audio-clock',
      resourceKind: 'audio-source-clock',
      policyId: 'interactive',
      leasePolicy: 'lease-visible',
      owner,
      source: {
        sourceId: 'media:media-1',
        mediaFileId: 'media-1',
      },
    };

    const reservation = reserveRuntimeProviderDemandResource(demand, {
      resourceKind: 'audio-source-clock',
      audioSourceId: 'audio-source-1',
      clockId: 'clock-1',
      diagnostics: {
        status: 'ok',
      },
    }, registry);

    expect(reservation.admitted).toBe(true);
    if (!reservation.admitted) {
      throw new Error('expected runtime provider demand reservation to be admitted');
    }

    expect(reservation.resolution).toMatchObject({
      demandId: demand.id,
      facetId: demand.facetId,
      resourceKind: demand.resourceKind,
      status: 'leased',
      resourceId: demand.id,
      owner,
    });
    expect(registry.getBridgeStats().policies.interactive.resources).toEqual([reservation.resource]);
    expect(registry.getBridgeStats().policies.interactive.budgetReport.usage.audioSources).toBe(1);

    reservation.release();
    expect(registry.getBridgeStats().totals.resources).toBe(0);
  });

  it('registers native decoder handles as service-owned runtime leases', () => {
    const decoder = {
      close: vi.fn(async () => undefined),
    };
    const registered = registerNativeDecoderForTimelineClip({
      clipId: 'clip-native',
      mediaFileId: 'media-native',
      filePath: 'C:/media/native.mov',
      decoder: decoder as never,
    });

    expect(registered).toBe(true);
    expect(getNativeDecoderRuntimeRecordCount()).toBe(1);
    expect(getNativeDecoderForTimelineClip({ id: 'clip-native' })).toBe(decoder);

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources).toHaveLength(1);
    expect(resources[0]).toMatchObject({
      kind: 'native-decoder',
      policyId: 'interactive',
      decoderId: expect.stringContaining('native-decoder:clip-native'),
      tags: expect.arrayContaining(['runtime-provider-demand', 'native-decoder', 'timeline-video']),
    });

    releaseAllNativeDecoderRuntimeRecords();
    expect(decoder.close).toHaveBeenCalledOnce();
    expect(getNativeDecoderRuntimeRecordCount()).toBe(0);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });

  it('reports coordinator admission failures on provider demand reservations', () => {
    const registry = createTimelineRuntimePolicyRegistry();
    const demand: RuntimeProviderDemand = {
      id: 'demand-thumbnail-gpu',
      facetId: 'facet:thumbnail:gpu',
      resourceKind: 'gpu-texture',
      policyId: 'thumbnail',
      leasePolicy: 'background-cache',
      owner: {
        ownerId: 'thumbnail:media-1',
        ownerType: 'thumbnail',
        mediaFileId: 'media-1',
      },
      source: {
        mediaFileId: 'media-1',
      },
    };

    const reservation = reserveRuntimeProviderDemandResource(demand, {
      resourceKind: 'gpu-texture',
      textureId: 'thumbnail-gpu-texture',
      textureKind: 'intermediate',
    }, registry);

    expect(reservation.admitted).toBe(false);
    if (reservation.admitted) {
      throw new Error('expected thumbnail gpu reservation to be rejected');
    }

    expect(reservation.decision.reason).toBe('resource-kind-not-allowed');
    expect(reservation.resolution).toMatchObject({
      demandId: demand.id,
      status: 'error',
      reason: 'resource-kind-not-allowed',
    });
    expect(registry.getBridgeStats().totals.resources).toBe(0);
  });

  it('reserves planned clip runtime resources through provider demands', () => {
    const track: TimelineTrack = {
      id: 'track-v1',
      name: 'Video 1',
      type: 'video',
      height: 64,
      muted: false,
      visible: true,
      solo: false,
    };
    const clip: TimelineClip = {
      id: 'clip-v1',
      trackId: track.id,
      name: 'clip.mp4',
      file: new File([], 'clip.mp4', { type: 'video/mp4' }),
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        naturalDuration: 4,
      },
      mediaFileId: 'media-1',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      needsReload: true,
    };

    const reservation = reservePlannedClipRuntimeResources({
      policyId: 'interactive',
      ownerId: clip.id,
      clip,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        filePath: 'media/clip.mp4',
        naturalDuration: 4,
        runtimeSourceId: 'runtime-source-1',
        runtimeSessionKey: 'session-1',
      },
      mediaElementKind: 'video',
      srcKind: 'blob-url',
      tags: ['planned-runtime'],
    });

    expect(reservation.admitted).toBe(true);
    if (!reservation.admitted) {
      throw new Error('expected planned clip runtime resources to be admitted');
    }

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(reservation.resourceIds.toSorted()).toEqual([
      'timeline-runtime:interactive:clip-v1:html-media:video',
      'timeline-runtime:interactive:clip-v1:runtime-binding:runtime-source-1:session-1',
    ]);
    expect(resources).toHaveLength(2);
    expect(resources.every((resource) => resource.tags?.includes('runtime-provider-demand'))).toBe(true);
    expect(resources.every((resource) => resource.tags?.includes('planned-runtime'))).toBe(true);
    expect(resources.find((resource) => resource.kind === 'runtime-binding')).toMatchObject({
      runtime: {
        runtimeSourceId: 'runtime-source-1',
        runtimeSessionKey: 'session-1',
      },
    });
    expect(resources.find((resource) => resource.kind === 'html-media')).toMatchObject({
      mediaElementKind: 'video',
      elementId: 'clip-v1:video',
      srcKind: 'blob-url',
    });

    reservation.release();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });

  it('reports live clip runtime resources through provider demands', () => {
    const videoElement = document.createElement('video');
    videoElement.src = 'blob:clip-v1';
    const track: TimelineTrack = {
      id: 'track-v1',
      name: 'Video 1',
      type: 'video',
      height: 64,
      muted: false,
      visible: true,
      solo: false,
    };
    const clip: TimelineClip = {
      id: 'clip-v1',
      trackId: track.id,
      name: 'clip.mp4',
      file: new File([], 'clip.mp4', { type: 'video/mp4' }),
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        filePath: 'media/clip.mp4',
        naturalDuration: 4,
        runtimeSourceId: 'runtime-source-1',
        runtimeSessionKey: 'session-1',
        videoElement,
      },
      mediaFileId: 'media-1',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      needsReload: false,
    };

    reportClipRuntimeResources({
      policyId: 'interactive',
      ownerId: clip.id,
      clip,
      tags: ['reported-runtime'],
    });

    const resources = timelineRuntimeCoordinator.getBridgeStats().policies.interactive.resources;
    expect(resources.map((resource) => resource.id).toSorted()).toEqual([
      'timeline-runtime:interactive:clip-v1:html-media:video',
      'timeline-runtime:interactive:clip-v1:runtime-binding:runtime-source-1:session-1',
    ]);
    expect(resources.every((resource) => resource.tags?.includes('runtime-provider-demand'))).toBe(true);
    expect(resources.every((resource) => resource.tags?.includes('reported-runtime'))).toBe(true);
    expect(resources.find((resource) => resource.kind === 'html-media')).toMatchObject({
      mediaElementKind: 'video',
      elementId: 'clip-v1:video',
      srcKind: 'blob-url',
    });

    releaseReportedClipRuntimeResources('interactive', clip.id);
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });

  it('keeps the thumbnail resource budget above its per-kind bitmap and job budgets', () => {
    const thumbnailPolicy = TIMELINE_RUNTIME_POLICY_DESCRIPTORS.find((policy) => policy.id === 'thumbnail');
    expect(thumbnailPolicy).toBeTruthy();
    const budget = thumbnailPolicy?.defaultBudget;

    expect(budget?.maxResources).toBeGreaterThanOrEqual(
      (budget?.maxImageBitmaps ?? 0) +
      (budget?.maxJobs ?? 0) +
      (budget?.maxHtmlMediaElements ?? 0) +
      (budget?.maxFrameProviders ?? 0) +
      (budget?.maxNativeDecoders ?? 0),
    );
  });

  it('reports retained resources through policy budgets and bridge stats', () => {
    const registry = createTimelineRuntimePolicyRegistry();
    const resource = sampleResources[1];

    registry.retainResource(resource);
    const thumbnailBudget = registry.getBudgetReport('thumbnail')[0];
    const stats = registry.getBridgeStats();

    expect(thumbnailBudget.usage.resources).toBe(1);
    expect(thumbnailBudget.usage.htmlMediaElements).toBe(1);
    expect(stats.totals.resources).toBe(1);
    expect(stats.policies.thumbnail.resources).toEqual([resource]);
    expect(stats.diagnostics.providers[0]?.providerId).toBe('video-element-1');
    expect(isPlainTimelineRuntimeBridgeStats(stats)).toBe(true);

    registry.releaseResource(resource.id);
    expect(registry.getBudgetReport('thumbnail')[0].usage.resources).toBe(0);
  });

  it('predicts resource admission against policy hard budgets without mutating retained resources', () => {
    const registry = createTimelineRuntimePolicyRegistry();
    const thumbnailPolicy = TIMELINE_RUNTIME_POLICY_DESCRIPTORS.find((policy) => policy.id === 'thumbnail');
    const maxImageBitmaps = thumbnailPolicy?.defaultBudget.maxImageBitmaps ?? 256;
    const createThumbnailBitmap = (index: number): RenderResourceDescriptor => ({
      id: `thumbnail-bitmap-${index}`,
      kind: 'image-canvas',
      policyId: 'thumbnail',
      owner: {
        ownerId: `thumbnail:media-${index}`,
        ownerType: 'thumbnail',
        mediaFileId: `media-${index}`,
      },
      imageKind: 'image-bitmap',
      imageId: `thumbnail-bitmap-${index}`,
      diagnostics: {
        status: 'ok',
      },
    });

    for (let index = 0; index < maxImageBitmaps; index += 1) {
      registry.retainResource(createThumbnailBitmap(index));
    }

    const decision = registry.canRetainResource(createThumbnailBitmap(maxImageBitmaps));

    expect(decision.admitted).toBe(false);
    expect(decision.reason).toBe('budget-exceeded');
    expect(decision.projectedUsage.imageBitmaps).toBe(maxImageBitmaps + 1);
    expect(decision.rejectedUnits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        unit: 'image-bitmap',
        used: maxImageBitmaps + 1,
        limit: maxImageBitmaps,
      }),
    ]));
    expect(registry.getBudgetReport('thumbnail')[0].usage.resources).toBe(maxImageBitmaps);
  });

  it('covers LayerSource-parity resource descriptor shapes with plain handles', () => {
    expect(sampleResources.map((resource) => resource.kind)).toEqual(RENDER_RESOURCE_KINDS);
    for (const resource of sampleResources) {
      expect(isRenderResourceDescriptor(resource), resource.kind).toBe(true);
      expect(JSON.stringify(resource)).not.toContain('function');
    }
  });

  it('counts gpu-texture resources against gpu texture and gpu byte budgets', () => {
    const registry = createTimelineRuntimePolicyRegistry();
    const resource = sampleResources.find((entry) => entry.kind === 'gpu-texture');

    expect(resource).toBeDefined();
    registry.retainResource(resource!);

    const ramPreviewBudget = registry.getBudgetReport('ram-preview')[0];
    expect(ramPreviewBudget.usage).toMatchObject({
      resources: 1,
      gpuTextures: 1,
      gpuBytes: 1920 * 1080 * 4,
    });
  });

  it('keeps bridge-facing diagnostics plain-data and cloneable', () => {
    const provider: RuntimeProviderHealthDiagnostics = {
      providerId: 'provider-1',
      providerKind: 'webcodecs',
      status: 'ok',
      isReady: true,
      decodeQueueDepth: 0,
    };
    const session: RuntimeSessionHealthDiagnostics = {
      sourceId: 'media:media-1',
      sessionKey: 'interactive:track-1:media:media-1',
      policyId: 'interactive',
      status: 'ok',
      provider,
      audioClock: {
        clockId: 'clock-1',
        status: 'ok',
        currentTimeSeconds: 1,
      },
    };
    const empty = createEmptyTimelineRuntimeBridgeStats(123);
    const stats: TimelineRuntimeCoordinatorBridgeStats = {
      ...empty,
      policies: {
        ...empty.policies,
        interactive: {
          ...empty.policies.interactive,
          resources: [sampleResources[0], sampleResources[10]],
          sessions: [session],
        },
      },
      diagnostics: {
        providers: [provider],
        sessions: [session],
        resources: [sampleResources[0], sampleResources[10]],
        messages: [
          {
            severity: 'info',
            code: 'runtime.contract.test',
            message: 'Runtime diagnostics are plain bridge data.',
            policyId: 'interactive',
          },
        ],
      },
    };

    expect(isPlainTimelineRuntimeBridgeStats(stats)).toBe(true);
    expect(structuredClone(stats)).toEqual(stats);
    expect(JSON.parse(JSON.stringify(stats))).toEqual(stats);
  });

  it('rejects runtime objects and functions in bridge stats', () => {
    const statsWithFunction = {
      ...createEmptyTimelineRuntimeBridgeStats(123),
      diagnostics: {
        providers: [],
        sessions: [],
        resources: [],
        messages: [
          {
            severity: 'info',
            code: 'bad',
            message: 'not plain',
            dispose: () => undefined,
          },
        ],
      },
    };

    expect(isPlainTimelineRuntimeBridgeStats(statsWithFunction)).toBe(false);
  });

  it('registers primary lazy timeline media elements as interactive html-media resources', () => {
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(noop);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(noop);

    const track: TimelineTrack = {
      id: 'track-v1',
      name: 'Video 1',
      type: 'video',
      height: 64,
      muted: false,
      visible: true,
      solo: false,
    };
    const clip: TimelineClip = {
      id: 'clip-v1',
      trackId: track.id,
      name: 'clip.mp4',
      file: new File([], 'clip.mp4', { type: 'video/mp4' }),
      startTime: 0,
      duration: 4,
      inPoint: 0,
      outPoint: 4,
      source: {
        type: 'video',
        mediaFileId: 'media-1',
        naturalDuration: 4,
      },
      mediaFileId: 'media-1',
      transform: {
        opacity: 1,
        blendMode: 'normal',
        position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 },
        rotation: { x: 0, y: 0, z: 0 },
      },
      effects: [],
      needsReload: true,
    };
    const mediaFile = {
      id: 'media-1',
      name: 'clip.mp4',
      type: 'video',
      url: 'blob:media-1',
      duration: 4,
    };
    const ctx = {
      clips: [clip],
      tracks: [track],
      isPlaying: false,
      isDraggingPlayhead: false,
      hasClipDragPreview: false,
      playheadPosition: 0.25,
      playbackSpeed: 1,
      activeCompId: 'main',
      proxyEnabled: false,
      getInterpolatedTransform: () => clip.transform,
      getInterpolatedEffects: () => [],
      getInterpolatedNodeGraphParams: () => ({}),
      getInterpolatedColorCorrection: () => undefined,
      getInterpolatedVectorAnimationSettings: () => ({}),
      getInterpolatedTextBounds: () => undefined,
      getInterpolatedSpeed: () => 1,
      getSourceTimeForClip: () => 0,
      hasKeyframes: () => false,
      now: 1000,
      frameNumber: 1,
      videoTracks: [track],
      audioTracks: [],
      visibleVideoTrackIds: new Set([track.id]),
      unmutedAudioTrackIds: new Set<string>(),
      anyVideoSolo: false,
      anyAudioSolo: false,
      clipsAtTime: [clip],
      clipsByTrackId: new Map([[track.id, clip]]),
      mediaFiles: [mediaFile],
      mediaFileById: new Map([[mediaFile.id, mediaFile]]),
      mediaFileByName: new Map([[mediaFile.name, mediaFile]]),
      compositionById: new Map(),
    } as unknown as FrameContext;

    hydrateTimelineMediaWindow(ctx);

    const stats = timelineRuntimeCoordinator.getBridgeStats();
    const resource = stats.policies.interactive.resources[0];
    expect(resource).toMatchObject({
      id: 'timeline-lazy-media:video:clip-v1',
      kind: 'html-media',
      policyId: 'interactive',
      mediaElementKind: 'video',
      owner: {
        ownerId: 'clip-v1',
        ownerType: 'clip',
        clipId: 'clip-v1',
        trackId: 'track-v1',
        mediaFileId: 'media-1',
      },
    });
    expect(stats.policies.interactive.budgetReport.usage.htmlMediaElements).toBe(1);
    expect(clip.source?.videoElement).toBeInstanceOf(HTMLVideoElement);

    releaseAllLazyTimelineMediaElements();
    expect(timelineRuntimeCoordinator.getBridgeStats().totals.resources).toBe(0);
  });
});
