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
import { decodeTurboResOneFrame } from '../prores/turboResOneFrame';
import { decodeHapOneFrame } from '../hap/hapOneFrame';
import { createMxfAvcFrameProvider } from '../mxf/MxfAvcFrameProvider';
import { createMxfLibavFrameProvider, planLibavWorkerCount } from '../mxf/MxfLibavFrameProvider';

export interface CodecProviderCreateParams {
  sourceId: string;
  file: File;
  plan: CodecProviderPlan;
  policy: DecodeSessionPolicy;
  /**
   * 'sdr' asks for an 8-bit-safe output (thumbnails/Canvas2D consumers render
   * high-bit-depth VideoFrames black on some Chromium/Windows combinations).
   */
  outputProfile?: 'native' | 'sdr';
  onFrame?: () => void;
  onError?: (error: Error) => void;
}

export type CodecRuntimeFrameProvider = RuntimeFrameProvider & {
  seek(timeSeconds: number): void;
  seekExact(timeSeconds: number): Promise<void>;
  destroyAsync(): Promise<void>;
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
  /** Decodes one owned VideoFrame (thumbnails, probes). */
  decodeOneFrame(file: File, plan: CodecProviderPlan, timeSeconds: number): Promise<VideoFrame>;
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
      ...(params.outputProfile === 'sdr' ? { allowedOutputFormats: ['I420' as PixelFormat] } : {}),
      onFrame: params.onFrame,
      onError: params.onError,
    });
  },
  decodeOneFrame: (file, plan, timeSeconds) => {
    if (plan.backend !== 'turbores') return Promise.reject(new Error('Descriptor/plan mismatch'));
    return decodeTurboResOneFrame(file, plan.fourCC, timeSeconds, {
      providerOptions: { allowedOutputFormats: ['I420'] },
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
  decodeOneFrame: (file, plan, timeSeconds) => {
    if (plan.backend !== 'hap') return Promise.reject(new Error('Descriptor/plan mismatch'));
    return decodeHapOneFrame(file, plan.fourCC, timeSeconds);
  },
};

/** Decodes one frame with a short-lived provider and returns an owned clone. */
async function decodeOneFrameWithProvider(
  descriptor: CodecProviderDescriptor,
  file: File,
  plan: CodecProviderPlan,
  timeSeconds: number,
): Promise<VideoFrame> {
  const provider = await descriptor.create({
    sourceId: `${descriptor.backend}-one-frame:${file.name}:${file.size}`,
    file,
    plan,
    policy: 'background',
    outputProfile: 'sdr',
  });
  if (!provider) throw new Error(`${descriptor.logName} could not initialize`);
  try {
    await provider.seekExact(timeSeconds);
    const frame = provider.getCurrentFrame();
    if (!(frame instanceof VideoFrame)) throw new Error(`${descriptor.logName} produced no frame`);
    return frame.clone();
  } finally {
    await provider.destroyAsync();
  }
}

const mxfAvcDescriptor: CodecProviderDescriptor = {
  backend: 'mxf-avc',
  logName: 'MXF AVC',
  resourceLabel: 'MXF AVC (WebCodecs) frame provider',
  exportResourceLabel: 'Export MXF AVC frame provider',
  describePlan: (plan) => ({ codecId: plan.backend === 'mxf-avc' ? plan.codecId : undefined }),
  // Decoder surfaces are GPU/driver owned; count the ready-frame window (NV12) plus demux reads.
  estimateHeapBytes: (runtime) => {
    const width = runtime.metadata.width ?? 1920;
    const height = runtime.metadata.height ?? 1080;
    return width * height * 1.5 * 8 + 8 * 1024 * 1024;
  },
  resourceTags: (runtime, policy) => ['runtime-playback', policy, 'mxf-avc', runtime.metadata.videoCodecId ?? 'mxf:avc'],
  create: async (params) => {
    if (params.plan.backend !== 'mxf-avc') return null;
    return createMxfAvcFrameProvider({
      sourceId: params.sourceId,
      file: params.file,
      codecId: params.plan.codecId,
      policy: params.policy,
      onFrame: params.onFrame,
      onError: params.onError,
    });
  },
  decodeOneFrame: (file, plan, timeSeconds) => decodeOneFrameWithProvider(mxfAvcDescriptor, file, plan, timeSeconds),
};

/** WASM heap per worker: libavcodec state plus one 4:2:2 16-bit frame and packet copies. */
const LIBAV_WORKER_BASE_HEAP_BYTES = 24 * 1024 * 1024;

const mxfLibavDescriptor: CodecProviderDescriptor = {
  backend: 'mxf-libav',
  logName: 'MXF libavcodec',
  resourceLabel: 'MXF libavcodec (WASM) frame provider',
  exportResourceLabel: 'Export MXF libavcodec frame provider',
  describePlan: (plan) => ({ codecId: plan.backend === 'mxf-libav' ? plan.codecId : undefined }),
  estimateHeapBytes: (runtime, policy) => {
    const width = runtime.metadata.codedWidth ?? runtime.metadata.width ?? 1920;
    const height = runtime.metadata.codedHeight ?? runtime.metadata.height ?? 1080;
    const frameBytes = width * height * 2 * 2;
    const workers = planLibavWorkerCount(policy, width, height);
    return workers * (LIBAV_WORKER_BASE_HEAP_BYTES + frameBytes * 2) + frameBytes * (workers + 2);
  },
  resourceTags: (runtime, policy) => ['runtime-playback', policy, 'mxf-libav', runtime.metadata.videoCodecId ?? 'mxf'],
  create: async (params) => {
    if (params.plan.backend !== 'mxf-libav') return null;
    return createMxfLibavFrameProvider({
      sourceId: params.sourceId,
      file: params.file,
      codecId: params.plan.codecId,
      policy: params.policy,
      eightBit: params.outputProfile === 'sdr',
      onFrame: params.onFrame,
      onError: params.onError,
    });
  },
  decodeOneFrame: (file, plan, timeSeconds) => decodeOneFrameWithProvider(mxfLibavDescriptor, file, plan, timeSeconds),
};

const DESCRIPTORS: Record<CodecProviderBackend, CodecProviderDescriptor> = {
  turbores: turboResDescriptor,
  hap: hapDescriptor,
  'mxf-avc': mxfAvcDescriptor,
  'mxf-libav': mxfLibavDescriptor,
};

export function getCodecProviderDescriptor(backend: CodecProviderBackend): CodecProviderDescriptor {
  return DESCRIPTORS[backend];
}
