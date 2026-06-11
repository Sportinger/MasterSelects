import type { RuntimeProviderDemand } from '../../timeline';
import { createRenderResourceDescriptorFromDemand } from '../timeline/runtimeProviderDemandBridge';
import type { RenderResourceDescriptor, TimelineRuntimePolicyId } from '../timeline/runtimeCoordinatorTypes';
import type {
  CachedFrame,
  CachedVideoFrame,
  LegacyProxyFrameCacheStats,
  ProxyVideoFrameCacheStats,
} from './frameCacheModels';

const LEGACY_PROXY_FRAME_RUNTIME_POLICY_ID: TimelineRuntimePolicyId = 'thumbnail';
const INTERACTIVE_PROXY_CACHE_RUNTIME_POLICY_ID: TimelineRuntimePolicyId = 'interactive';
const BYTES_PER_RGBA_PIXEL = 4;

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

export function estimateAudioBufferBytes(buffer: AudioBuffer): number {
  return buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT;
}

export function estimateLegacyImageBytes(image: HTMLImageElement): number {
  const width = image.naturalWidth || image.width || 0;
  const height = image.naturalHeight || image.height || 0;
  return Math.max(0, Math.round(width * height * BYTES_PER_RGBA_PIXEL));
}

export function estimateVideoFrameBytes(frame: VideoFrame): number {
  const width = frame.codedWidth || frame.displayWidth || 0;
  const height = frame.codedHeight || frame.displayHeight || 0;
  return Math.max(0, Math.round(width * height * BYTES_PER_RGBA_PIXEL));
}

export function getAudioProxySrcKind(src: string | undefined): 'blob-url' | 'file-path' | 'project-path' | 'remote-url' | 'media-source' | 'unknown' {
  if (!src) return 'unknown';
  if (src.startsWith('blob:')) return 'blob-url';
  if (src.startsWith('http')) return 'remote-url';
  if (src.startsWith('mediastream:')) return 'media-source';
  if (src.startsWith('/') || /^[A-Za-z]:[/]/.test(src)) return 'file-path';
  return 'unknown';
}

export function getLegacyFrameCacheStats(
  cache: ReadonlyMap<string, CachedFrame>,
  mediaFileId: string,
  override?: { key: string; entry: CachedFrame | null }
): LegacyProxyFrameCacheStats {
  let frameCount = 0;
  let heapBytes = 0;
  let width: number | undefined;
  let height: number | undefined;
  let overrideApplied = false;

  const addImage = (image: HTMLImageElement) => {
    frameCount += 1;
    heapBytes += estimateLegacyImageBytes(image);
    width ??= image.naturalWidth || image.width || undefined;
    height ??= image.naturalHeight || image.height || undefined;
  };

  for (const [key, entry] of cache) {
    if (entry.mediaFileId !== mediaFileId) continue;
    if (override && key === override.key) {
      overrideApplied = true;
      if (override.entry) {
        addImage(override.entry.image);
      }
      continue;
    }
    addImage(entry.image);
  }

  if (override && !overrideApplied && override.entry?.mediaFileId === mediaFileId) {
    addImage(override.entry.image);
  }

  return {
    frameCount,
    heapBytes,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

export function getVideoFrameCacheStats(
  cache: ReadonlyMap<string, CachedVideoFrame>,
  mediaFileId: string,
  override?: { key: string; entry: CachedVideoFrame | null }
): ProxyVideoFrameCacheStats {
  let frameCount = 0;
  let decodedFrameBytes = 0;
  let width: number | undefined;
  let height: number | undefined;
  let overrideApplied = false;

  const addFrame = (frame: VideoFrame) => {
    frameCount += 1;
    decodedFrameBytes += estimateVideoFrameBytes(frame);
    width ??= frame.codedWidth || frame.displayWidth || undefined;
    height ??= frame.codedHeight || frame.displayHeight || undefined;
  };

  for (const [key, entry] of cache) {
    if (entry.mediaFileId !== mediaFileId) continue;
    if (override && key === override.key) {
      overrideApplied = true;
      if (override.entry) {
        addFrame(override.entry.frame);
      }
      continue;
    }
    addFrame(entry.frame);
  }

  if (override && !overrideApplied && override.entry?.mediaFileId === mediaFileId) {
    addFrame(override.entry.frame);
  }

  return {
    frameCount,
    decodedFrameBytes,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
  };
}

export function getLegacyProxyFrameResourceId(mediaFileId: string): string {
  return 'proxy-frame-cache:' + mediaFileId + ':legacy-images';
}

export function getAudioBufferResourceId(mediaFileId: string): string {
  return 'proxy-frame-cache:' + mediaFileId + ':audio-buffer';
}

export function getAudioProxyElementResourceId(mediaFileId: string): string {
  return 'proxy-frame-cache:' + mediaFileId + ':audio-proxy-element';
}

export function getVideoFrameResourceId(mediaFileId: string): string {
  return 'proxy-frame-cache:' + mediaFileId + ':video-frames';
}

export function createLegacyFrameCacheResource(
  mediaFileId: string,
  stats: LegacyProxyFrameCacheStats
): RenderResourceDescriptor {
  const resourceId = getLegacyProxyFrameResourceId(mediaFileId);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: resourceId + ':facet',
    resourceKind: 'image-canvas',
    policyId: LEGACY_PROXY_FRAME_RUNTIME_POLICY_ID,
    leasePolicy: 'background-cache',
    owner: {
      ownerId: 'proxy-frame-cache:' + mediaFileId,
      ownerType: 'timeline',
      mediaFileId,
    },
    source: {
      sourceId: mediaFileId,
      mediaFileId,
    },
    dimensions: removeUndefinedValues({
      width: stats.width,
      height: stats.height,
    }),
    priority: 'background',
    tags: ['proxy-frame-cache', 'jpeg-proxy-frame'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    memoryCost: {
      heapBytes: stats.heapBytes,
    },
    imageKind: 'html-image',
    imageId: resourceId,
    label: 'JPEG proxy frame cache (' + stats.frameCount + ' frames)',
  });
}

export function createAudioBufferResource(mediaFileId: string, buffer: AudioBuffer): RenderResourceDescriptor {
  const resourceId = getAudioBufferResourceId(mediaFileId);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: resourceId + ':facet',
    resourceKind: 'audio-source-clock',
    policyId: INTERACTIVE_PROXY_CACHE_RUNTIME_POLICY_ID,
    leasePolicy: 'background-cache',
    owner: {
      ownerId: 'proxy-frame-cache:' + mediaFileId,
      ownerType: 'timeline',
      mediaFileId,
    },
    source: {
      sourceId: mediaFileId,
      mediaFileId,
    },
    dimensions: {
      durationSeconds: buffer.duration,
      sampleRate: buffer.sampleRate,
      channelCount: buffer.numberOfChannels,
    },
    priority: 'background',
    tags: ['proxy-frame-cache', 'decoded-audio-buffer', 'scrub-audio', 'source-playback-audio'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'audio-source-clock',
    memoryCost: {
      heapBytes: estimateAudioBufferBytes(buffer),
    },
    audioSourceId: mediaFileId,
    clockId: resourceId,
    label: 'Decoded proxy/source audio buffer',
  });
}

export function createAudioProxyElementResource(
  mediaFileId: string,
  audioSrc: string,
  audio?: HTMLAudioElement,
): RenderResourceDescriptor {
  const resourceId = getAudioProxyElementResourceId(mediaFileId);
  const readyState = audio?.readyState ?? 0;
  const networkState = audio?.networkState ?? 0;
  const status = audio?.error ? 'warning' : readyState >= HTMLMediaElement.HAVE_METADATA ? 'ok' : 'unknown';
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: resourceId + ':facet',
    resourceKind: 'html-media',
    policyId: INTERACTIVE_PROXY_CACHE_RUNTIME_POLICY_ID,
    leasePolicy: 'lease-visible',
    owner: {
      ownerId: 'proxy-frame-cache:' + mediaFileId,
      ownerType: 'timeline',
      mediaFileId,
    },
    source: {
      sourceId: mediaFileId,
      mediaFileId,
    },
    priority: 'visible',
    tags: ['proxy-frame-cache', 'audio-proxy', 'html-audio'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'html-media',
    mediaElementKind: 'audio',
    elementId: resourceId,
    srcKind: getAudioProxySrcKind(audioSrc),
    diagnostics: {
      status,
      provider: {
        providerId: resourceId,
        providerKind: 'html-audio',
        status,
        isReady: readyState >= HTMLMediaElement.HAVE_METADATA,
        isPlaying: audio ? !audio.paused : false,
        isSeeking: audio?.seeking ?? false,
        currentTimeSeconds: audio?.currentTime ?? 0,
        readyState,
        networkState,
        errorCode: audio?.error ? String(audio.error.code) : undefined,
      },
    },
    label: 'Proxy audio element',
  });
}

export function createVideoFrameCacheResource(
  mediaFileId: string,
  stats: ProxyVideoFrameCacheStats
): RenderResourceDescriptor {
  const resourceId = getVideoFrameResourceId(mediaFileId);
  const demand: RuntimeProviderDemand = {
    id: resourceId,
    facetId: resourceId + ':facet',
    resourceKind: 'video-frame-provider',
    policyId: INTERACTIVE_PROXY_CACHE_RUNTIME_POLICY_ID,
    leasePolicy: 'background-cache',
    owner: {
      ownerId: 'proxy-frame-cache:' + mediaFileId,
      ownerType: 'timeline',
      mediaFileId,
    },
    source: {
      sourceId: mediaFileId,
      mediaFileId,
    },
    dimensions: removeUndefinedValues({
      width: stats.width,
      height: stats.height,
    }),
    priority: 'background',
    tags: ['proxy-frame-cache', 'webcodecs-video-frame'],
  };
  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'video-frame-provider',
    memoryCost: {
      heapBytes: stats.decodedFrameBytes,
      decodedFrameBytes: stats.decodedFrameBytes,
    },
    providerId: resourceId,
    providerKind: 'webcodecs',
    canSeek: true,
    canProvideStaleFrame: true,
    frameFormat: 'video-frame',
    label: 'Proxy WebCodecs frame cache (' + stats.frameCount + ' frames)',
  });
}
