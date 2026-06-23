import { BILLING_PLANS, getLowestPaidCreditEur } from './billingPlans';
import { estimateHostedElevenLabsSpeechCredits } from './elevenLabsService';
import { calculateKieAiCost } from './kieAiService';
import {
  HOSTED_KIE_CREDIT_MULTIPLIER,
  KIEAI_IMAGE_USD_PRICING,
  KIEAI_USD_PER_CREDIT,
} from './flashboard/FlashBoardPricing';

export interface CloudAiPriceRow {
  category: string;
  credits: number;
  name: string;
  note: string;
  unit: string;
}

function getHostedKlingCreditsPerSecond(mode: 'std' | 'pro', withAudio: boolean): number {
  return calculateKieAiCost('kling-3.0', mode, 1, withAudio) * HOSTED_KIE_CREDIT_MULTIPLIER;
}

function getHostedImageCredits(imageSize: '1K' | '2K' | '4K'): number {
  const usd = KIEAI_IMAGE_USD_PRICING['nano-banana-2'][imageSize];
  return Math.round(usd / KIEAI_USD_PER_CREDIT) * HOSTED_KIE_CREDIT_MULTIPLIER;
}

export const CLOUD_EUR_PER_CREDIT = getLowestPaidCreditEur();

export const CLOUD_PRICE_BASELINE_PLAN = BILLING_PLANS
  .filter((plan) => plan.priceEurMonthly > 0 && plan.credits > 0)
  .reduce((best, plan) => (
    plan.priceEurMonthly / plan.credits < best.priceEurMonthly / best.credits ? plan : best
  ));

export const CLOUD_AI_PRICE_ROWS: readonly CloudAiPriceRow[] = [
  {
    category: 'Video',
    credits: getHostedKlingCreditsPerSecond('std', false),
    name: 'Kling 3.0 Standard',
    note: '720p, no audio',
    unit: 'sec',
  },
  {
    category: 'Video',
    credits: getHostedKlingCreditsPerSecond('std', true),
    name: 'Kling 3.0 Standard + Sound',
    note: '720p, audio or multi-shot',
    unit: 'sec',
  },
  {
    category: 'Video',
    credits: getHostedKlingCreditsPerSecond('pro', false),
    name: 'Kling 3.0 Pro',
    note: '1080p, no audio',
    unit: 'sec',
  },
  {
    category: 'Video',
    credits: getHostedKlingCreditsPerSecond('pro', true),
    name: 'Kling 3.0 Pro + Sound',
    note: '1080p, audio or multi-shot',
    unit: 'sec',
  },
  {
    category: 'Image',
    credits: getHostedImageCredits('1K'),
    name: 'Nano Banana 2 Cloud',
    note: '1K image',
    unit: 'image',
  },
  {
    category: 'Image',
    credits: getHostedImageCredits('2K'),
    name: 'Nano Banana 2 Cloud',
    note: '2K image',
    unit: 'image',
  },
  {
    category: 'Image',
    credits: getHostedImageCredits('4K'),
    name: 'Nano Banana 2 Cloud',
    note: '4K image',
    unit: 'image',
  },
  {
    category: 'Speech',
    credits: estimateHostedElevenLabsSpeechCredits('x'.repeat(1000), 'eleven_multilingual_v2').creditsRequired,
    name: 'ElevenLabs Cloud',
    note: 'default text-to-speech model',
    unit: '1K chars',
  },
  {
    category: 'Speech',
    credits: 6,
    name: 'OpenAI Whisper Cloud',
    note: 'signed-in transcription',
    unit: 'min',
  },
  {
    category: 'Chat',
    credits: 1,
    name: 'OpenAI Cloud Chat',
    note: 'mini and nano models',
    unit: 'request',
  },
  {
    category: 'Chat',
    credits: 5,
    name: 'OpenAI Cloud Chat',
    note: 'standard hosted chat models',
    unit: 'request',
  },
  {
    category: 'Chat',
    credits: 50,
    name: 'OpenAI Cloud Chat',
    note: 'deep reasoning upper tier',
    unit: 'request',
  },
];
