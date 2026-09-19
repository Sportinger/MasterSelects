import type { AdminDashboardSnapshot } from './adminDashboard';

/**
 * Read-only, aggregate-only dashboard data for the private Social Operations
 * service. Keep account records, claim links and per-session analytics out of
 * this boundary.
 */
export function createSocialStatsBrief(snapshot: AdminDashboardSnapshot) {
  const { cloudflare, productAnalytics } = snapshot;

  return {
    schemaVersion: 1 as const,
    generatedAt: snapshot.generatedAt,
    stats: snapshot.stats,
    growth: snapshot.growth,
    subscriptions: snapshot.subscriptions,
    cloudflare: {
      configured: cloudflare.configured,
      d1: cloudflare.d1,
      deployments: cloudflare.deployments.map((deployment) => ({
        branch: deployment.branch,
        createdAt: deployment.createdAt,
        environment: deployment.environment,
        id: deployment.id,
        status: deployment.status,
      })),
      error: cloudflare.error,
      pagesFunctions: cloudflare.pagesFunctions,
      project: cloudflare.project,
      traffic: cloudflare.traffic,
      visitsLastHour: cloudflare.visitsLastHour,
    },
    diagnostics: snapshot.diagnostics,
    productAnalytics: {
      available: productAnalytics.available,
      exportRuns7d: productAnalytics.exportRuns7d,
      breakdowns: {
        acquisitionSources: productAnalytics.breakdowns.acquisitionSources,
        editActions: productAnalytics.breakdowns.editActions,
        effectItems: productAnalytics.breakdowns.effectItems,
        exportKinds: productAnalytics.breakdowns.exportKinds,
        panels: productAnalytics.breakdowns.panels,
      },
      dailyActive14d: productAnalytics.dailyActive14d,
      funnel30d: productAnalytics.funnel30d,
      stats: productAnalytics.stats,
      topEvents7d: productAnalytics.topEvents7d,
    },
  };
}

export type SocialStatsBrief = ReturnType<typeof createSocialStatsBrief>;
