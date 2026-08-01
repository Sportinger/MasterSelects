import { ensureFreePlanCredits, getCreditBalance, getCreditMeterReference } from './credits';
import {
  getEntitlementSnapshot,
  listEntitlements,
  normalizeBillingPlanId,
  type BillingPlanId,
  type EntitlementSnapshot,
} from './entitlements';
import type { AppD1Database } from './env';

interface SubscriptionRow {
  plan_id: string | null;
}

export interface UserBillingSnapshot {
  balance: number;
  creditMeterReference: number;
  entitlements: Record<string, string>;
  hostedAIEnabled: boolean;
  klingGenerationEnabled: boolean;
  planId: BillingPlanId;
  snapshot: EntitlementSnapshot;
}

export async function getCurrentPlanId(db: AppD1Database, userId: string): Promise<BillingPlanId> {
  try {
    const row = await db
      .prepare(
        `
          SELECT plan_id
          FROM subscriptions
          WHERE user_id = ?
          ORDER BY
            CASE status
              WHEN 'active' THEN 0
              WHEN 'trialing' THEN 1
              WHEN 'past_due' THEN 2
              WHEN 'incomplete' THEN 3
              WHEN 'canceled' THEN 4
              ELSE 5
            END,
            updated_at DESC
          LIMIT 1
        `,
      )
      .bind(userId)
      .first<SubscriptionRow>();

    return normalizeBillingPlanId(row?.plan_id, 'free');
  } catch {
    return 'free';
  }
}

export async function getUserBillingSnapshot(
  db: AppD1Database,
  userId: string,
): Promise<UserBillingSnapshot> {
  const [planId, entitlementRows] = await Promise.all([
    getCurrentPlanId(db, userId),
    listEntitlements(db, userId),
  ]);

  if (planId === 'free') {
    await ensureFreePlanCredits(db, userId);
  }

  const balance = await getCreditBalance(db, userId);
  const snapshot = getEntitlementSnapshot(planId, entitlementRows);
  const creditMeterReference = await getCreditMeterReference(db, userId, {
    balance,
    monthlyCredits: snapshot.monthlyCredits,
  });

  return {
    balance,
    creditMeterReference,
    entitlements: snapshot.values,
    hostedAIEnabled: snapshot.hostedAIEnabled,
    klingGenerationEnabled: snapshot.klingGenerationEnabled,
    planId,
    snapshot,
  };
}
