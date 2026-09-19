import { clearCookie, loadSessionFromRequest, readCookie, SESSION_COOKIE_NAME } from '../lib/auth';
import { getUserBillingSnapshot } from '../lib/billing';
import { getAiUser, isGuestAiUser, json, methodNotAllowed } from '../lib/db';
import type { AppContext, AppRouteHandler } from '../lib/env';

interface UserProfileRow {
  avatar_url: string | null;
  display_name: string | null;
  email: string;
  id: string;
  last_ai_model: string | null;
  last_app_version: string | null;
  last_login_at: string | null;
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method !== 'GET') {
    return methodNotAllowed(['GET']);
  }

  const headers = new Headers();
  const session = await loadSessionFromRequest(context.request, context.env);
  const hasSessionCookie = Boolean(readCookie(context.request, SESSION_COOKIE_NAME));

  if (!session && hasSessionCookie) {
    clearCookie(headers, SESSION_COOKIE_NAME, context.request);
  }

  const responseInit = headers.has('Set-Cookie') ? { headers } : undefined;
  const currentUser = context.data.user;
  const aiUser = getAiUser(context);

  if (!session || !currentUser) {
    if (aiUser && isGuestAiUser(context)) {
      const billing = await getUserBillingSnapshot(context.env.DB, aiUser.id, { guest: true });
      return json(
        {
          billing: {
            klingGenerationEnabled: billing.klingGenerationEnabled,
            label: 'Free',
            monthlyCredits: 0,
          },
          creditBalance: billing.balance,
          creditMeterReference: Math.max(400, billing.creditMeterReference),
          entitlements: billing.entitlements,
          hostedAIEnabled: billing.hostedAIEnabled,
          plan: 'free',
          session: {
            authenticated: false,
            guest: true,
          },
          user: null,
        },
        responseInit,
      );
    }
    return json(
      {
        billing: {
          klingGenerationEnabled: false,
          label: 'Free',
          monthlyCredits: 0,
        },
        creditBalance: 0,
        creditMeterReference: 0,
        entitlements: {},
        hostedAIEnabled: false,
        plan: 'free',
        session: {
          authenticated: false,
          guest: false,
        },
        user: null,
      },
      responseInit,
    );
  }

  const [billing, userRow] = await Promise.all([
    getUserBillingSnapshot(context.env.DB, currentUser.id),
    context.env.DB
      .prepare(
        `
          SELECT id, email, display_name, avatar_url, last_app_version, last_ai_model, last_login_at
          FROM users
          WHERE id = ?
          LIMIT 1
        `,
      )
      .bind(currentUser.id)
      .first<UserProfileRow>()
      .catch(() => null),
  ]);

  return json(
    {
      billing: {
        klingGenerationEnabled: billing.klingGenerationEnabled,
        label: billing.snapshot.plan.label,
        monthlyCredits: billing.snapshot.monthlyCredits,
      },
      creditBalance: billing.balance,
      creditMeterReference: billing.creditMeterReference,
      entitlements: billing.entitlements,
      hostedAIEnabled: billing.hostedAIEnabled,
      plan: billing.planId,
      session: {
        authenticated: true,
        expiresAt: session.expiresAt,
        provider: session.provider,
      },
      user: {
        avatarUrl: userRow?.avatar_url ?? null,
        displayName: userRow?.display_name?.trim() || session.email,
        email: userRow?.email ?? session.email,
        id: userRow?.id ?? session.userId,
        lastAiModel: userRow?.last_ai_model ?? null,
        lastAppVersion: userRow?.last_app_version ?? null,
        lastLoginAt: userRow?.last_login_at ?? null,
      },
    },
    responseInit,
  );
};
