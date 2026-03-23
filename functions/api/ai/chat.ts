import { getUserBillingSnapshot } from '../../lib/billing';
import { insertChatLog } from '../../lib/chatLog';
import { getCreditLedgerEntryBySource, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import {
  buildHostedChatCapabilities,
  normalizeHostedChatRequest,
  runHostedChatCompletion,
  type HostedChatRequest,
} from '../../lib/providers/openai';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  createSseResponse,
  type HostedGatewayEnvelope,
} from '../../lib/providers/shared';
import { getModelCreditCost } from '../../lib/modelPricing';
import { completeUsageEvent, createUsageEvent } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface HostedChatRouteBody {
  idempotencyKey?: string;
  messages?: unknown;
  model?: string;
  stream?: boolean;
}

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
    provider: input.provider ?? 'openai',
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
  const capabilities = buildHostedChatCapabilities();
  const authenticated = Boolean(hostedContext.user);

  return buildRouteEnvelope({
    byoRequired: !authenticated || !hostedContext.billing?.hostedAIEnabled,
    capability: capabilities as unknown as Record<string, unknown>,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities,
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
          provider: 'openai',
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
  const rawBody = (await parseJson<HostedChatRouteBody>(context.request)) ?? null;
  const request = normalizeHostedChatRequest(rawBody);
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.chat`;

  if (!request) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'invalid_request',
          'Expected a JSON body with a messages array.',
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
  const providerBody: HostedChatRequest = {
    max_completion_tokens: request.max_completion_tokens,
    max_tokens: request.max_tokens,
    messages: request.messages,
    model: request.model,
    response_format: request.response_format,
    stream: false,
    tool_choice: request.tool_choice,
    tools: request.tools,
    temperature: request.temperature,
    top_p: request.top_p,
  };

  await createUsageEvent(context.env.DB, {
    creditCost: creditCost,
    feature: 'hosted_ai_chat',
    idempotencyKey,
    metadata: {
      messageCount: request.messages.length,
      model: request.model,
      requestId,
      stream: false,
    },
    model: request.model,
    provider: 'openai',
    requestUnits: `${request.messages.length}`,
    userId: hostedContext.user.id,
  });

  const startTime = Date.now();

  try {
    const payload = await runHostedChatCompletion(context.env, providerBody);
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
        messages: request.messages,
        response: payload,
        creditCost: charge.charged ? creditCost : 0,
        durationMs,
        status: 'completed',
      }).catch(() => {
        // Chat logging is best-effort — never block the response
      }),
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
        messages: request.messages,
        response: null,
        creditCost: 0,
        durationMs,
        status: 'failed',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {
        // Chat logging is best-effort
      }),
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
