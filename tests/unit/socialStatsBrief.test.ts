import { describe, expect, it } from 'vitest';
import type { AdminDashboardSnapshot } from '../../functions/lib/adminDashboard';
import { createSocialStatsBrief } from '../../functions/lib/socialStatsBrief';

describe('createSocialStatsBrief', () => {
  it('keeps account, claim, deployment and session details outside the social boundary', () => {
    const dashboard = {
      claims: [{ link: 'https://secret.invalid/claim-token' }],
      cloudflare: {
        configured: true,
        d1: null,
        deployments: [{
          branch: 'main',
          commitHash: 'private-hash',
          commitMessage: 'private commit message',
          createdAt: '2026-08-26T18:00:00.000Z',
          environment: 'production',
          id: 'deployment-1',
          status: 'success',
          url: 'https://private-preview.invalid',
        }],
        error: null,
        pagesFunctions: {
          available: true,
          daily: [],
          errors7d: 3,
          requests7d: 1200,
          responseBytes7d: 4096,
          statuses: [{ count: 1197, status: 'success' }],
        },
        project: { domains: ['masterselects.com'], name: 'masterselects', productionBranch: 'main' },
        traffic: {
          available: false,
          browsers: [],
          bytes7d: 0,
          countries: [],
          daily: [],
          devices: [],
          referrers: [],
          requests7d: 0,
          source: 'none',
          statusCodes: [],
          topPaths: [],
          visits7d: 0,
        },
        visitsLastHour: { countries: [], paths: [], requests: 55, uniqueVisitors: 42 },
      },
      generatedAt: '2026-08-26T18:00:00.000Z',
      growth: { aiRequests: [], signups: [] },
      productAnalytics: {
        available: true,
        breakdowns: {
          acquisitionCampaigns: [], acquisitionContent: [], acquisitionSources: [], controls: [], editActions: [],
          editOperations: [], effectItems: [], exportKinds: [], failureCodes: [], failureStages: [], panels: [],
          surfaces: [], tutorials: [],
        },
        dailyActive14d: [],
        featureEngagement7d: [],
        funnel30d: [],
        recentActivity: [{ accountEmail: 'customer@example.com' }],
        recentSessions: [{ accountEmail: 'customer@example.com' }],
        stats: {
          activeIdentities7d: 0, appOpens7d: 0, averageEventsPerSession7d: 0, events7d: 0,
          exportSuccessRate7d: 0, exportsCompleted7d: 0, exportsFailed7d: 0, exportsStarted7d: 0,
          returningIdentities30d: 0, sessions7d: 0, signedUsers7d: 0, tutorialCompletions7d: 0,
        },
        topEvents7d: [],
      },
      recentUsers: [{ email: 'customer@example.com' }],
      stats: { registeredUsers: 790, requests24h: 27 },
      subscriptions: [{ count: 4, planId: 'starter', status: 'active' }],
    } as unknown as AdminDashboardSnapshot;

    const brief = createSocialStatsBrief(dashboard);
    const serialized = JSON.stringify(brief);

    expect(brief.stats.registeredUsers).toBe(790);
    expect(brief.cloudflare.deployments[0]).toEqual({
      branch: 'main',
      createdAt: '2026-08-26T18:00:00.000Z',
      environment: 'production',
      id: 'deployment-1',
      status: 'success',
    });
    expect(serialized).not.toContain('customer@example.com');
    expect(serialized).not.toContain('claim-token');
    expect(serialized).not.toContain('private commit message');
    expect(serialized).not.toContain('private-preview');
  });
});
