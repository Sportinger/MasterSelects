import {
  attachLoginStateCookie,
  buildAuthCallbackUrl,
  buildGoogleAuthorizationUrl,
  createMagicLinkToken,
  createLoginState,
  isLocalDevelopmentRequest,
} from '../../lib/auth';
import { sendMagicLinkEmail } from '../../lib/authProviders';
import { hasSameOriginHeader, json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIp,
  rateLimitedResponse,
  type RateLimitPolicy,
} from '../../lib/rateLimit';

/** Login bootstraps one client address may start per window. */
export const LOGIN_IP_RATE_LIMIT: RateLimitPolicy = { limit: 15, windowSeconds: 15 * 60 };
/** Magic-link emails one address may request per window. */
export const LOGIN_EMAIL_RATE_LIMIT: RateLimitPolicy = { limit: 5, windowSeconds: 15 * 60 };

interface LoginBody {
  email?: string;
  provider?: string;
  redirectTo?: string;
}

function normalizeProvider(provider?: string): 'google' | 'magic_link' {
  const candidate = (provider ?? 'magic_link').trim().toLowerCase();

  if (candidate === 'google') {
    return 'google';
  }

  return 'magic_link';
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  // Login starts a credential flow (a magic-link email or an OAuth state), so
  // only first-party pages may trigger it: the Origin header is mandatory.
  if (!hasSameOriginHeader(context.request)) {
    return json(
      {
        error: 'forbidden_origin',
        message: 'Sign-in requests must be sent from the MasterSelects site.',
      },
      { status: 403 },
    );
  }

  const clientIp = getClientIp(context.request);
  if (clientIp) {
    const ipBudget = await consumeRateLimit(
      context.env.KV,
      await buildRateLimitKey('auth-login:ip', clientIp, context.env.SESSION_SECRET),
      LOGIN_IP_RATE_LIMIT,
    );
    if (!ipBudget.allowed) {
      return rateLimitedResponse(ipBudget);
    }
  }

  const body = await parseJson<LoginBody>(context.request);

  if (!body) {
    return json(
      {
        error: 'invalid_json',
        message: 'Expected a JSON body with an email address and optional provider.',
      },
      { status: 400 },
    );
  }

  const provider = normalizeProvider(body.provider);
  const email = body.email?.trim().toLowerCase() ?? '';

  if (provider === 'magic_link' && (!email || !email.includes('@'))) {
    return json(
      {
        error: 'invalid_email',
        message: 'A valid email address is required for the login bootstrap flow.',
      },
      { status: 422 },
    );
  }

  if (provider === 'magic_link') {
    const emailBudget = await consumeRateLimit(
      context.env.KV,
      await buildRateLimitKey('auth-login:email', email, context.env.SESSION_SECRET),
      LOGIN_EMAIL_RATE_LIMIT,
    );
    if (!emailBudget.allowed) {
      return rateLimitedResponse(emailBudget);
    }
  }

  const state = await createLoginState(context.env, context.request, {
    email,
    provider,
    redirectTo: body.redirectTo,
  });
  const headers = new Headers();

  await attachLoginStateCookie(context.env, headers, context.request, state.stateId);

  if (provider === 'google') {
    if (!context.env.GOOGLE_CLIENT_ID) {
      return json(
        {
          error: 'provider_not_configured',
          message: 'Google OAuth is not configured on this deployment yet.',
          provider,
          state: state.stateId,
        },
        { headers, status: 503 },
      );
    }

    return json(
      {
        authorizationUrl: buildGoogleAuthorizationUrl({
          clientId: context.env.GOOGLE_CLIENT_ID,
          redirectUri: new URL('/api/auth/callback', context.request.url).toString(),
          state: state.stateId,
        }),
        expiresAt: state.expiresAt,
        nextStep: 'redirect_to_provider',
        ok: true,
        provider,
        redirectTo: state.redirectTo,
        state: state.stateId,
      },
      { headers, status: 202 },
    );
  }

  try {
    const token = await createMagicLinkToken(context.env, {
      email,
      expiresAt: state.expiresAt,
      stateId: state.stateId,
    });
    const verificationUrl = buildAuthCallbackUrl(context.request, state.stateId, token);
    let message = 'Magic link sent. Check your inbox.';

    if (context.env.RESEND_API_KEY && context.env.AUTH_EMAIL_FROM) {
      await sendMagicLinkEmail(context.env, {
        callbackUrl: verificationUrl,
        email,
        expiresAt: state.expiresAt,
      });
    } else if (isLocalDevelopmentRequest(context.request, context.env)) {
      message = 'Magic link email provider is not configured. Development debug link returned.';
    } else {
      return json(
        {
          error: 'provider_not_configured',
          message: 'Magic-link email delivery is not configured on this deployment yet.',
          provider,
          state: state.stateId,
        },
        { headers, status: 503 },
      );
    }

    const debugLink = message.includes('Development debug link');

    // The signed callback URL is the credential itself. It only ever leaves
    // the server inside the email; the loopback development fallback is the
    // sole case where the caller may receive it directly.
    return json(
      {
        delivery: debugLink ? 'debug_link' : 'email_sent',
        expiresAt: state.expiresAt,
        nextStep: 'check_email',
        ok: true,
        provider,
        redirectTo: state.redirectTo,
        state: state.stateId,
        ...(debugLink ? { verificationUrl } : {}),
        message,
      },
      { headers, status: 202 },
    );
  } catch (error) {
    console.error(
      '[auth] magic-link delivery failed',
      context.data.requestId,
      error instanceof Error ? error.message : error,
    );
    return json(
      {
        error: 'magic_link_send_failed',
        message: 'The sign-in email could not be sent. Please try again in a moment.',
        requestId: context.data.requestId ?? null,
      },
      { headers, status: 502 },
    );
  }
};
