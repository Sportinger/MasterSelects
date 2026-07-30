import {
  hasAdminTrustedOrigin,
  hasValidAdminCsrf,
  requireAdminSession,
} from '../../../../lib/adminAuth';
import { rotateAdminCreditClaimLink } from '../../../../lib/adminCreditClaims';
import { json, methodNotAllowed } from '../../../../lib/db';
import type { AppContext, AppRouteHandler } from '../../../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  const session = await requireAdminSession(context);
  if (!session || !hasAdminTrustedOrigin(context.request) || !hasValidAdminCsrf(context.request, session)) {
    return json({ error: 'unauthorized', message: 'Admin login required.' }, { status: 401 });
  }

  const claimId = context.params.id?.trim();
  if (!claimId) {
    return json({ error: 'invalid_request', message: 'Credit link id is missing.' }, { status: 400 });
  }

  try {
    const claim = await rotateAdminCreditClaimLink(
      context.env.DB,
      context.request,
      context.env,
      claimId,
    );
    return json({ claim });
  } catch (error) {
    return json({
      error: 'credit_link_not_rotated',
      message: error instanceof Error ? error.message : 'The credit link could not be renewed.',
    }, { status: 409 });
  }
};
