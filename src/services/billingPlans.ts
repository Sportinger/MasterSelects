import type { BillingPlanId } from './cloudApi';

export interface BillingPlanDefinition {
  badge: string;
  credits: number;
  description: string;
  featured: boolean;
  features: string[];
  id: BillingPlanId;
  priceAmount: string;
  priceEurMonthly: number;
  priceSuffix: string;
}

export const BILLING_PLANS: readonly BillingPlanDefinition[] = [
  {
    id: 'free',
    badge: 'Entry',
    credits: 25,
    description: 'A lightweight way to try the hosted workflow before subscribing.',
    featured: false,
    features: [
      '25 credits every month',
      'Good for chat and small image runs',
      'No payment setup required',
    ],
    priceAmount: '0',
    priceEurMonthly: 0,
    priceSuffix: 'EUR',
  },
  {
    id: 'starter',
    badge: 'Creator',
    credits: 4500,
    description: 'A practical monthly plan for image runs and short video work.',
    featured: false,
    features: [
      '4.5K monthly credits',
      'Built for images and short hosted videos',
      'A strong default for regular use',
    ],
    priceAmount: '4,90',
    priceEurMonthly: 4.9,
    priceSuffix: 'EUR / mo',
  },
  {
    id: 'pro',
    badge: 'Popular',
    credits: 13500,
    description: 'More headroom plus priority treatment when the hosted queue is busy.',
    featured: true,
    features: [
      '13.5K monthly credits',
      'Priority queue access',
      'Best fit for frequent generation sessions',
    ],
    priceAmount: '14,90',
    priceEurMonthly: 14.9,
    priceSuffix: 'EUR / mo',
  },
  {
    id: 'studio',
    badge: 'Production',
    credits: 27000,
    description: 'The largest monthly pool for teams or heavy production usage.',
    featured: false,
    features: [
      '27K monthly credits',
      'Highest credit volume',
      'Best for sustained production workloads',
    ],
    priceAmount: '29,90',
    priceEurMonthly: 29.9,
    priceSuffix: 'EUR / mo',
  },
];

export function formatBillingPlanLabel(planId: string): string {
  return planId.charAt(0).toUpperCase() + planId.slice(1);
}

export function getPaidBillingPlans(): BillingPlanDefinition[] {
  return BILLING_PLANS.filter((plan) => plan.priceEurMonthly > 0 && plan.credits > 0);
}

export function getLowestPaidCreditEur(): number {
  return getPaidBillingPlans().reduce((lowest, plan) => {
    const pricePerCredit = plan.priceEurMonthly / plan.credits;
    return Math.min(lowest, pricePerCredit);
  }, Number.POSITIVE_INFINITY);
}
