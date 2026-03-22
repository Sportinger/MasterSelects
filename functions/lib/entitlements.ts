import type { AppD1Database } from './env';

export type BillingPlanId = 'free' | 'starter' | 'pro' | 'studio';

export type BillingEntitlementKey =
  | 'hosted_ai_chat'
  | 'kling_generation'
  | 'priority_queue'
  | 'api_access';

export interface BillingPlanDefinition {
  id: BillingPlanId;
  label: string;
  monthlyCredits: number;
  featured: boolean;
  entitlementKeys: BillingEntitlementKey[];
}

export interface EntitlementRow {
  feature_key: string;
  source: string;
  updated_at: string;
  value: string;
}

export interface EntitlementSnapshot {
  hostedAIEnabled: boolean;
  klingGenerationEnabled: boolean;
  monthlyCredits: number;
  plan: BillingPlanDefinition;
  values: Record<string, string>;
}

export const TRACKED_ENTITLEMENT_KEYS: BillingEntitlementKey[] = [
  'hosted_ai_chat',
  'kling_generation',
  'priority_queue',
  'api_access',
];

export const BILLING_PLANS: Record<BillingPlanId, BillingPlanDefinition> = {
  free: {
    id: 'free',
    label: 'Free',
    monthlyCredits: 25,
    featured: false,
    entitlementKeys: ['hosted_ai_chat'],
  },
  starter: {
    id: 'starter',
    label: 'Starter',
    monthlyCredits: 4500,
    featured: false,
    entitlementKeys: ['hosted_ai_chat'],
  },
  pro: {
    id: 'pro',
    label: 'Pro',
    monthlyCredits: 13500,
    featured: true,
    entitlementKeys: ['hosted_ai_chat', 'kling_generation', 'priority_queue'],
  },
  studio: {
    id: 'studio',
    label: 'Studio',
    monthlyCredits: 27000,
    featured: true,
    entitlementKeys: ['hosted_ai_chat', 'kling_generation', 'priority_queue', 'api_access'],
  },
};

export function isBillingPlanId(value: string | null | undefined): value is BillingPlanId {
  return value === 'free' || value === 'starter' || value === 'pro' || value === 'studio';
}

export function normalizeBillingPlanId(value: unknown, fallback: BillingPlanId = 'free'): BillingPlanId {
  if (typeof value === 'string' && isBillingPlanId(value)) {
    return value;
  }

  return fallback;
}

export function getBillingPlan(planId: BillingPlanId | string | null | undefined): BillingPlanDefinition {
  const normalized = typeof planId === 'string' && isBillingPlanId(planId) ? planId : 'free';
  return BILLING_PLANS[normalized];
}

export function isFeatureEnabled(rows: Record<string, string>, featureKey: BillingEntitlementKey): boolean {
  const value = rows[featureKey];
  if (value == null) {
    return false;
  }

  return value === 'true' || value === '1' || value === 'enabled' || value === 'yes';
}

export function getEntitlementSnapshot(planId: BillingPlanId, rows: EntitlementRow[] = []): EntitlementSnapshot {
  const plan = getBillingPlan(planId);
  const values = rows.reduce<Record<string, string>>((accumulator, row) => {
    accumulator[row.feature_key] = row.value;
    return accumulator;
  }, {});

  const hostedAIEnabled = isFeatureEnabled(values, 'hosted_ai_chat') || plan.entitlementKeys.includes('hosted_ai_chat');
  const klingGenerationEnabled =
    isFeatureEnabled(values, 'kling_generation') || plan.entitlementKeys.includes('kling_generation');

  return {
    hostedAIEnabled,
    klingGenerationEnabled,
    monthlyCredits: plan.monthlyCredits,
    plan,
    values,
  };
}

export async function listEntitlements(db: AppD1Database, userId: string): Promise<EntitlementRow[]> {
  try {
    const result = await db
      .prepare(
        `
          SELECT feature_key, source, updated_at, value
          FROM entitlements
          WHERE user_id = ?
          ORDER BY updated_at DESC, feature_key ASC
        `,
      )
      .bind(userId)
      .all<EntitlementRow>();

    return result.results ?? [];
  } catch {
    return [];
  }
}

export async function upsertEntitlementsForPlan(
  db: AppD1Database,
  userId: string,
  planId: BillingPlanId,
  source: string,
): Promise<void> {
  const plan = getBillingPlan(planId);
  const now = new Date().toISOString();
  const enabledKeys = new Set(plan.entitlementKeys);

  for (const featureKey of TRACKED_ENTITLEMENT_KEYS) {
    await db
      .prepare(
        `
          INSERT INTO entitlements (user_id, feature_key, value, source, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, feature_key) DO UPDATE SET
            value = excluded.value,
            source = excluded.source,
            updated_at = excluded.updated_at
        `,
      )
      .bind(userId, featureKey, enabledKeys.has(featureKey) ? 'true' : 'false', source, now)
      .run();
  }
}

export function planIdFromSubscriptionStatus(
  status: string | null | undefined,
  metadataPlanId: string | null | undefined,
): BillingPlanId {
  if (isBillingPlanId(metadataPlanId)) {
    return metadataPlanId;
  }

  if (status === 'active' || status === 'trialing') {
    return 'pro';
  }

  return 'free';
}
