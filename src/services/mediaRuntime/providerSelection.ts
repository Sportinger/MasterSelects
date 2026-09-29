import {
  decideTurboResCodec,
  type TurboResProResFourCC,
} from './prores/turboResCodecIdentity';
import {
  getHapVideoFourCC,
  type HapVideoFourCC,
} from '../hap/hapCodecIdentity';
import type { CodecProviderBackend } from './types';
export type { CodecProviderBackend };

export type RuntimeFrameProviderPlan =
  | { backend: 'turbores'; fourCC: TurboResProResFourCC }
  | { backend: 'hap'; fourCC: HapVideoFourCC }
  | { backend: 'default'; reason: 'not-prores' | 'turbores-disabled' }
  | { backend: 'unsupported'; reason: 'prores-raw' };

const CODEC_PROVIDER_BACKENDS: readonly CodecProviderBackend[] = ['turbores', 'hap'];

/** Plans whose frames come from a codec-specific provider (not the browser's native decoder). */
export type CodecProviderPlan = Extract<RuntimeFrameProviderPlan, { backend: CodecProviderBackend }>;

export function isCodecProviderBackend(backend: string | undefined): backend is CodecProviderBackend {
  return backend !== undefined && CODEC_PROVIDER_BACKENDS.includes(backend as CodecProviderBackend);
}

export function isCodecProviderPlan(plan: RuntimeFrameProviderPlan): plan is CodecProviderPlan {
  return isCodecProviderBackend(plan.backend);
}

/** Human name of the unsupported source, for "<feature> does not support X" messages. */
export function describeUnsupportedProviderPlan(
  plan: Extract<RuntimeFrameProviderPlan, { backend: 'unsupported' }>,
): string {
  switch (plan.reason) {
    case 'prores-raw': return 'ProRes RAW';
  }
}

export function selectRuntimeFrameProviderPlan(options: {
  videoCodecId: string | undefined;
  turboResEnabled: boolean;
}): RuntimeFrameProviderPlan {
  // HAP has no browser-native fallback decoder, so the HAP provider is the
  // only playback path and is not feature-gated.
  const hapFourCC = getHapVideoFourCC(options.videoCodecId);
  if (hapFourCC) {
    return { backend: 'hap', fourCC: hapFourCC };
  }
  const decision = decideTurboResCodec(options.videoCodecId, options.turboResEnabled);
  switch (decision.kind) {
    case 'turbores':
      return { backend: 'turbores', fourCC: decision.fourCC };
    case 'disabled':
      return { backend: 'default', reason: 'turbores-disabled' };
    case 'unsupported-prores-raw':
      return { backend: 'unsupported', reason: 'prores-raw' };
    case 'not-prores':
      return { backend: 'default', reason: 'not-prores' };
  }
}
