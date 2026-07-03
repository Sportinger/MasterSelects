import type { FlashBoardGenerationRequest } from '../../stores/flashboardStore/types';
import { calculateKieAiCost } from '../kieAiService';
import { calculateCost as calculatePiApiCost } from '../piApiService';
import { estimateHostedElevenLabsSpeechCredits, type ElevenLabsModelRates } from '../elevenLabsService';
import { SUNO_PROVIDER_ID, SUNO_SOUNDS_PROVIDER_ID } from '../sunoService';
import type { CatalogEntry } from './types';

export const KIEAI_USD_PER_CREDIT = 0.005;
// Hosted customer credits are priced at 6x vendor Kie credits to keep margin after VAT, Stripe, and FX.
export const HOSTED_KIE_CREDIT_MULTIPLIER = 6;
export const KIEAI_SUNO_VENDOR_CREDITS = 12;

export const KIEAI_IMAGE_USD_PRICING: Record<string, Record<string, number>> = {
  'nano-banana-2': {
    '1K': 0.04,
    '2K': 0.06,
    '4K': 0.09,
  },
};

type PricingService = CatalogEntry['service'];

export interface FlashBoardPriceEstimate {
  compactLabel: string;
  fullLabel: string;
}

export interface FlashBoardPricingInput {
  duration?: number;
  generateAudio?: boolean;
  imageSize?: string;
  mode?: string;
  modelId?: string;
  modelRates?: ElevenLabsModelRates;
  multiShots?: boolean;
  outputType?: FlashBoardGenerationRequest['outputType'];
  providerId: string;
  service: PricingService;
  text?: string;
  hasVideoInput?: boolean;
}

function formatUsd(value: number): string {
  return `~$${value.toFixed(2)}`;
}

function normalizeVideoDuration(value: number | undefined, min = 3): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return Math.max(min, 5);
  }

  return Math.max(min, Math.min(15, Math.floor(value)));
}

function normalizeMode(value: string | undefined): string {
  if (value === 'pro' || value === '4K') {
    return value;
  }

  return 'std';
}

function resolveEffectiveAudio(input: FlashBoardPricingInput): boolean {
  return Boolean(input.generateAudio) || Boolean(input.multiShots);
}

function buildHostedKlingEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate {
  const duration = normalizeVideoDuration(input.duration);
  const mode = normalizeMode(input.mode);
  const kieCredits = calculateKieAiCost('kling-3.0', mode, duration, resolveEffectiveAudio(input));
  const hostedCredits = kieCredits * HOSTED_KIE_CREDIT_MULTIPLIER;

  return {
    compactLabel: `${hostedCredits} cr`,
    fullLabel: `${hostedCredits} credits`,
  };
}

function buildHostedImageEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate | null {
  const size = input.imageSize ?? '1K';
  const usd = KIEAI_IMAGE_USD_PRICING[input.providerId]?.[size];

  if (usd == null) {
    return null;
  }

  const kieCredits = Math.round(usd / KIEAI_USD_PER_CREDIT);
  const hostedCredits = kieCredits * HOSTED_KIE_CREDIT_MULTIPLIER;

  return {
    compactLabel: `${hostedCredits} cr`,
    fullLabel: `${hostedCredits} credits`,
  };
}

function buildHostedElevenLabsEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate | null {
  const text = input.text?.trim() ?? '';
  if (!text) {
    return null;
  }

  const estimate = estimateHostedElevenLabsSpeechCredits(
    text,
    input.modelId ?? 'eleven_multilingual_v2',
    input.modelRates,
  );

  return {
    compactLabel: `${estimate.creditsRequired} cr`,
    fullLabel: `${estimate.creditsRequired} credits for ${estimate.textCharacters.toLocaleString()} chars`,
  };
}

function buildHostedSeedanceEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate {
  const duration = normalizeVideoDuration(input.duration, 4);
  const kieCredits = calculateKieAiCost(input.providerId, input.mode ?? '720p', duration, false, {
    hasVideoInput: input.hasVideoInput,
  });
  const hostedCredits = Math.ceil(kieCredits * HOSTED_KIE_CREDIT_MULTIPLIER);

  return {
    compactLabel: `${hostedCredits} cr`,
    fullLabel: `${hostedCredits} credits`,
  };
}

function buildHostedSunoEstimate(): FlashBoardPriceEstimate {
  const hostedCredits = KIEAI_SUNO_VENDOR_CREDITS * HOSTED_KIE_CREDIT_MULTIPLIER;

  return {
    compactLabel: `${hostedCredits} cr`,
    fullLabel: `${hostedCredits} credits`,
  };
}

function buildKieSunoEstimate(): FlashBoardPriceEstimate {
  return {
    compactLabel: `${KIEAI_SUNO_VENDOR_CREDITS} cr`,
    fullLabel: `${KIEAI_SUNO_VENDOR_CREDITS} Kie credits`,
  };
}

function buildKieVideoEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate {
  const isSeedance2 = input.providerId.includes('seedance-2');
  const duration = normalizeVideoDuration(input.duration, isSeedance2 ? 4 : 3);
  const mode = normalizeMode(input.mode);
  const effectiveMode = isSeedance2 ? input.mode ?? '720p' : mode;
  const kieCredits = calculateKieAiCost(input.providerId, effectiveMode, duration, resolveEffectiveAudio(input), {
    hasVideoInput: input.hasVideoInput,
  });

  return {
    compactLabel: `${kieCredits} cr`,
    fullLabel: `${kieCredits} Kie credits`,
  };
}

function buildKieImageEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate | null {
  const size = input.imageSize ?? '1K';
  const usd = KIEAI_IMAGE_USD_PRICING[input.providerId]?.[size];

  if (usd == null) {
    return null;
  }

  const kieCredits = Math.round(usd / KIEAI_USD_PER_CREDIT);

  return {
    compactLabel: `${kieCredits} cr`,
    fullLabel: `${kieCredits} Kie credits`,
  };
}

function buildPiApiEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate {
  const duration = input.duration && input.duration > 0 ? input.duration : 5;
  const mode = normalizeMode(input.mode);
  const usd = calculatePiApiCost(input.providerId, mode, duration);

  return {
    compactLabel: formatUsd(usd),
    fullLabel: formatUsd(usd),
  };
}

export function getFlashBoardPriceEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate | null {
  if (input.outputType === 'audio') {
    if (input.providerId === SUNO_PROVIDER_ID || input.providerId === SUNO_SOUNDS_PROVIDER_ID) {
      return input.service === 'cloud' ? buildHostedSunoEstimate() : buildKieSunoEstimate();
    }

    return input.service === 'cloud' ? buildHostedElevenLabsEstimate(input) : null;
  }

  if (input.service === 'elevenlabs') {
    return null;
  }

  if (input.service === 'evolink') {
    return null;
  }

  if (input.service === 'cloud') {
    if (input.outputType === 'image' || input.providerId === 'nano-banana-2') {
      return buildHostedImageEstimate(input);
    }

    if (input.providerId.includes('seedance-2')) {
      return buildHostedSeedanceEstimate(input);
    }

    return buildHostedKlingEstimate(input);
  }

  if (input.service === 'piapi') {
    return buildPiApiEstimate(input);
  }

  if (input.outputType === 'image' || input.providerId === 'nano-banana-2') {
    return buildKieImageEstimate(input);
  }

  return buildKieVideoEstimate(input);
}

export function getCatalogEntryPriceEstimate(
  entry: CatalogEntry,
  overrides: Partial<Omit<FlashBoardPricingInput, 'providerId' | 'service'>> = {},
): FlashBoardPriceEstimate | null {
  return getFlashBoardPriceEstimate({
    duration: entry.durations.includes(overrides.duration ?? -1) ? overrides.duration : entry.durations[0],
    generateAudio: overrides.generateAudio ?? false,
    imageSize: entry.imageSizes?.includes(overrides.imageSize ?? '') ? overrides.imageSize : entry.imageSizes?.[0],
    mode: entry.modes.includes(overrides.mode ?? '') ? overrides.mode : entry.modes[0],
    multiShots: overrides.multiShots ?? false,
    outputType: overrides.outputType ?? entry.outputType,
    providerId: entry.providerId,
    service: entry.service,
  });
}
