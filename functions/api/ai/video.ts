import { getUserBillingSnapshot } from '../../lib/billing';
import { getCreditLedgerEntryBySource, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import {
  buildHostedKlingCapabilities,
  calculateHostedImageCost,
  calculateHostedKlingCost,
  createHostedImageTask,
  createHostedKlingTask,
  getHostedKlingTask,
  normalizeHostedImageParams,
  normalizeHostedKlingParams,
  type HostedImageParams,
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

interface HostedGenerationConfig {
  creditsRequired: number;
  description: string;
  feature: string;
  ledgerSource: string;
  model: string;
  outputType: 'image' | 'video';
  params: HostedImageParams | HostedVideoParams;
  provider: string;
  requestUnits: string | null;
  usageMetadata: Record<string, unknown>;
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
    byoRequired: !authenticated,
    capability: capabilities as unknown as Record<string, unknown>,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities,
      feature: 'hosted_media_generation',
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

function parseHostedGeneration(body: HostedVideoRouteBody, requestId: string): HostedGenerationConfig | null {
  const paramsInput = body.params ?? body;
  const imageParams = normalizeHostedImageParams(paramsInput);

  if (imageParams) {
    return {
      creditsRequired: calculateHostedImageCost(imageParams.provider, imageParams.resolution),
      description: 'Hosted Nano Banana 2 generation',
      feature: 'nano_banana_generation',
      ledgerSource: `hosted:${imageParams.provider}`,
      model: imageParams.provider,
      outputType: 'image',
      params: imageParams,
      provider: imageParams.provider,
      requestUnits: imageParams.resolution ?? '1K',
      usageMetadata: {
        aspectRatio: imageParams.aspectRatio,
        outputFormat: imageParams.outputFormat ?? 'png',
        provider: imageParams.provider,
        referenceCount: imageParams.imageInputs?.length ?? 0,
        requestId,
        resolution: imageParams.resolution ?? '1K',
      },
    };
  }

  const videoParams = normalizeHostedKlingParams(paramsInput);
  if (!videoParams) {
    return null;
  }

  return {
    creditsRequired: calculateHostedKlingCost(
      videoParams.mode ?? 'std',
      videoParams.duration,
      Boolean(videoParams.sound),
      Boolean(videoParams.multiShots),
    ),
    description: 'Hosted Kling 3.0 generation',
    feature: 'kling_generation',
    ledgerSource: 'hosted:kling_generation',
    model: 'kling-3.0',
    outputType: 'video',
    params: videoParams,
    provider: 'kling-3.0',
    requestUnits: `${videoParams.duration}s`,
    usageMetadata: {
      aspectRatio: videoParams.aspectRatio,
      duration: videoParams.duration,
      hasEndImage: Boolean(videoParams.endImageUrl),
      hasStartImage: Boolean(videoParams.startImageUrl),
      mode: videoParams.mode,
      multiShots: Boolean(videoParams.multiShots),
      requestId,
      shotCount: videoParams.multiPrompt?.length ?? 0,
      sound: videoParams.multiShots ? true : Boolean(videoParams.sound),
    },
  };
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
            error: createGatewayError('auth_required', 'Hosted AI task status requires a signed-in account.', {
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
              error instanceof Error ? error.message : 'Failed to load hosted AI task status.',
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
          error: createGatewayError('auth_required', 'Hosted AI task status requires a signed-in account.', {
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
            error instanceof Error ? error.message : 'Failed to load hosted AI task status.',
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

  const generation = rawBody ? parseHostedGeneration(rawBody, requestId) : null;

  if (!generation) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'invalid_request',
          'Expected valid hosted generation parameters.',
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
        error: createGatewayError('auth_required', 'Hosted AI generation requires a signed-in account.', {
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

  const { creditsRequired } = generation;
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.video`;
  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    hostedContext.user.id,
    generation.ledgerSource,
    idempotencyKey,
  );

  if (!existingCharge && (hostedContext.billing?.balance ?? 0) < creditsRequired) {
    return json(
      buildRouteEnvelope({
        creditBalance: hostedContext.billing?.balance ?? 0,
        error: createGatewayError(
          'insufficient_credits',
          'You need more credits to create this hosted generation.',
          { creditsRequired, outputType: generation.outputType, requestId },
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
    feature: generation.feature,
    idempotencyKey,
    metadata: generation.usageMetadata,
    model: generation.model,
    provider: generation.provider,
    requestUnits: generation.requestUnits,
    userId: hostedContext.user.id,
  });

  try {
    const { taskId } = generation.outputType === 'image'
      ? await createHostedImageTask(context.env, generation.params as HostedImageParams)
      : await createHostedKlingTask(context.env, generation.params as HostedVideoParams);
    const charge = await spendCredits(
      context.env.DB,
      hostedContext.user.id,
      creditsRequired,
      generation.ledgerSource,
      idempotencyKey,
      generation.description,
      {
        ...generation.usageMetadata,
        outputType: generation.outputType,
        provider: generation.provider,
        requestId,
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
            'You need more credits to create this hosted generation.',
            { creditsRequired, outputType: generation.outputType, requestId },
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
          outputType: generation.outputType,
          provider: generation.provider,
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
          error instanceof Error ? error.message : 'Hosted AI generation failed.',
          { outputType: generation.outputType, requestId },
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
