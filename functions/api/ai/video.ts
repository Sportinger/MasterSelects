import { getUserBillingSnapshot } from '../../lib/billing';
import { getCreditLedgerEntryBySource, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import {
  buildHostedKlingCapabilities,
  calculateHostedKlingCost,
  createHostedKlingTask,
  getHostedKlingTask,
  normalizeHostedKlingParams,
  type HostedVideoParams,
} from '../../lib/providers/kieai';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from '../../lib/providers/shared';
import { completeUsageEvent, createUsageEvent } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface HostedVideoRouteBody {
  action?: string;
  idempotencyKey?: string;
  params?: unknown;
  taskId?: string;
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
    kind: 'ai.video',
    mode: 'hosted',
    provider: input.provider ?? 'kling-3.0',
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
  const capabilities = buildHostedKlingCapabilities();
  const authenticated = Boolean(hostedContext.user);

  return buildRouteEnvelope({
    byoRequired: !authenticated || !hostedContext.billing?.klingGenerationEnabled,
    capability: capabilities as unknown as Record<string, unknown>,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities,
      feature: 'kling_generation',
      modes: ['hosted', 'byo'],
      pollingSupported: true,
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

function parseKlingParams(body: HostedVideoRouteBody): HostedVideoParams | null {
  if (body.params) {
    return normalizeHostedKlingParams(body.params);
  }

  return normalizeHostedKlingParams(body);
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
    const taskId = new URL(context.request.url).searchParams.get('taskId');

    if (taskId) {
      const hostedContext = await loadHostedContext(context);

      if (!hostedContext.user) {
        return json(
          buildRouteEnvelope({
            error: createGatewayError('auth_required', 'Hosted Kling task status requires a signed-in account.', {
              taskId,
            }),
            ok: false,
            requestId: context.data.requestId ?? null,
            status: 'requires_auth',
          }),
          { status: 401 },
        );
      }

      try {
        const task = await getHostedKlingTask(context.env, taskId.trim());
        return json(
          buildRouteEnvelope({
            creditBalance: hostedContext.billing?.balance ?? 0,
            data: task,
            ok: true,
            requestId: context.data.requestId ?? null,
            session: {
              authenticated: true,
              email: hostedContext.user.email,
              provider: 'cookie_session',
            },
            status: task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'error' : 'processing',
          }),
        );
      } catch (error) {
        return json(
          buildRouteEnvelope({
            error: createGatewayError(
              'provider_request_failed',
              error instanceof Error ? error.message : 'Failed to load hosted video status.',
              { taskId },
            ),
            ok: false,
            requestId: context.data.requestId ?? null,
            status: 'error',
          }),
          { status: 502 },
        );
      }
    }

    const hostedContext = await loadHostedContext(context);
    return json(buildCapabilityResponse(context, hostedContext));
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST', 'OPTIONS']);
  }

  const requestId = context.data.requestId ?? crypto.randomUUID();
  const rawBody = (await parseJson<HostedVideoRouteBody>(context.request)) ?? null;

  if (rawBody?.action === 'status' || rawBody?.taskId) {
    const taskId = typeof rawBody.taskId === 'string' ? rawBody.taskId.trim() : '';

    if (!taskId) {
      return json(
        buildRouteEnvelope({
          error: createGatewayError('invalid_task_id', 'A taskId is required.', { requestId }),
          ok: false,
          requestId,
          status: 'error',
        }),
        { status: 400 },
      );
    }

    const hostedContext = await loadHostedContext(context);

    if (!hostedContext.user) {
      return json(
        buildRouteEnvelope({
          error: createGatewayError('auth_required', 'Hosted Kling task status requires a signed-in account.', {
            requestId,
            taskId,
          }),
          ok: false,
          requestId,
          status: 'requires_auth',
        }),
        { status: 401 },
      );
    }

    try {
      const task = await getHostedKlingTask(context.env, taskId);
      return json(
        buildRouteEnvelope({
          creditBalance: hostedContext.billing?.balance ?? 0,
          data: task,
          ok: true,
          requestId,
          session: {
            authenticated: true,
            email: hostedContext.user.email,
            provider: 'cookie_session',
          },
          status: task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'error' : 'processing',
        }),
      );
    } catch (error) {
      return json(
        buildRouteEnvelope({
          error: createGatewayError(
            'provider_request_failed',
            error instanceof Error ? error.message : 'Failed to load hosted video status.',
            { requestId, taskId },
          ),
          ok: false,
          requestId,
          status: 'error',
        }),
        { status: 502 },
      );
    }
  }

  const params = rawBody ? parseKlingParams(rawBody) : null;

  if (!params) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'invalid_request',
          'Expected a prompt and duration for hosted Kling generation.',
          { requestId },
        ),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  const hostedContext = await loadHostedContext(context);

  if (!hostedContext.user) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('auth_required', 'Hosted Kling requires a signed-in account.', {
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

  if (!hostedContext.billing?.klingGenerationEnabled) {
    return json(
      buildRouteEnvelope({
        byoRequired: true,
        error: createGatewayError(
          'feature_not_enabled',
          'Kling generation is not enabled for this account.',
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

  const creditsRequired = calculateHostedKlingCost(params.mode ?? 'std', params.duration, Boolean(params.sound));
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.video`;
  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    hostedContext.user.id,
    'hosted:kling_generation',
    idempotencyKey,
  );

  if (!existingCharge && (hostedContext.billing.balance ?? 0) < creditsRequired) {
    return json(
      buildRouteEnvelope({
        creditBalance: hostedContext.billing.balance,
        error: createGatewayError(
          'insufficient_credits',
          'You need more credits to create a hosted Kling generation.',
          { requestId, creditsRequired },
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
      { status: 402 },
    );
  }

  await createUsageEvent(context.env.DB, {
    creditCost: creditsRequired,
    feature: 'kling_generation',
    idempotencyKey,
    metadata: {
      aspectRatio: params.aspectRatio,
      duration: params.duration,
      hasEndImage: Boolean(params.endImageUrl),
      hasStartImage: Boolean(params.startImageUrl),
      mode: params.mode,
      requestId,
      sound: Boolean(params.sound),
    },
    model: 'kling-3.0',
    provider: 'kieai',
    requestUnits: `${params.duration}s`,
    userId: hostedContext.user.id,
  });

  try {
    const { taskId } = await createHostedKlingTask(context.env, params);
    const charge = await spendCredits(
      context.env.DB,
      hostedContext.user.id,
      creditsRequired,
      'hosted:kling_generation',
      idempotencyKey,
      'Hosted Kling 3.0 generation',
      {
        duration: params.duration,
        mode: params.mode ?? 'std',
        provider: 'kling-3.0',
        requestId,
        sound: Boolean(params.sound),
        taskId,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
      return json(
        buildRouteEnvelope({
          creditBalance: charge.balance,
          error: createGatewayError(
            'insufficient_credits',
            'You need more credits to create a hosted Kling generation.',
            { requestId, creditsRequired },
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
        { status: 402 },
      );
    }

    await completeUsageEvent(context.env.DB, idempotencyKey, {
      ledgerEntryId: charge.entry?.id ?? null,
      status: 'completed',
    });

    return json(
      buildRouteEnvelope({
        creditBalance: charge.balance,
        creditsCharged: charge.charged ? creditsRequired : 0,
        data: {
          provider: 'kling-3.0',
          taskId,
        },
        ok: true,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user.email,
          provider: 'cookie_session',
        },
        status: 'accepted',
      }),
    );
  } catch (error) {
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted Kling generation failed.',
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
