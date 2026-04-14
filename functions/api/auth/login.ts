import {
  attachLoginStateCookie,
  buildAuthCallbackUrl,
  buildGoogleAuthorizationUrl,
  createMagicLinkToken,
  createLoginState,
  isLocalDevelopmentRequest,
} from '../../lib/auth';
import { sendMagicLinkEmail } from '../../lib/authProviders';
import { json, methodNotAllowed, parseJson } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

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

    return json(
      {
        delivery: message.includes('Development debug link') ? 'debug_link' : 'email_sent',
        expiresAt: state.expiresAt,
        nextStep: 'check_email',
        ok: true,
        provider,
        redirectTo: state.redirectTo,
        state: state.stateId,
        verificationUrl,
        message,
      },
      { headers, status: 202 },
    );
  } catch (error) {
    return json(
      {
        error: 'magic_link_send_failed',
        message: error instanceof Error ? error.message : 'Magic-link email delivery failed.',
      },
      { headers, status: 502 },
    );
  }
};
