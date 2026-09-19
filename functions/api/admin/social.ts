import {
  hasAdminTrustedOrigin,
  hasValidAdminCsrf,
  requireAdminSession,
} from '../../lib/adminAuth';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  getSocialCenterSnapshot,
  type SocialCenterUpdate,
  updateSocialCenter,
} from '../../lib/socialCenter';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (!['GET', 'PATCH'].includes(context.request.method)) return methodNotAllowed(['GET', 'PATCH']);
  const session = await requireAdminSession(context);
  if (!session) {
    return json({ error: 'unauthorized', message: 'Admin login required.' }, { status: 401 });
  }

  if (context.request.method === 'PATCH') {
    if (!hasAdminTrustedOrigin(context.request) || !hasValidAdminCsrf(context.request, session)) {
      return json({ error: 'unauthorized', message: 'Admin login required.' }, { status: 401 });
    }
    const body = await parseJson<SocialCenterUpdate>(context.request);
    if (!body) {
      return json({ error: 'invalid_request', message: 'Expected a Social Center update.' }, { status: 400 });
    }
    try {
      await updateSocialCenter(context.env.DB, body);
    } catch (error) {
      return json({
        error: 'invalid_social_update',
        message: error instanceof Error ? error.message : 'The Social Center update was rejected.',
      }, { status: 400 });
    }
  }

  try {
    return json(await getSocialCenterSnapshot(context.env.DB, context.env), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return json({
      error: 'social_center_unavailable',
      message: 'The Social Center data could not be loaded.',
    }, { status: 503 });
  }
};
