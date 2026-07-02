import type { VideoProvider } from '../piApiService';
import {
  RUNWAY_ASPECT_RATIOS,
  RUNWAY_VIDEO_PROVIDER_ID,
  SEEDANCE_2_ASPECT_RATIOS,
  SEEDANCE_2_DURATIONS,
  SEEDANCE_2_FAST_PROVIDER_ID,
  SEEDANCE_2_PROVIDER_ID,
  TOPAZ_VIDEO_UPSCALE_PROVIDER_ID,
  VEO_3_1_PROVIDER_ID,
} from './config';

const KIEAI_PROVIDERS: VideoProvider[] = [
  {
    id: 'kling-3.0',
    name: 'Kling 3.0',
    description: 'Latest Kling model via Kie.ai',
    versions: ['3.0'],
    supportedModes: ['std', 'pro', '4K'],
    supportedDurations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportedAspectRatios: ['16:9', '9:16', '1:1'],
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: SEEDANCE_2_PROVIDER_ID,
    name: 'Seedance 2.0',
    description: 'Multimodal reference-to-video via Kie.ai',
    versions: ['2.0'],
    supportedModes: ['480p', '720p', '1080p'],
    supportedDurations: SEEDANCE_2_DURATIONS,
    supportedAspectRatios: SEEDANCE_2_ASPECT_RATIOS,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: SEEDANCE_2_FAST_PROVIDER_ID,
    name: 'Seedance 2.0 Fast',
    description: 'Faster multimodal reference-to-video via Kie.ai',
    versions: ['2.0-fast'],
    supportedModes: ['480p', '720p'],
    supportedDurations: SEEDANCE_2_DURATIONS,
    supportedAspectRatios: SEEDANCE_2_ASPECT_RATIOS,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: VEO_3_1_PROVIDER_ID,
    name: 'Veo 3.1',
    description: 'Google Veo 3.1 video generation via Kie.ai',
    versions: ['3.1'],
    supportedModes: ['veo3_fast', 'veo3', 'veo3_lite'],
    supportedDurations: [],
    supportedAspectRatios: ['16:9', '9:16'],
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: RUNWAY_VIDEO_PROVIDER_ID,
    name: 'Runway',
    description: 'Runway video generation via Kie.ai',
    versions: ['latest'],
    supportedModes: ['720p', '1080p'],
    supportedDurations: [5, 10],
    supportedAspectRatios: RUNWAY_ASPECT_RATIOS,
    supportsImageToVideo: true,
    supportsTextToVideo: true,
  },
  {
    id: TOPAZ_VIDEO_UPSCALE_PROVIDER_ID,
    name: 'Topaz Video Upscale',
    description: 'Topaz video upscaling via Kie.ai',
    versions: ['latest'],
    supportedModes: ['2x', '4x'],
    supportedDurations: [],
    supportedAspectRatios: [],
    supportsImageToVideo: false,
    supportsTextToVideo: true,
  },
];

interface KieAiCreditRate {
  normal: number;
  audio?: number;
  videoInput?: number;
}

export interface KieAiCostOptions {
  hasVideoInput?: boolean;
}

// Kie.ai pricing in vendor CREDITS per second
// Source: Kie.ai public pricing API, checked 2026-05-28
// std no-audio (720p): 14 credits/s ($0.07/s)
// std audio (720p):    20 credits/s ($0.10/s)
// pro no-audio (1080p): 18 credits/s ($0.09/s)
// pro audio (1080p):    27 credits/s ($0.135/s)
// 1 credit = $0.005
const KIEAI_CREDITS_PER_SECOND: Record<string, Record<string, KieAiCreditRate>> = {
  'kling-3.0': {
    'std': { normal: 14, audio: 20 },
    'pro': { normal: 18, audio: 27 },
    '4K': { normal: 67, audio: 67 },
  },
  [SEEDANCE_2_PROVIDER_ID]: {
    '480p': { normal: 19, videoInput: 11.5 },
    '720p': { normal: 41, videoInput: 25 },
    '1080p': { normal: 102, videoInput: 62 },
  },
  [SEEDANCE_2_FAST_PROVIDER_ID]: {
    '480p': { normal: 15.5, videoInput: 9 },
    '720p': { normal: 33, videoInput: 20 },
  },
};

export function getKieAiProviders(): VideoProvider[] {
  return KIEAI_PROVIDERS;
}

export function getKieAiProvider(providerId: string): VideoProvider | undefined {
  return KIEAI_PROVIDERS.find(p => p.id === providerId);
}

export function calculateKieAiCost(
  provider: string,
  mode: string,
  duration: number,
  sound = false,
  options: KieAiCostOptions = {},
): number {
  const providerRates = KIEAI_CREDITS_PER_SECOND[provider];
  if (!providerRates) return duration * 14;
  const modeRates = providerRates[mode];
  if (!modeRates) return duration * 14;
  const ratePerSecond = options.hasVideoInput && modeRates.videoInput != null
    ? modeRates.videoInput
    : sound && modeRates.audio != null
      ? modeRates.audio
      : modeRates.normal;
  return duration * ratePerSecond;
}
