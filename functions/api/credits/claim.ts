import {
  getCreditClaimByToken,
  redeemCreditClaim,
  toCreditClaimPublicStatus,
} from '../../lib/creditClaims';
import { getCurrentUser, hasTrustedOrigin, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface ClaimBody {
  code?: string;
  email?: string;
  token?: string;
}

function getQueryCode(request: Request): string {
  const url = new URL(request.url);
  return url.searchParams.get('code') ?? url.searchParams.get('token') ?? '';
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  const method = context.request.method;

  if (method !== 'GET' && method !== 'POST') {
    return methodNotAllowed(['GET', 'POST']);
  }

  if (method === 'GET') {
    const claim = await getCreditClaimByToken(context.env.DB, getQueryCode(context.request));
    if (!claim) {
      return json(
        {
          error: 'claim_not_found',
          message: 'This credit claim link is invalid or no longer exists.',
          ok: false,
        },
        { status: 404 },
      );
    }

    return json({
      claim: toCreditClaimPublicStatus(claim, getCurrentUser(context)),
      ok: true,
      session: {
        authenticated: Boolean(getCurrentUser(context)),
        email: getCurrentUser(context)?.email ?? null,
      },
    });
  }

  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'untrusted_origin',
        message: 'Credit claim requests must come from the MasterSelects origin.',
        ok: false,
      },
      { status: 403 },
    );
  }

  const body = await parseJson<ClaimBody>(context.request);
  if (!body) {
    return json(
      {
        error: 'invalid_json',
        message: 'Expected a JSON body with a claim code and email address.',
        ok: false,
      },
      { status: 400 },
    );
  }

  const currentUser = getCurrentUser(context);
  if (!currentUser) {
    return json(
      {
        error: 'auth_required',
        message: 'Sign in with the claim email before redeeming this credit link.',
        next: 'auth',
        ok: false,
      },
      { status: 401 },
    );
  }

  const claim = await getCreditClaimByToken(context.env.DB, body.code ?? body.token);
  if (!claim) {
    return json(
      {
        error: 'claim_not_found',
        message: 'This credit claim link is invalid or no longer exists.',
        ok: false,
      },
      { status: 404 },
    );
  }

  const result = await redeemCreditClaim(context.env.DB, claim, currentUser, body.email);
  if (!result.ok) {
    const status = result.error === 'email_mismatch'
      ? 403
      : result.error === 'already_claimed'
        ? 409
        : result.error === 'write_failed'
          ? 500
          : 410;

    return json(
      {
        ...result,
        message: result.error === 'email_mismatch'
          ? 'The signed-in account does not match this claim.'
          : result.error === 'already_claimed'
            ? 'This credit claim was already redeemed.'
            : result.error === 'write_failed'
              ? 'The claim could not be written. Try again shortly.'
              : 'This credit claim is no longer redeemable.',
      },
      { status },
    );
  }

  return json(
    {
      ...result,
      message: `${result.amount} credits have been added to your MasterSelects account.`,
    },
    {
      headers: {
        'X-MasterSelects-Credit-Balance': String(result.creditBalance),
      },
    },
  );
};
