import type { FlashBoardGenerationRequest } from '../../stores/flashboardStore/types';
import { calculateKieAiCost } from '../kieAiService';
import { calculateCost as calculatePiApiCost } from '../piApiService';
import type { CatalogEntry } from './types';

const KIEAI_USD_PER_CREDIT = 0.005;
// Hosted customer credits are priced at 5x vendor Kie credits for a small margin.
const HOSTED_KIE_CREDIT_MULTIPLIER = 5;

const KIEAI_IMAGE_USD_PRICING: Record<string, Record<string, number>> = {
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
  multiShots?: boolean;
  outputType?: FlashBoardGenerationRequest['outputType'];
  providerId: string;
  service: PricingService;
}

function formatUsd(value: number): string {
  return `~$${value.toFixed(2)}`;
}

function normalizeVideoDuration(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 5;
  }

  return Math.max(3, Math.min(15, Math.floor(value)));
}

function normalizeMode(value: string | undefined): string {
  return value === 'pro' ? 'pro' : 'std';
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

function buildKieVideoEstimate(input: FlashBoardPricingInput): FlashBoardPriceEstimate {
  const duration = normalizeVideoDuration(input.duration);
  const mode = normalizeMode(input.mode);
  const kieCredits = calculateKieAiCost(input.providerId, mode, duration, resolveEffectiveAudio(input));

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
  if (input.service === 'cloud') {
    if (input.outputType === 'image' || input.providerId === 'nano-banana-2') {
      return buildHostedImageEstimate(input);
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
