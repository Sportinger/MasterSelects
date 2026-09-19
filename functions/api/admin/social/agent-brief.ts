import { requireAdminSession } from '../../../lib/adminAuth';
import { json, methodNotAllowed } from '../../../lib/db';
import type { AppContext, AppRouteHandler } from '../../../lib/env';
import { getSocialCenterSnapshot, hasValidSocialAgentToken } from '../../../lib/socialCenter';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') return methodNotAllowed(['GET']);
  const adminSession = await requireAdminSession(context);
  if (!adminSession && !hasValidSocialAgentToken(context.request, context.env)) {
    return json({ error: 'unauthorized', message: 'Admin session or Social Agent token required.' }, { status: 401 });
  }

  try {
    return json({ brief: await getSocialCenterSnapshot(context.env.DB, context.env) }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({
      error: 'social_brief_unavailable',
      message: 'The Social Agent brief could not be loaded.',
    }, { status: 503 });
  }
};
