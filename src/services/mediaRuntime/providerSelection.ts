import {
  decideTurboResCodec,
  type TurboResProResFourCC,
} from './prores/turboResCodecIdentity';
import {
  getHapVideoFourCC,
  type HapVideoFourCC,
} from '../hap/hapCodecIdentity';
import type { CodecProviderBackend } from './types';
import { getMxfUnsupportedReason, isMxfCodecId } from '../mediaMetadata/mxf/mxfMediaMetadata';
export type { CodecProviderBackend };

export type RuntimeFrameProviderPlan =
  | { backend: 'turbores'; fourCC: TurboResProResFourCC }
  | { backend: 'hap'; fourCC: HapVideoFourCC }
  | { backend: 'default'; reason: 'not-prores' | 'turbores-disabled' }
  | { backend: 'unsupported'; reason: 'prores-raw' | 'mxf-unsupported-essence' | 'mxf-decoder-unavailable' };

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
    case 'mxf-unsupported-essence': return 'this MXF essence (e.g. JPEG 2000)';
    case 'mxf-decoder-unavailable': return 'this MXF codec (browser decoder not available yet)';
  }
}

export function selectRuntimeFrameProviderPlan(options: {
  videoCodecId: string | undefined;
  turboResEnabled: boolean;
}): RuntimeFrameProviderPlan {
  // HAP has no browser-native fallback decoder, so the HAP provider is the
  // only playback path and is not feature-gated.
  // Namespaced MXF essence ids never fall back to the browser decoder: HTMLVideoElement
  // cannot open MXF. Decoder backends are added per codec (plan phases 3-5).
  if (isMxfCodecId(options.videoCodecId)) {
    return getMxfUnsupportedReason(options.videoCodecId)
      ? { backend: 'unsupported', reason: 'mxf-unsupported-essence' }
      : { backend: 'unsupported', reason: 'mxf-decoder-unavailable' };
  }
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
