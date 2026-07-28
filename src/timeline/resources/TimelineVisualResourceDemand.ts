export const TIMELINE_VISUAL_RESOURCE_FACET_KINDS = [
  'thumbnail',
  'waveform',
  'spectrogram',
  'analysis-marker',
  'text-raster',
  'model-preview',
  'unknown',
] as const;

export type TimelineVisualResourceFacetKind = (typeof TIMELINE_VISUAL_RESOURCE_FACET_KINDS)[number];

export type TimelineResourceDemandPriority = 'visible' | 'nearby' | 'background';

export type TimelineVisualResourceMissingState = 'placeholder' | 'pending' | 'error' | 'unsupported';

export interface TimelineVisualResourceDemand {
  facetId: string;
  facetKind: TimelineVisualResourceFacetKind;
  clipId?: string;
  priority: TimelineResourceDemandPriority;
  missingState: TimelineVisualResourceMissingState;
  cacheKey?: string;
}

export const TIMELINE_RUNTIME_RESOURCE_KINDS = [
  'video-frame-provider',
  'html-media',
  'image-canvas',
  'native-decoder',
  'nested-composition-texture',
  'gpu-texture',
  'model',
  'gaussian-splat',
  'motion-data',
  'audio-buffer',
  'audio-source-clock',
  'runtime-binding',
  'job',
] as const;

export type TimelineRuntimeResourceKind = (typeof TIMELINE_RUNTIME_RESOURCE_KINDS)[number];

export const TIMELINE_RUNTIME_PROVIDER_POLICIES = [
  'interactive',
  'background',
  'slot-deck',
  'composition-render',
  'thumbnail',
  'render-target',
  'ram-preview',
  'export',
] as const;

export type RuntimeProviderDemandPolicy = (typeof TIMELINE_RUNTIME_PROVIDER_POLICIES)[number];

export const RUNTIME_PROVIDER_LEASE_POLICIES = [
  'lease-visible',
  'prewarm-nearby',
  'background-cache',
  'retain-until-release',
] as const;

export type RuntimeProviderLeasePolicy = (typeof RUNTIME_PROVIDER_LEASE_POLICIES)[number];

export const RUNTIME_PROVIDER_DEMAND_OWNER_TYPES = [
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
] as const;

export type RuntimeProviderDemandOwnerType = (typeof RUNTIME_PROVIDER_DEMAND_OWNER_TYPES)[number];

export interface RuntimeProviderDemandOwner {
  ownerId: string;
  ownerType: RuntimeProviderDemandOwnerType;
  clipId?: string;
  trackId?: string;
  compositionId?: string;
  mediaFileId?: string;
}

export interface RuntimeProviderDemandSource {
  sourceId?: string;
  mediaFileId?: string;
  clipId?: string;
  trackId?: string;
  compositionId?: string;
  fileHash?: string;
  projectPath?: string;
  previewPath?: string;
}

export interface RuntimeProviderDemandDimensions {
  width?: number;
  height?: number;
  fps?: number;
  durationSeconds?: number;
  sampleRate?: number;
  channelCount?: number;
}

export interface RuntimeProviderDemand {
  id: string;
  facetId: string;
  resourceKind: TimelineRuntimeResourceKind;
  policyId: RuntimeProviderDemandPolicy;
  leasePolicy: RuntimeProviderLeasePolicy;
  owner: RuntimeProviderDemandOwner;
  source?: RuntimeProviderDemandSource;
  dimensions?: RuntimeProviderDemandDimensions;
  priority?: TimelineResourceDemandPriority;
  cacheKey?: string;
  tags?: readonly string[];
}

export type RuntimeProviderResourceStatus = 'missing' | 'queued' | 'leased' | 'ready' | 'released' | 'error';

export interface ResourceResolution {
  demandId: string;
  facetId: string;
  resourceKind: TimelineRuntimeResourceKind;
  status: RuntimeProviderResourceStatus;
  resourceId?: string;
  owner?: RuntimeProviderDemandOwner;
  reason?: string;
}

function isPlainDataValue(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null) return true;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'undefined') {
    return false;
  }
  if (typeof value !== 'object') return true;
  if (seen.has(value)) return false;
  seen.add(value);

  if (Array.isArray(value)) {
    const plainArray = value.every((entry) => isPlainDataValue(entry, seen));
    seen.delete(value);
    return plainArray;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    seen.delete(value);
    return false;
  }

  const plainObject = Object.values(value).every((entry) => isPlainDataValue(entry, seen));
  seen.delete(value);
  return plainObject;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isTimelineRuntimeResourceKind(value: unknown): value is TimelineRuntimeResourceKind {
  return typeof value === 'string' && (TIMELINE_RUNTIME_RESOURCE_KINDS as readonly string[]).includes(value);
}

export function isRuntimeProviderDemandPolicy(value: unknown): value is RuntimeProviderDemandPolicy {
  return typeof value === 'string' && (TIMELINE_RUNTIME_PROVIDER_POLICIES as readonly string[]).includes(value);
}

function isRuntimeProviderLeasePolicy(value: unknown): value is RuntimeProviderLeasePolicy {
  return typeof value === 'string' && (RUNTIME_PROVIDER_LEASE_POLICIES as readonly string[]).includes(value);
}

function isRuntimeProviderDemandOwnerType(value: unknown): value is RuntimeProviderDemandOwnerType {
  return typeof value === 'string' && (RUNTIME_PROVIDER_DEMAND_OWNER_TYPES as readonly string[]).includes(value);
}

export function isRuntimeProviderDemand(value: unknown): value is RuntimeProviderDemand {
  if (!isObjectRecord(value) || !isPlainDataValue(value)) return false;
  if (
    typeof value.id !== 'string' ||
    typeof value.facetId !== 'string' ||
    !isTimelineRuntimeResourceKind(value.resourceKind) ||
    !isRuntimeProviderDemandPolicy(value.policyId) ||
    !isRuntimeProviderLeasePolicy(value.leasePolicy)
  ) {
    return false;
  }
  if (!isObjectRecord(value.owner)) return false;

  const owner = value.owner;
  return typeof owner.ownerId === 'string' && isRuntimeProviderDemandOwnerType(owner.ownerType);
}
