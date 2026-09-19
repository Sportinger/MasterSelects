import {
  clearCookie,
  deleteLoginState,
  ensureUserRecord,
  loadLoginState,
  loadLoginStateFromRequest,
  AUTH_STATE_COOKIE_NAME,
  issueSessionCookie,
  verifyMagicLinkToken,
} from '../../lib/auth';
import { exchangeGoogleCodeForProfile } from '../../lib/authProviders';
import { json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

function wantsJsonResponse(request: Request): boolean {
  const acceptHeader = request.headers.get('Accept') ?? '';
  return acceptHeader.includes('application/json');
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  const url = new URL(context.request.url);
  const stateId = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const token = url.searchParams.get('token');

  if (providerError) {
    return json(
      {
        error: 'provider_error',
        message: 'The upstream identity provider returned an error.',
        providerError,
      },
      { status: 400 },
    );
  }

  const cookieState = await loadLoginStateFromRequest(context.request, context.env);
  const queryState = stateId ? await loadLoginState(context.env, stateId) : null;
  const pendingState = queryState ?? cookieState;

  if (!pendingState) {
    return json(
      {
        error: 'invalid_state',
        message: 'The login state is missing, expired, or already consumed.',
      },
      { status: 400 },
    );
  }

  if (cookieState && cookieState.stateId !== pendingState.stateId) {
    return json(
      {
        error: 'state_mismatch',
        message: 'The login state cookie does not match the callback state.',
      },
      { status: 400 },
    );
  }

  if (pendingState.provider === 'google') {
    // The OAuth redirect lands in the browser that started the login, so the
    // state cookie must be present and name exactly the state Google echoes
    // back. Without this binding an attacker could finish their own Google
    // login inside the victim's browser (login CSRF). Magic links may be
    // opened on another device and therefore stay cookie-less above.
    if (!cookieState || !stateId || cookieState.stateId !== stateId) {
      return json(
        {
          error: 'state_mismatch',
          message: 'The Google sign-in must be completed in the browser that started it.',
        },
        { status: 400 },
      );
    }

    if (!code) {
      return json(
        {
          error: 'missing_code',
          message: 'OAuth callbacks must include an authorization code.',
        },
        { status: 400 },
      );
    }
  }

  // Set by the provider branches below from verified material only; query
  // parameters never influence the identity that gets a session.
  let providerUserId = pendingState.email;
  let authEmail = pendingState.email;
  let avatarUrl: string | null | undefined;
  let displayName: string | null | undefined;

  if (pendingState.provider === 'google') {
    try {
      const profile = await exchangeGoogleCodeForProfile(context.env, context.request, code as string);
      providerUserId = profile.providerUserId;
      authEmail = profile.email;
      avatarUrl = profile.avatarUrl;
      displayName = profile.displayName;
    } catch (error) {
      console.error(
        '[auth] Google OAuth exchange failed',
        context.data.requestId,
        error instanceof Error ? error.message : error,
      );
      return json(
        {
          error: 'provider_exchange_failed',
          message: 'Google sign-in could not be completed. Please try again.',
          requestId: context.data.requestId ?? null,
        },
        { status: 502 },
      );
    }
  }

  if (pendingState.provider === 'magic_link') {
    const verifiedToken = await verifyMagicLinkToken(context.env, token);

    if (!verifiedToken || verifiedToken.stateId !== pendingState.stateId || verifiedToken.email !== pendingState.email) {
      return json(
        {
          error: 'invalid_token',
          message: 'The magic-link token is missing, expired, or does not match the login request.',
        },
        { status: 400 },
      );
    }

    providerUserId = verifiedToken.email;
    authEmail = verifiedToken.email;
  }

  const appVersion = context.request.headers.get('X-App-Version') ?? null;

  const user = await ensureUserRecord(context.env, {
    appVersion,
    avatarUrl,
    displayName,
    email: authEmail,
    provider: pendingState.provider,
    providerUserId,
  });

  const headers = new Headers();
  const session = await issueSessionCookie(context.env, headers, context.request, {
    email: user.email,
    plan: 'free',
    provider: pendingState.provider,
    providerUserId,
    redirectTo: pendingState.redirectTo,
    userId: user.id,
  });

  clearCookie(headers, AUTH_STATE_COOKIE_NAME, context.request);
  await deleteLoginState(context.env, pendingState.stateId);

  if (!wantsJsonResponse(context.request)) {
    const redirectUrl = new URL(pendingState.redirectTo || '/', context.request.url);
    redirectUrl.searchParams.set('auth', 'success');
    headers.set('Location', redirectUrl.toString());

    return new Response(null, {
      headers,
      status: 302,
    });
  }

  return json(
    {
      ok: true,
      nextStep: 'session_issued',
      redirectTo: pendingState.redirectTo,
      session: {
        authenticated: true,
        expiresAt: session.expiresAt,
        plan: session.plan,
        provider: session.provider,
      },
      user,
    },
    { headers, status: 200 },
  );
};
