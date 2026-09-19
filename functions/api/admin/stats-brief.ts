import { requireAdminSession } from '../../lib/adminAuth';
import { getAdminDashboardSnapshot } from '../../lib/adminDashboard';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import { hasValidSocialAgentToken } from '../../lib/socialCenter';
import { createSocialStatsBrief } from '../../lib/socialStatsBrief';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);
  const adminSession = await requireAdminSession(context);
  if (!adminSession && !hasValidSocialAgentToken(context.request, context.env)) {
    return json({ error: 'unauthorized', message: 'Admin session or Social Agent token required.' }, { status: 401 });
  }

  try {
    const dashboard = await getAdminDashboardSnapshot(context);
    return json({ stats: createSocialStatsBrief(dashboard) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({
      error: 'stats_brief_unavailable',
      message: 'The aggregate operations statistics could not be loaded.',
    }, { status: 503 });
  }
};
