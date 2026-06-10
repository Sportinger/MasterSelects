// Pure planning/mapping helpers for runtime playback bindings.
// Session-key construction, provider-replacement policy, and admission
// resource-descriptor mapping. No registry, coordinator, or store access —
// owner registration and lease grant/release stay in runtimePlayback.ts.

import type { LayerSource, TimelineClip } from '../../types';
import type { RuntimeProviderDemand } from '../../timeline/resources/TimelineVisualResourceDemand';
import type { RenderResourceDescriptor } from '../timeline/runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../timeline/runtimeProviderDemandBridge';
import type {
  DecodeSessionPolicy,
  MediaSourceRuntime,
  RuntimeFrameProvider,
} from './types';

export type RuntimeBackedSource = Pick<
  LayerSource,
  'runtimeSourceId' | 'runtimeSessionKey' | 'webCodecsPlayer'
> | Pick<
  NonNullable<TimelineClip['source']>,
  'runtimeSourceId' | 'runtimeSessionKey' | 'webCodecsPlayer'
>;

export const INTERACTIVE_PLAYBACK_SESSION_PREFIX = 'interactive-track:';
export const INTERACTIVE_SCRUB_SESSION_PREFIX = 'interactive-scrub:';
export const PLAYBACK_RUNTIME_POLICY_IDS: readonly DecodeSessionPolicy[] = [
  'interactive',
  'background',
  'export',
  'ram-preview',
];

export function buildPolicyRuntimeSessionKey(
  sourceId: string,
  policy: DecodeSessionPolicy,
  ownerId: string,
  sessionScope?: string
): string {
  if (sessionScope) {
    return `${policy}:${sessionScope}:${ownerId}:${sourceId}`;
  }
  return `${policy}:${ownerId}:${sourceId}`;
}

export function shouldReplaceFrameProvider(
  currentProvider: RuntimeFrameProvider | null,
  sourcePlayer: RuntimeFrameProvider | undefined
): boolean {
  if (!sourcePlayer) {
    return false;
  }
  if (!currentProvider) {
    return true;
  }
  return !currentProvider.isFullMode() && sourcePlayer.isFullMode();
}

export function isInteractiveScrubSessionKey(sessionKey: string | undefined): boolean {
  return !!sessionKey && sessionKey.startsWith(INTERACTIVE_SCRUB_SESSION_PREFIX);
}

export function getPendingProviderLoadKey(sourceId: string, sessionKey: string): string {
  return `${sourceId}:${sessionKey}`;
}

export function getRuntimeProviderResourceId(
  policy: DecodeSessionPolicy,
  sourceId: string,
  sessionKey: string,
  suffix: 'runtime-binding' | 'frame-provider'
): string {
  return `runtime-playback:${policy}:${sourceId}:${sessionKey}:${suffix}`;
}

export function hasRuntimeBinding(
  source: RuntimeBackedSource | null | undefined
): source is RuntimeBackedSource & {
  runtimeSourceId: string;
  runtimeSessionKey: string;
} {
  return !!source?.runtimeSourceId && !!source?.runtimeSessionKey;
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as T;
}

function getRuntimePlaybackLeasePolicy(
  policy: DecodeSessionPolicy
): RuntimeProviderDemand['leasePolicy'] {
  if (policy === 'interactive') return 'lease-visible';
  if (policy === 'export') return 'retain-until-release';
  return 'background-cache';
}

function createRuntimePlaybackDemand(params: {
  policy: DecodeSessionPolicy;
  runtime: MediaSourceRuntime;
  sessionKey: string;
  resourceId: string;
  resourceKind: RuntimeProviderDemand['resourceKind'];
  ownerId: string;
}): RuntimeProviderDemand {
  return {
    id: params.resourceId,
    facetId: `${params.resourceId}:facet`,
    resourceKind: params.resourceKind,
    policyId: params.policy,
    leasePolicy: getRuntimePlaybackLeasePolicy(params.policy),
    owner: removeUndefinedValues({
      ownerId: params.ownerId,
      ownerType: params.policy === 'ram-preview' ? 'ram-preview' as const : 'timeline' as const,
      mediaFileId: params.runtime.descriptor.mediaFileId,
    }),
    source: removeUndefinedValues({
      sourceId: params.runtime.sourceId,
      mediaFileId: params.runtime.descriptor.mediaFileId,
      projectPath: params.runtime.descriptor.filePath,
    }),
    dimensions: removeUndefinedValues({
      durationSeconds: params.runtime.metadata.duration,
    }),
    priority: params.policy === 'interactive' ? 'visible' : 'background',
    tags: ['runtime-playback', params.policy],
  };
}

export function createRuntimeProviderAdmissionResources(
  policy: DecodeSessionPolicy,
  runtime: MediaSourceRuntime,
  sessionKey: string,
  file: File
): RenderResourceDescriptor[] {
  const ownerId = `runtime-playback:${policy}:${runtime.sourceId}:${sessionKey}`;
  const runtimeBindingResourceId = getRuntimeProviderResourceId(
    policy,
    runtime.sourceId,
    sessionKey,
    'runtime-binding'
  );
  const frameProviderResourceId = getRuntimeProviderResourceId(
    policy,
    runtime.sourceId,
    sessionKey,
    'frame-provider'
  );

  return [
    createRenderResourceDescriptorFromDemand(createRuntimePlaybackDemand({
      policy,
      runtime,
      sessionKey,
      ownerId,
      resourceId: runtimeBindingResourceId,
      resourceKind: 'runtime-binding',
    }), {
      resourceKind: 'runtime-binding',
      runtimeSourceId: runtime.sourceId,
      runtimeSessionKey: sessionKey,
      label: 'Runtime playback binding',
    }),
    createRenderResourceDescriptorFromDemand(createRuntimePlaybackDemand({
      policy,
      runtime,
      sessionKey,
      ownerId,
      resourceId: frameProviderResourceId,
      resourceKind: 'video-frame-provider',
    }), {
      resourceKind: 'video-frame-provider',
      providerId: `${ownerId}:provider`,
      providerKind: 'webcodecs',
      canSeek: true,
      canProvideStaleFrame: false,
      frameFormat: 'video-frame',
      runtimeSourceId: runtime.sourceId,
      runtimeSessionKey: sessionKey,
      memoryCost: {
        heapBytes: file.size,
      },
      label: 'Runtime playback frame provider',
    }),
  ];
}
