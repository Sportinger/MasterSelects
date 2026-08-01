import { getUserBillingSnapshot } from '../../lib/billing';
import {
  insertAiAuditEvent,
  redactHostedChatPayloadForStorage,
} from '../../lib/aiAudit';
import { blocksAiRequest, moderateAiInput } from '../../lib/aiModeration';
import {
  authorizeHostedChatRound,
  cancelHostedChatTurn,
  completeHostedChatTurn,
  failHostedChatTurn,
  HostedChatBillingError,
  replayHostedChatRound,
  resolveHostedChatRoundIdentity,
  resolveHostedChatRoundTerminalAction,
  resolveHostedChatTurnAction,
  settleHostedChatRound,
} from '../../lib/chatBilling';
import { insertChatLog } from '../../lib/chatLog';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import { rejectByokCredentials } from '../../lib/noByok';
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
    capability: capabilities,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities: models,
      feature: 'hosted_ai_chat',
      modes: ['hosted'],
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

  const byokHeaderError = rejectByokCredentials({
    headers: context.request.headers,
  });
  if (byokHeaderError) {
    return byokHeaderError;
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
  const byokBodyError = rejectByokCredentials({ payload: rawBody });
  if (byokBodyError) {
    return byokBodyError;
  }
  const request = normalizeHostedKieChatRequest(rawBody);
  const turnAction = resolveHostedChatTurnAction(rawBody);
  const actionOnly = turnAction === 'cancel' || (turnAction === 'complete' && !request);
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.chat`;
  const billingIdentity = resolveHostedChatRoundIdentity(rawBody, requestId);

  if (
    (!request && !actionOnly)
    || !billingIdentity
    || (actionOnly && typeof rawBody?.billingTurnId !== 'string')
  ) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'invalid_request',
          'Expected a supported Kie.ai chat request or terminal action with a valid billing identity.',
          { requestId },
        ),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  if (request?.stream === true) {
    return buildSsePayload(requestId, 'Hosted AI chat streaming is not enabled in phase 1.');
  }

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

  if (actionOnly && turnAction) {
    try {
      const terminalTurn = turnAction === 'cancel'
        ? await cancelHostedChatTurn(
            context.env.DB,
            hostedContext.user.id,
            billingIdentity.turnId,
          )
        : await completeHostedChatTurn(
            context.env.DB,
            hostedContext.user.id,
            billingIdentity.turnId,
          );
      return json(
        buildRouteEnvelope({
          creditBalance: hostedContext.billing.balance,
          creditsCharged: 0,
          data: {
            billingTurnId: terminalTurn.id,
            terminalReason: terminalTurn.terminal_reason,
            terminalStatus: terminalTurn.status,
          },
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
      const code = error instanceof HostedChatBillingError ? error.code : 'turn_conflict';
      return json(
        buildRouteEnvelope({
          error: createGatewayError(
            code,
            error instanceof Error ? error.message : 'The hosted AI chat turn could not be closed.',
            { billingTurnId: billingIdentity.turnId, requestId },
          ),
          ok: false,
          requestId,
          status: 'error',
        }),
        { status: 409 },
      );
    }
  }

  if (!request) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('invalid_request', 'A provider request body is required.', {
          requestId,
        }),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  const moderation = await moderateAiInput(context.env, request.auditInput);
  if (blocksAiRequest(moderation)) {
    await insertAiAuditEvent(context, {
      feature: 'hosted_ai_chat',
      idempotencyKey,
      model: request.model,
      moderation,
      prompt: redactHostedChatPayloadForStorage(request.auditInput),
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

  const billingAuthorization = await authorizeHostedChatRound(context.env.DB, {
    idempotencyKey,
    model: request.model,
    protocol: request.protocol,
    roundIndex: billingIdentity.roundIndex,
    turnId: billingIdentity.turnId,
    userId: hostedContext.user.id,
  });

  if (!billingAuthorization.ok) {
    const requiresCredits = billingAuthorization.code === 'insufficient_credits';
    return json(
      buildRouteEnvelope({
        creditBalance: billingAuthorization.balance,
        error: createGatewayError(
          billingAuthorization.code,
          billingAuthorization.message,
          {
            billingRoundIndex: billingIdentity.roundIndex,
            billingTurnId: billingIdentity.turnId,
            requestId,
          },
        ),
        next: requiresCredits ? 'pricing' : undefined,
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: requiresCredits ? 'requires_billing' : 'error',
      }),
      { status: requiresCredits ? 402 : 409 },
    );
  }

  if (billingAuthorization.duplicateRound) {
    if (billingAuthorization.duplicateRound.status === 'settled') {
      try {
        const replay = await replayHostedChatRound(
          context.env.DB,
          hostedContext.user.id,
          billingAuthorization.duplicateRound,
        );
        return json(
          buildRouteEnvelope({
            creditBalance: replay.balance,
            creditsCharged: 0,
            data: replay.response,
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
      } catch {
        // Fall through to a conflict instead of repeating a settled provider call.
      }
    }

    const duplicateCode = billingAuthorization.duplicateRound.status === 'pending'
      ? 'round_in_progress'
      : 'round_already_processed';
    return json(
      buildRouteEnvelope({
        creditBalance: billingAuthorization.balance,
        error: createGatewayError(
          duplicateCode,
          duplicateCode === 'round_in_progress'
            ? 'This hosted AI chat round is already in progress.'
            : 'This hosted AI chat round was already processed and cannot be repeated.',
          {
            billingRoundIndex: billingIdentity.roundIndex,
            billingTurnId: billingIdentity.turnId,
            requestId,
          },
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
      { status: 409 },
    );
  }

  await createUsageEvent(context.env.DB, {
    creditCost: 0,
    feature: 'hosted_ai_chat',
    idempotencyKey,
    metadata: {
      billingRoundIndex: billingIdentity.roundIndex,
      billingTurnId: billingIdentity.turnId,
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
    const settlement = await settleHostedChatRound(
      context.env.DB,
      {
        fallbackRoundCredits: getModelCreditCost(request.model),
        idempotencyKey,
        model: request.model,
        payload,
        roundIndex: billingIdentity.roundIndex,
        terminalAction: resolveHostedChatRoundTerminalAction(rawBody),
        turn: billingAuthorization.turn,
        userId: hostedContext.user.id,
      },
    );

    await completeUsageEvent(context.env.DB, idempotencyKey, {
      creditCost: settlement.creditsCharged,
      ledgerEntryId: settlement.ledgerEntryId,
      status: 'completed',
    }).catch(() => {});

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

    // Human-facing logs are best-effort and redacted. Exact replay data was
    // committed atomically with billing settlement in ai_chat_turn_rounds.
    await insertChatLog(context.env.DB, {
      userId: hostedContext.user.id,
      requestId,
      idempotencyKey,
      model: request.model,
      messages: [redactHostedChatPayloadForStorage(request.auditInput)],
      response: payload,
      creditCost: settlement.creditsCharged,
      durationMs,
      status: 'completed',
    }).catch(() => {
      // Chat logging is best-effort and never blocks the response.
    });
    context.waitUntil(
      insertAiAuditEvent(context, {
        creditCost: settlement.creditsCharged,
        feature: 'hosted_ai_chat',
        idempotencyKey,
        model: request.model,
        moderation,
        prompt: redactHostedChatPayloadForStorage(request.auditInput),
        provider: 'kie.ai',
        requestId,
        status: 'completed',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

    return json(
      buildRouteEnvelope({
        creditBalance: settlement.balance,
        creditMutationId: settlement.ledgerEntryId,
        creditsCharged: settlement.creditsCharged,
        data: settlement.response,
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
    const billingError = error instanceof HostedChatBillingError ? error : null;
    const persistedErrorCode = billingError?.code ?? 'provider_request_failed';
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' }).catch(() => {});
    await failHostedChatTurn(
      context.env.DB,
      hostedContext.user.id,
      billingIdentity.turnId,
    ).catch(() => {});

    // Log failed chat attempt (non-blocking)
    context.waitUntil(
      insertChatLog(context.env.DB, {
        userId: hostedContext.user.id,
        requestId,
        idempotencyKey,
        model: request.model,
        messages: [redactHostedChatPayloadForStorage(request.auditInput)],
        response: null,
        creditCost: 0,
        durationMs,
        status: 'failed',
        errorMessage: persistedErrorCode,
      }).catch(() => {
        // Chat logging is best-effort
      }),
    );
    context.waitUntil(
      insertAiAuditEvent(context, {
        errorMessage: persistedErrorCode,
        feature: 'hosted_ai_chat',
        idempotencyKey,
        model: request.model,
        moderation,
        prompt: redactHostedChatPayloadForStorage(request.auditInput),
        provider: 'kie.ai',
        requestId,
        status: 'failed',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

    const requiresCredits = billingError?.code === 'insufficient_credits';
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          billingError?.code ?? 'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted AI chat request failed.',
          { requestId },
        ),
        next: requiresCredits ? 'pricing' : undefined,
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: requiresCredits ? 'requires_billing' : 'error',
      }),
      { status: requiresCredits ? 402 : billingError ? 409 : 502 },
    );
  }
};
