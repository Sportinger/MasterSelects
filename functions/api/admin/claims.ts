import { hasAdminTrustedOrigin, hasValidAdminCsrf, requireAdminSession } from '../../lib/adminAuth';
import { createAdminCreditClaim, type CreateAdminCreditClaimInput } from '../../lib/adminCreditClaims';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') return methodNotAllowed(['POST']);
  const session = await requireAdminSession(context);
  if (!session || !hasAdminTrustedOrigin(context.request) || !hasValidAdminCsrf(context.request, session)) {
    return json({ error: 'unauthorized', message: 'Admin login required.' }, { status: 401 });
  }

  const body = await parseJson<CreateAdminCreditClaimInput>(context.request);
  if (!body) {
    return json({ error: 'invalid_request', message: 'Expected a credit-link request.' }, { status: 400 });
  }

  try {
    const claim = await createAdminCreditClaim(context.env.DB, context.request, context.env, body);
    return json({ claim }, { status: 201 });
  } catch (error) {
    return json({
      error: 'invalid_credit_claim',
      message: error instanceof Error ? error.message : 'The credit link could not be created.',
    }, { status: 400 });
  }
};
