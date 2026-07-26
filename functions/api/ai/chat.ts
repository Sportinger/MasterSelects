import { getUserBillingSnapshot } from '../../lib/billing';
import { insertAiAuditEvent } from '../../lib/aiAudit';
import { blocksAiRequest, moderateAiInput } from '../../lib/aiModeration';
import { insertChatLog } from '../../lib/chatLog';
import { getCreditLedgerEntryBySource, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import {
  getKieChatCapabilities,
  normalizeHostedKieChatRequest,
  runHostedKieChatCompletion,
} from '../../lib/providers/kieChat';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  createSseResponse,
  type HostedGatewayEnvelope,
} from '../../lib/providers/shared';
import { getModelCreditCost } from '../../lib/modelPricing';
import { completeUsageEvent, createUsageEvent } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface HostedAiContext {
  billing: Awaited<ReturnType<typeof getUserBillingSnapshot>> | null;
  user: ReturnType<typeof getCurrentUser>;
}

function buildRouteEnvelope<TData>(
  input: Omit<HostedGatewayEnvelope<TData>, 'kind' | 'mode' | 'provider' | 'requestId'> & {
    requestId: string | null;
    provider?: string;
  },
): HostedGatewayEnvelope<TData> {
  return createHostedGatewayEnvelope({
    ...input,
    kind: 'ai.chat',
    mode: 'hosted',
    provider: input.provider ?? 'kie.ai',
    requestId: input.requestId,
  });
}

function resolveHostedContext(context: AppContext): HostedAiContext {
  const user = getCurrentUser(context);

  return {
    billing: null,
    user,
  };
}

async function loadHostedContext(context: AppContext): Promise<HostedAiContext> {
  const { user } = resolveHostedContext(context);

  if (!user) {
    return {
      billing: null,
      user: null,
    };
  }

  return {
    billing: await getUserBillingSnapshot(context.env.DB, user.id),
    user,
  };
}

function buildCapabilityResponse(context: AppContext, hostedContext: HostedAiContext): HostedGatewayEnvelope<Record<string, unknown>> {
  const requestId = context.data.requestId ?? null;
  const models = getKieChatCapabilities();
  const capabilities = {
    models,
    provider: 'kie.ai',
    streamSupported: false,
  };
  const authenticated = Boolean(hostedContext.user);

  return buildRouteEnvelope({
    byoRequired: !authenticated || !hostedContext.billing?.hostedAIEnabled,
    capability: capabilities,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities: models,
      feature: 'hosted_ai_chat',
      modes: ['hosted', 'byo'],
      streamSupported: false,
    },
    ok: true,
    requestId,
    session: {
      authenticated,
      email: hostedContext.user?.email ?? null,
      provider: authenticated ? 'cookie_session' : null,
    },
    status: 'ready',
  });
}

function buildSsePayload(requestId: string | null, message: string): Response {
  return createSseResponse(
    [
      {
        data: {
          kind: 'ai.chat',
          provider: 'kie.ai',
          requestId,
          status: 'ready',
        },
        event: 'meta',
      },
      {
        data: {
          error: createGatewayError('stream_not_supported', message, {
            requestId,
            route: 'ai.chat',
          }),
          requestId,
          status: 'unsupported',
        },
        event: 'error',
      },
    ],
    { status: 501 },
  );
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
      },
      status: 204,
    });
  }

  if (context.request.method === 'GET') {
    const hostedContext = await loadHostedContext(context);
    return json(buildCapabilityResponse(context, hostedContext));
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST', 'OPTIONS']);
  }

  const requestId = context.data.requestId ?? crypto.randomUUID();
  const rawBody = (await parseJson<Record<string, unknown>>(context.request)) ?? null;
  const request = normalizeHostedKieChatRequest(rawBody);
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.chat`;

  if (!request) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'invalid_request',
          'Expected a supported Kie.ai chat model and protocol request body.',
          { requestId },
        ),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  if (request.stream === true) {
    return buildSsePayload(requestId, 'Hosted AI chat streaming is not enabled in phase 1.');
  }

  const creditCost = getModelCreditCost(request.model);
  const hostedContext = await loadHostedContext(context);

  if (!hostedContext.user) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('auth_required', 'Hosted AI chat requires a signed-in account.', {
          requestId,
        }),
        next: 'auth',
        ok: false,
        requestId,
        session: {
          authenticated: false,
          email: null,
          provider: null,
        },
        status: 'requires_auth',
      }),
      { status: 401 },
    );
  }

  if (!hostedContext.billing?.hostedAIEnabled) {
    return json(
      buildRouteEnvelope({
        byoRequired: true,
        error: createGatewayError(
          'feature_not_enabled',
          'Hosted AI chat is not enabled for this account.',
          { requestId },
        ),
        next: 'pricing',
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'requires_billing',
      }),
      { status: 403 },
    );
  }

  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    hostedContext.user.id,
    'hosted:ai_chat',
    idempotencyKey,
  );

  if (!existingCharge && (hostedContext.billing.balance ?? 0) < creditCost) {
    return json(
      buildRouteEnvelope({
        creditBalance: hostedContext.billing.balance,
        error: createGatewayError('insufficient_credits', 'You need more credits to use hosted AI chat.', {
          requestId,
        }),
        next: 'pricing',
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'requires_billing',
      }),
      { status: 402 },
    );
  }

  const moderation = await moderateAiInput(context.env, request.auditInput);
  if (blocksAiRequest(moderation)) {
    await insertAiAuditEvent(context, {
      feature: 'hosted_ai_chat',
      idempotencyKey,
      model: request.model,
      moderation,
      prompt: request.auditInput,
      provider: 'kie.ai',
      requestId,
      status: 'blocked',
      userId: hostedContext.user.id,
    });

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          moderation.status === 'error' ? 'moderation_unavailable' : 'content_policy_violation',
          moderation.status === 'error'
            ? 'Hosted AI chat moderation is unavailable. Please try again later.'
            : 'This hosted AI chat request was blocked by content safety checks.',
          { categories: moderation.categories, requestId },
        ),
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'error',
      }),
      { status: moderation.status === 'error' ? 503 : 400 },
    );
  }

  await createUsageEvent(context.env.DB, {
    creditCost: creditCost,
    feature: 'hosted_ai_chat',
    idempotencyKey,
    metadata: {
      messageCount: request.messageCount,
      model: request.model,
      requestId,
      stream: false,
    },
    model: request.model,
    provider: 'kie.ai',
    requestUnits: `${request.messageCount}`,
    userId: hostedContext.user.id,
  });

  const startTime = Date.now();

  try {
    const payload = await runHostedKieChatCompletion(context.env, request);
    const durationMs = Date.now() - startTime;
    const charge = await spendCredits(
      context.env.DB,
      hostedContext.user.id,
      creditCost,
      'hosted:ai_chat',
      idempotencyKey,
      'Hosted AI chat request',
      {
        model: request.model,
        requestId,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
      context.waitUntil(
        insertAiAuditEvent(context, {
          errorMessage: 'insufficient_credits',
          feature: 'hosted_ai_chat',
          idempotencyKey,
          model: request.model,
          moderation,
          prompt: request.auditInput,
          provider: 'kie.ai',
          requestId,
          status: 'failed',
          userId: hostedContext.user.id,
        }).catch(() => {}),
      );
      return json(
        buildRouteEnvelope({
          creditBalance: charge.balance,
          error: createGatewayError('insufficient_credits', 'You need more credits to use hosted AI chat.', {
            requestId,
          }),
          next: 'pricing',
          ok: false,
          requestId,
          session: {
            authenticated: true,
            email: hostedContext.user.email,
            provider: 'cookie_session',
          },
          status: 'requires_billing',
        }),
        { status: 402 },
      );
    }

    await completeUsageEvent(context.env.DB, idempotencyKey, {
      ledgerEntryId: charge.entry?.id ?? null,
      status: 'completed',
    });

    // Update last AI model + app version on user record (non-blocking)
    const clientAppVersion = context.request.headers.get('X-App-Version') ?? null;
    context.waitUntil(
      context.env.DB.prepare(
        `UPDATE users SET last_ai_model = ?, last_app_version = COALESCE(?, last_app_version), updated_at = ? WHERE id = ?`,
      )
        .bind(request.model, clientAppVersion, new Date().toISOString(), hostedContext.user.id)
        .run()
        .catch(() => {}),
    );

    // Log chat conversation (non-blocking)
    context.waitUntil(
      insertChatLog(context.env.DB, {
        userId: hostedContext.user.id,
        requestId,
        idempotencyKey,
        model: request.model,
        messages: [request.auditInput],
        response: payload,
        creditCost: charge.charged ? creditCost : 0,
        durationMs,
        status: 'completed',
      }).catch(() => {
        // Chat logging is best-effort — never block the response
      }),
    );
    context.waitUntil(
      insertAiAuditEvent(context, {
        creditCost: charge.charged ? creditCost : 0,
        feature: 'hosted_ai_chat',
        idempotencyKey,
        model: request.model,
        moderation,
        prompt: request.auditInput,
        provider: 'kie.ai',
        requestId,
        status: 'completed',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

    return json(
      buildRouteEnvelope({
        creditBalance: charge.balance,
        creditsCharged: charge.charged ? creditCost : 0,
        data: payload,
        ok: true,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'completed',
      }),
    );
  } catch (error) {
    const durationMs = Date.now() - startTime;
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });

    // Log failed chat attempt (non-blocking)
    context.waitUntil(
      insertChatLog(context.env.DB, {
        userId: hostedContext.user.id,
        requestId,
        idempotencyKey,
        model: request.model,
        messages: [request.auditInput],
        response: null,
        creditCost: 0,
        durationMs,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {
        // Chat logging is best-effort
      }),
    );
    context.waitUntil(
      insertAiAuditEvent(context, {
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        feature: 'hosted_ai_chat',
        idempotencyKey,
        model: request.model,
        moderation,
        prompt: request.auditInput,
        provider: 'kie.ai',
        requestId,
        status: 'failed',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted AI chat request failed.',
          { requestId },
        ),
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'error',
      }),
      { status: 502 },
    );
  }
};
