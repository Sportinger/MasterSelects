import { requireAdminSession } from '../../lib/adminAuth';
import { getAdminDashboardSnapshot } from '../../lib/adminDashboard';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);
  const session = await requireAdminSession(context);
  if (!session) {
    return json({ error: 'unauthorized', message: 'Admin login required.' }, { status: 401 });
  }

  try {
    return json(await getAdminDashboardSnapshot(context), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({
      error: 'dashboard_unavailable',
      message: 'The live dashboard data could not be loaded.',
    }, { status: 503 });
  }
};
