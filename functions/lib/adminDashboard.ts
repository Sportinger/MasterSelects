import { listAdminCreditClaims, type AdminCreditClaim } from './adminCreditClaims';
import { getCloudflareAdminSnapshot, type CloudflareAdminSnapshot } from './cloudflareAdmin';
import type { AppContext } from './env';

interface SummaryRow {
  active_paid_customers: number;
  active_users_30d: number;
  active_users_7d: number;
  new_users_30d: number;
  new_users_7d: number;
  total_users: number;
  trialing_customers: number;
}

interface CreditRow {
  credits_granted_30d: number;
  credits_spent_30d: number;
  outstanding_credits: number;
}

interface UsageRow {
  failed_7d: number;
  requests_24h: number;
  requests_7d: number;
  spent_7d: number;
}

interface SubscriptionBreakdownRow {
  count: number;
  plan_id: string;
  status: string;
}

interface RecentUserRow {
  balance: number;
  created_at: string;
  display_name: string;
  email: string;
  id: string;
  last_ai_model: string | null;
  last_app_version: string | null;
  last_login_at: string | null;
  plan_id: string | null;
  subscription_status: string | null;
}

interface DailyRow {
  count: number;
  day: string;
}

export interface AdminDashboardSnapshot {
  claims: AdminCreditClaim[];
  cloudflare: CloudflareAdminSnapshot;
  generatedAt: string;
  growth: {
    aiRequests: Array<{ count: number; day: string }>;
    signups: Array<{ count: number; day: string }>;
  };
  recentUsers: Array<{
    balance: number;
    createdAt: string;
    displayName: string;
    email: string;
    id: string;
    lastAiModel: string | null;
    lastAppVersion: string | null;
    lastLoginAt: string | null;
    planId: string | null;
    subscriptionStatus: string | null;
  }>;
  stats: {
    activePaidCustomers: number;
    activeUsers30d: number;
    activeUsers7d: number;
    claimedCreditLinks: number;
    conversionRate: number;
    creditsGranted30d: number;
    creditsSpent30d: number;
    estimatedMrrEur: number;
    expiredCreditLinks: number;
    failedAiRequests7d: number;
    newUsers30d: number;
    newUsers7d: number;
    openCreditAmount: number;
    openCreditLinks: number;
    outstandingCredits: number;
    requests24h: number;
    requests7d: number;
    revokedCreditLinks: number;
    totalUsers: number;
    trialingCustomers: number;
  };
  subscriptions: Array<{ count: number; planId: string; status: string }>;
}

function asNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function estimateMrr(rows: SubscriptionBreakdownRow[]): number {
  const prices: Record<string, number> = {
    pro: 14.9,
    starter: 4.9,
    studio: 29.9,
  };
  return rows
    .filter((row) => row.status === 'active')
    .reduce((sum, row) => sum + (prices[row.plan_id] ?? 0) * asNumber(row.count), 0);
}

export async function getAdminDashboardSnapshot(context: AppContext): Promise<AdminDashboardSnapshot> {
  const db = context.env.DB;
  const [
    summary,
    credits,
    usage,
    subscriptionResult,
    recentUserResult,
    signupResult,
    requestResult,
    claims,
    cloudflare,
  ] = await Promise.all([
    db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM users) AS total_users,
         (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-7 days')) AS new_users_7d,
         (SELECT COUNT(*) FROM users WHERE created_at >= datetime('now', '-30 days')) AS new_users_30d,
         (SELECT COUNT(*) FROM users WHERE last_login_at >= datetime('now', '-7 days')) AS active_users_7d,
         (SELECT COUNT(*) FROM users WHERE last_login_at >= datetime('now', '-30 days')) AS active_users_30d,
         (SELECT COUNT(DISTINCT user_id) FROM subscriptions
          WHERE status = 'active' AND plan_id != 'free') AS active_paid_customers,
         (SELECT COUNT(DISTINCT user_id) FROM subscriptions
          WHERE status = 'trialing' AND plan_id != 'free') AS trialing_customers`,
    ).first<SummaryRow>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(amount), 0) AS outstanding_credits,
         COALESCE(SUM(CASE
           WHEN amount > 0 AND created_at >= datetime('now', '-30 days') THEN amount
           ELSE 0
         END), 0) AS credits_granted_30d,
         ABS(COALESCE(SUM(CASE
           WHEN amount < 0 AND created_at >= datetime('now', '-30 days') THEN amount
           ELSE 0
         END), 0)) AS credits_spent_30d
       FROM credit_ledger`,
    ).first<CreditRow>(),
    db.prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-1 day') THEN 1 ELSE 0 END), 0) AS requests_24h,
         COALESCE(SUM(CASE WHEN created_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS requests_7d,
         COALESCE(SUM(CASE
           WHEN created_at >= datetime('now', '-7 days') AND status = 'failed' THEN 1
           ELSE 0
         END), 0) AS failed_7d,
         COALESCE(SUM(CASE
           WHEN created_at >= datetime('now', '-7 days') THEN credit_cost
           ELSE 0
         END), 0) AS spent_7d
       FROM usage_events`,
    ).first<UsageRow>(),
    db.prepare(
      `SELECT plan_id, status, COUNT(DISTINCT user_id) AS count
       FROM subscriptions
       GROUP BY plan_id, status
       ORDER BY count DESC, plan_id ASC`,
    ).all<SubscriptionBreakdownRow>(),
    db.prepare(
      `SELECT
         u.id,
         u.email,
         u.display_name,
         u.created_at,
         u.last_login_at,
         u.last_app_version,
         u.last_ai_model,
         COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = u.id), 0) AS balance,
         (SELECT plan_id FROM subscriptions
          WHERE user_id = u.id ORDER BY updated_at DESC LIMIT 1) AS plan_id,
         (SELECT status FROM subscriptions
          WHERE user_id = u.id ORDER BY updated_at DESC LIMIT 1) AS subscription_status
       FROM users u
       ORDER BY u.created_at DESC
       LIMIT 12`,
    ).all<RecentUserRow>(),
    db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM users
       WHERE created_at >= datetime('now', '-14 days')
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day ASC`,
    ).all<DailyRow>(),
    db.prepare(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS count
       FROM usage_events
       WHERE created_at >= datetime('now', '-14 days')
       GROUP BY substr(created_at, 1, 10)
       ORDER BY day ASC`,
    ).all<DailyRow>(),
    listAdminCreditClaims(db, context.request, context.env),
    getCloudflareAdminSnapshot(context.env),
  ]);

  const totalUsers = asNumber(summary?.total_users);
  const activePaidCustomers = asNumber(summary?.active_paid_customers);
  const openClaims = claims.filter((claim) => claim.status === 'available');
  const subscriptions = subscriptionResult.results.map((row) => ({
    count: asNumber(row.count),
    planId: row.plan_id,
    status: row.status,
  }));

  return {
    claims,
    cloudflare,
    generatedAt: new Date().toISOString(),
    growth: {
      aiRequests: requestResult.results.map((row) => ({ count: asNumber(row.count), day: row.day })),
      signups: signupResult.results.map((row) => ({ count: asNumber(row.count), day: row.day })),
    },
    recentUsers: recentUserResult.results.map((row) => ({
      balance: asNumber(row.balance),
      createdAt: row.created_at,
      displayName: row.display_name,
      email: row.email,
      id: row.id,
      lastAiModel: row.last_ai_model,
      lastAppVersion: row.last_app_version,
      lastLoginAt: row.last_login_at,
      planId: row.plan_id,
      subscriptionStatus: row.subscription_status,
    })),
    stats: {
      activePaidCustomers,
      activeUsers30d: asNumber(summary?.active_users_30d),
      activeUsers7d: asNumber(summary?.active_users_7d),
      claimedCreditLinks: claims.filter((claim) => claim.status === 'claimed').length,
      conversionRate: totalUsers > 0 ? activePaidCustomers / totalUsers : 0,
      creditsGranted30d: asNumber(credits?.credits_granted_30d),
      creditsSpent30d: asNumber(credits?.credits_spent_30d),
      estimatedMrrEur: estimateMrr(subscriptionResult.results),
      expiredCreditLinks: claims.filter((claim) => claim.status === 'expired').length,
      failedAiRequests7d: asNumber(usage?.failed_7d),
      newUsers30d: asNumber(summary?.new_users_30d),
      newUsers7d: asNumber(summary?.new_users_7d),
      openCreditAmount: openClaims.reduce((sum, claim) => sum + claim.amount, 0),
      openCreditLinks: openClaims.length,
      outstandingCredits: asNumber(credits?.outstanding_credits),
      requests24h: asNumber(usage?.requests_24h),
      requests7d: asNumber(usage?.requests_7d),
      revokedCreditLinks: claims.filter((claim) => claim.status === 'revoked').length,
      totalUsers,
      trialingCustomers: asNumber(summary?.trialing_customers),
    },
    subscriptions,
  };
}
