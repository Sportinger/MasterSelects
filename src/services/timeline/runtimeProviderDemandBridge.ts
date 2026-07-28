import type {
  ResourceResolution,
  RuntimeProviderDemand,
  RuntimeProviderDemandOwner,
  RuntimeProviderDemandSource,
  RuntimeProviderResourceStatus,
} from '../../timeline';
import { isRuntimeProviderDemand } from '../../timeline';
import {
  isRenderResourceDescriptor,
} from './runtimeCoordinatorContracts';
import { timelineRuntimeCoordinator } from './timelineRuntimeCoordinator';
import type {
  RenderResourceDescriptor,
  RuntimeResourceDiagnostics,
  RuntimeResourceMemoryCost,
  TimelineRuntimeAdmissionDecision,
  TimelineRuntimeCoordinator,
} from './runtimeCoordinatorTypes';

interface RuntimeProviderDemandDescriptorOptions {
  resourceId?: string;
  label?: string;
  tags?: readonly string[];
  diagnostics?: RuntimeResourceDiagnostics;
  memoryCost?: RuntimeResourceMemoryCost;
}

export type RuntimeProviderDemandResourceDetails =
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'video-frame-provider';
      providerId?: string;
      providerKind?: 'webcodecs' | 'runtime-frame-provider';
      canSeek?: boolean;
      canProvideStaleFrame?: boolean;
      frameFormat?: 'video-frame' | 'image-bitmap' | 'canvas-image-source' | 'unknown';
      runtimeSourceId?: string;
      runtimeSessionKey?: string;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'html-media';
      mediaElementKind: 'video' | 'audio';
      elementId?: string;
      srcKind?: 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown';
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'image-canvas';
      imageKind?: 'html-image' | 'image-bitmap' | 'html-canvas' | 'offscreen-canvas' | 'text-canvas';
      imageId?: string;
      runtimeSourceId?: string;
      runtimeSessionKey?: string;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'native-decoder';
      decoderId?: string;
      codec?: string;
      container?: string;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'nested-composition-texture';
      compositionId?: string;
      textureId?: string;
      depth?: number;
      layerCount?: number;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'gpu-texture';
      textureId?: string;
      textureKind?: 'render-target' | 'ram-preview-frame' | 'export-frame' | 'intermediate' | 'readback' | 'unknown';
      format?: string;
      sampleCount?: number;
      mipLevelCount?: number;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'model';
      modelId?: string;
      modelKind?: 'obj' | 'fbx' | 'gltf' | 'glb' | 'primitive' | 'unknown';
      sequenceFrameCount?: number;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'gaussian-splat';
      splatId?: string;
      splatCount?: number;
      sequenceFrameCount?: number;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'motion-data';
      payloadId?: string;
      payloadKind?: 'motion-layer' | 'math-scene' | 'vector-animation' | 'midi' | 'node-graph' | 'data-signal' | 'unknown';
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'audio-buffer';
      audioBufferId?: string;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'audio-source-clock';
      audioSourceId?: string;
      clockId?: string;
      hasAudioWorklet?: boolean;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'runtime-binding';
      runtimeSourceId: string;
      runtimeSessionKey: string;
    })
  | (RuntimeProviderDemandDescriptorOptions & {
      resourceKind: 'job';
      jobId?: string;
      jobKind?: 'thumbnail-db-load' | 'thumbnail-generation' | 'thumbnail-bitmap-decode' | 'cache-warmup' | 'render-target-refresh' | 'ram-preview-render' | 'export-render' | 'unknown';
      queuedAtMs?: number;
      startedAtMs?: number;
    });

export type RuntimeProviderDemandResourceReservation =
  | {
      admitted: true;
      resource: RenderResourceDescriptor;
      resolution: ResourceResolution;
      release: () => void;
    }
  | {
      admitted: false;
      resource: RenderResourceDescriptor;
      decision: TimelineRuntimeAdmissionDecision;
      resolution: ResourceResolution;
      release: () => void;
    };

function getBaseDescriptor(
  demand: RuntimeProviderDemand,
  details: RuntimeProviderDemandDescriptorOptions
) {
  const tags = Array.from(new Set([
    'runtime-provider-demand',
    demand.leasePolicy,
    ...(demand.tags ?? []),
    ...(details.tags ?? []),
  ]));

  return {
    id: details.resourceId ?? demand.id,
    policyId: demand.policyId,
    owner: demand.owner,
    source: demand.source,
    dimensions: demand.dimensions,
    diagnostics: details.diagnostics,
    memoryCost: details.memoryCost,
    label: details.label,
    tags,
  };
}

function getSourceFallback(
  source: RuntimeProviderDemandSource | undefined,
  owner: RuntimeProviderDemandOwner,
  fallback: string
): string {
  return source?.sourceId ?? source?.mediaFileId ?? owner.mediaFileId ?? owner.clipId ?? owner.ownerId ?? fallback;
}

export function createResourceResolutionFromDemand(
  demand: RuntimeProviderDemand,
  status: RuntimeProviderResourceStatus,
  resourceId?: string,
  reason?: string
): ResourceResolution {
  return {
    demandId: demand.id,
    facetId: demand.facetId,
    resourceKind: demand.resourceKind,
    status,
    resourceId,
    owner: demand.owner,
    reason,
  };
}

export function createRenderResourceDescriptorFromDemand(
  demand: RuntimeProviderDemand,
  details: RuntimeProviderDemandResourceDetails
): RenderResourceDescriptor {
  if (!isRuntimeProviderDemand(demand)) {
    throw new Error('Invalid RuntimeProviderDemand');
  }
  if (details.resourceKind !== demand.resourceKind) {
    throw new Error(`RuntimeProviderDemand kind mismatch: ${demand.resourceKind} demand cannot create ${details.resourceKind}`);
  }

  const base = getBaseDescriptor(demand, details);
  const fallbackId = getSourceFallback(demand.source, demand.owner, demand.id);
  const descriptor = (() => {
    switch (details.resourceKind) {
      case 'video-frame-provider':
        return {
          ...base,
          kind: 'video-frame-provider',
          providerId: details.providerId ?? `${demand.id}:provider`,
          providerKind: details.providerKind ?? 'runtime-frame-provider',
          canSeek: details.canSeek,
          canProvideStaleFrame: details.canProvideStaleFrame,
          frameFormat: details.frameFormat ?? 'unknown',
          runtime: details.runtimeSourceId && details.runtimeSessionKey
            ? {
                runtimeSourceId: details.runtimeSourceId,
                runtimeSessionKey: details.runtimeSessionKey,
              }
            : undefined,
        };
      case 'html-media':
        return {
          ...base,
          kind: 'html-media',
          mediaElementKind: details.mediaElementKind,
          elementId: details.elementId ?? `${demand.id}:${details.mediaElementKind}`,
          srcKind: details.srcKind,
        };
      case 'image-canvas':
        return {
          ...base,
          kind: 'image-canvas',
          imageKind: details.imageKind ?? 'image-bitmap',
          imageId: details.imageId ?? `${demand.id}:image`,
          runtime: details.runtimeSourceId && details.runtimeSessionKey
            ? {
                runtimeSourceId: details.runtimeSourceId,
                runtimeSessionKey: details.runtimeSessionKey,
              }
            : undefined,
        };
      case 'native-decoder':
        return {
          ...base,
          kind: 'native-decoder',
          decoderId: details.decoderId ?? `${demand.id}:decoder`,
          codec: details.codec,
          container: details.container,
        };
      case 'nested-composition-texture':
        return {
          ...base,
          kind: 'nested-composition-texture',
          compositionId: details.compositionId ?? demand.owner.compositionId ?? fallbackId,
          textureId: details.textureId ?? `${demand.id}:texture`,
          depth: details.depth ?? 1,
          layerCount: details.layerCount,
        };
      case 'gpu-texture':
        return {
          ...base,
          kind: 'gpu-texture',
          textureId: details.textureId ?? `${demand.id}:texture`,
          textureKind: details.textureKind ?? 'unknown',
          format: details.format,
          sampleCount: details.sampleCount,
          mipLevelCount: details.mipLevelCount,
        };
      case 'model':
        return {
          ...base,
          kind: 'model',
          modelId: details.modelId ?? fallbackId,
          modelKind: details.modelKind ?? 'unknown',
          sequenceFrameCount: details.sequenceFrameCount,
        };
      case 'gaussian-splat':
        return {
          ...base,
          kind: 'gaussian-splat',
          splatId: details.splatId ?? fallbackId,
          splatCount: details.splatCount,
          sequenceFrameCount: details.sequenceFrameCount,
        };
      case 'motion-data':
        return {
          ...base,
          kind: 'motion-data',
          payloadId: details.payloadId ?? fallbackId,
          payloadKind: details.payloadKind ?? 'unknown',
        };
      case 'audio-buffer':
        return {
          ...base,
          kind: 'audio-buffer',
          audioBufferId: details.audioBufferId ?? fallbackId,
        };
      case 'audio-source-clock':
        return {
          ...base,
          kind: 'audio-source-clock',
          audioSourceId: details.audioSourceId ?? fallbackId,
          clockId: details.clockId,
          hasAudioWorklet: details.hasAudioWorklet,
        };
      case 'runtime-binding':
        return {
          ...base,
          kind: 'runtime-binding',
          runtime: {
            runtimeSourceId: details.runtimeSourceId,
            runtimeSessionKey: details.runtimeSessionKey,
          },
        };
      case 'job':
        return {
          ...base,
          kind: 'job',
          jobId: details.jobId ?? demand.id,
          jobKind: details.jobKind ?? 'unknown',
          queuedAtMs: details.queuedAtMs,
          startedAtMs: details.startedAtMs,
        };
      default:
        throw new Error('Unsupported RuntimeProviderDemand resource kind');
    }
  })();

  if (!isRenderResourceDescriptor(descriptor)) {
    throw new Error(`RuntimeProviderDemand produced an invalid render resource descriptor: ${demand.id}`);
  }

  return descriptor;
}

export function reserveRuntimeProviderDemandResource(
  demand: RuntimeProviderDemand,
  details: RuntimeProviderDemandResourceDetails,
  coordinator: TimelineRuntimeCoordinator = timelineRuntimeCoordinator
): RuntimeProviderDemandResourceReservation {
  const resource = createRenderResourceDescriptorFromDemand(demand, details);
  const decision = coordinator.canRetainResource(resource);
  if (!decision.admitted) {
    return {
      admitted: false,
      resource,
      decision,
      resolution: createResourceResolutionFromDemand(demand, 'error', resource.id, decision.reason),
      release: () => undefined,
    };
  }

  coordinator.retainResource(resource);
  return {
    admitted: true,
    resource,
    resolution: createResourceResolutionFromDemand(demand, 'leased', resource.id),
    release: () => coordinator.releaseResource(resource.id),
  };
}
