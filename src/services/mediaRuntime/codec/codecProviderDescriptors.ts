// Backend descriptors for codec-specific frame providers. Playback creation,
// resource admission, and export reporting read from here instead of branching
// on backend names, so a new backend is one entry plus its provider class.

import type { PixelFormat } from 'turbores';
import type {
  CodecProviderBackend,
  DecodeSessionPolicy,
  MediaSourceRuntime,
  RuntimeFrameProvider,
} from '../types';
import type { CodecProviderPlan } from '../providerSelection';
import { createTurboResFrameProvider } from '../prores/TurboResFrameProvider';
import { createHapFrameProvider } from '../hap/HapFrameProvider';
import { estimateTurboResResources, planTurboResRuntimePolicy } from '../prores/turboResResourceEstimate';
import { estimateHapResources } from '../hap/hapResourceEstimate';

export interface CodecProviderCreateParams {
  sourceId: string;
  file: File;
  plan: CodecProviderPlan;
  policy: DecodeSessionPolicy;
  onFrame: () => void;
  onError: (error: Error) => void;
}

export type CodecRuntimeFrameProvider = RuntimeFrameProvider & {
  seek(timeSeconds: number): void;
};

export interface CodecProviderDescriptor {
  readonly backend: CodecProviderBackend;
  /** Name used in logs ("<name> provider ready"). */
  readonly logName: string;
  readonly resourceLabel: string;
  readonly exportResourceLabel: string;
  /** Extra plan fields worth logging (e.g. fourCC). */
  describePlan(plan: CodecProviderPlan): Record<string, unknown>;
  estimateHeapBytes(runtime: MediaSourceRuntime, policy: DecodeSessionPolicy): number;
  resourceTags(runtime: MediaSourceRuntime, policy: DecodeSessionPolicy): string[];
  create(params: CodecProviderCreateParams): Promise<CodecRuntimeFrameProvider | null>;
}

const turboResDescriptor: CodecProviderDescriptor = {
  backend: 'turbores',
  logName: 'TurboRes',
  resourceLabel: 'TurboRes ProRes frame provider',
  exportResourceLabel: 'Export TurboRes frame provider',
  describePlan: (plan) => ({ fourCC: plan.backend === 'turbores' ? plan.fourCC : undefined }),
  estimateHeapBytes: (runtime, policy) => {
    const pixelFormat: PixelFormat = runtime.metadata.videoCodecId === 'ap4h'
      || runtime.metadata.videoCodecId === 'ap4x'
      ? 'I444AP12'
      : 'I422P10';
    const sharedMemoryAvailable = typeof SharedArrayBuffer !== 'undefined'
      && typeof crossOriginIsolated !== 'undefined'
      && crossOriginIsolated;
    const runtimePolicy = planTurboResRuntimePolicy(policy, sharedMemoryAvailable);
    return estimateTurboResResources({
      width: runtime.metadata.codedWidth ?? runtime.metadata.width ?? 1920,
      height: runtime.metadata.codedHeight ?? runtime.metadata.height ?? 1088,
      pixelFormat,
      concurrency: runtimePolicy.concurrency,
      useSharedMemory: runtimePolicy.useSharedMemory,
    }).heapBytes;
  },
  resourceTags: (runtime, policy) => ['runtime-playback', policy, 'turbores', runtime.metadata.videoCodecId ?? 'prores'],
  create: async (params) => {
    if (params.plan.backend !== 'turbores') return null;
    return createTurboResFrameProvider({
      sourceId: params.sourceId,
      file: params.file,
      fourCC: params.plan.fourCC,
      policy: params.policy,
      onFrame: params.onFrame,
      onError: params.onError,
    });
  },
};

const hapDescriptor: CodecProviderDescriptor = {
  backend: 'hap',
  logName: 'HAP',
  resourceLabel: 'HAP frame provider',
  exportResourceLabel: 'Export HAP frame provider',
  describePlan: (plan) => ({ fourCC: plan.backend === 'hap' ? plan.fourCC : undefined }),
  estimateHeapBytes: (runtime) => estimateHapResources({
    width: runtime.metadata.width ?? 1920,
    height: runtime.metadata.height ?? 1080,
  }).heapBytes,
  resourceTags: (runtime, policy) => ['runtime-playback', policy, 'hap', runtime.metadata.videoCodecId ?? 'hap'],
  create: async (params) => {
    if (params.plan.backend !== 'hap') return null;
    return createHapFrameProvider({
      sourceId: params.sourceId,
      file: params.file,
      fourCC: params.plan.fourCC,
      policy: params.policy,
      onFrame: params.onFrame,
      onError: params.onError,
    });
  },
};

const DESCRIPTORS: Record<CodecProviderBackend, CodecProviderDescriptor> = {
  turbores: turboResDescriptor,
  hap: hapDescriptor,
};

export function getCodecProviderDescriptor(backend: CodecProviderBackend): CodecProviderDescriptor {
  return DESCRIPTORS[backend];
}
