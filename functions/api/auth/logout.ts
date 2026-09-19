import { clearAuthCookies, revokeSessionFromRequest } from '../../lib/auth';
import { hasTrustedOrigin, json, methodNotAllowed } from '../../lib/db';
import type { AppContext, AppRouteHandler } from '../../lib/env';

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'POST') {
    return methodNotAllowed(['POST']);
  }

  if (!hasTrustedOrigin(context.request)) {
    return json(
      {
        error: 'forbidden_origin',
        message: 'Sign-out requests must originate from the same site.',
      },
      { status: 403 },
    );
  }

  const headers = new Headers();
  const session = await revokeSessionFromRequest(context.request, context.env);

  await clearAuthCookies(headers, context.request);

  return json(
    {
      ok: true,
      signedOut: true,
      sessionCleared: Boolean(session),
      user: session
        ? {
            email: session.email,
            id: session.userId,
          }
        : null,
    },
    { headers, status: 200 },
  );
};
