import { hasAdminTrustedOrigin, hasValidAdminCsrf, requireAdminSession } from '../../lib/adminAuth';
import {
  AdminCreditClaimInputError,
  createAdminCreditClaim,
  type CreateAdminCreditClaimInput,
} from '../../lib/adminCreditClaims';
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
    const requestId = context.data.requestId ?? null;
    if (error instanceof AdminCreditClaimInputError) {
      return json({ error: 'invalid_credit_claim', message: error.message, requestId }, { status: 400 });
    }
    console.error('[admin] credit link creation failed', requestId, error instanceof Error ? error.message : error);
    return json({
      error: 'credit_claim_failed',
      message: 'The credit link could not be created.',
      requestId,
    }, { status: 500 });
  }
};
