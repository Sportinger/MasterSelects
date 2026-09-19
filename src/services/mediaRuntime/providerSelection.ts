import {
  decideTurboResCodec,
  type TurboResProResFourCC,
} from './prores/turboResCodecIdentity';
import {
  getHapVideoFourCC,
  type HapVideoFourCC,
} from '../hap/hapCodecIdentity';

export type RuntimeFrameProviderPlan =
  | { backend: 'turbores'; fourCC: TurboResProResFourCC }
  | { backend: 'hap'; fourCC: HapVideoFourCC }
  | { backend: 'default'; reason: 'not-prores' | 'turbores-disabled' }
  | { backend: 'unsupported'; reason: 'prores-raw' };

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
