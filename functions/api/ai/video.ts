import { getUserBillingSnapshot } from '../../lib/billing';
import { insertAiAuditEvent } from '../../lib/aiAudit';
import { blocksAiRequest, moderateAiInput } from '../../lib/aiModeration';
import { getCreditLedgerEntryBySource, refundCreditsForFailedTask, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import {
  buildHostedKlingCapabilities,
  calculateHostedImageCost,
  calculateHostedKlingCost,
  calculateHostedSeedanceCost,
  createHostedImageTask,
  createHostedKlingTask,
  createHostedSeedanceTask,
  getHostedKlingTask,
  normalizeHostedImageParams,
  normalizeHostedKlingParams,
  normalizeHostedSeedanceParams,
  normalizeHostedSpecialVideoParams,
  type HostedImageParams,
  type HostedVideoParams,
  type HostedVideoTask,
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

function getHostedTaskMediaUrl(task: HostedVideoTask): string | null {
  const rawUrl = task.videoUrl ?? task.imageUrl;
  if (typeof rawUrl !== 'string' || rawUrl.trim().length === 0) {
    return null;
  }

  try {
    const url = new URL(rawUrl.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

async function streamHostedTaskMedia(context: AppContext, taskId: string, task: HostedVideoTask): Promise<Response> {
  const requestId = context.data.requestId ?? null;

  if (task.status !== 'completed') {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('task_not_completed', 'Hosted AI result is not ready yet.', {
          taskId,
          taskStatus: task.status,
        }),
        ok: false,
        requestId,
        status: task.status === 'failed' ? 'error' : 'processing',
      }),
      { status: 409 },
    );
  }

  const mediaUrl = getHostedTaskMediaUrl(task);
  if (!mediaUrl) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('provider_result_missing', 'Hosted AI task completed without a downloadable result.', {
          taskId,
        }),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 502 },
    );
  }

  const requestHeaders = new Headers();
  const range = context.request.headers.get('Range');
  if (range) {
    requestHeaders.set('Range', range);
  }

  const upstream = await fetch(mediaUrl, { headers: requestHeaders });
  if (!upstream.ok || !upstream.body) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('provider_download_failed', 'Failed to download hosted AI result from the provider.', {
          providerStatus: upstream.status,
          taskId,
        }),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 502 },
    );
  }

  const responseHeaders = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  for (const header of ['Accept-Ranges', 'Content-Length', 'Content-Range', 'Content-Type', 'ETag', 'Last-Modified']) {
    const value = upstream.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }
  if (!responseHeaders.has('Content-Type')) {
    responseHeaders.set('Content-Type', 'application/octet-stream');
  }

  return new Response(upstream.body, {
    headers: responseHeaders,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

async function attachFailedTaskRefund(
  context: AppContext,
  userId: string,
  taskId: string,
  task: HostedVideoTask,
): Promise<{ creditBalance: number | null; task: HostedVideoTask & { refund?: unknown } }> {
  if (task.status !== 'failed') {
    return { creditBalance: null, task };
  }

  const refund = await refundCreditsForFailedTask(context.env.DB, userId, taskId);
  if (refund?.idempotencyKey) {
    await completeUsageEvent(context.env.DB, refund.idempotencyKey, { creditCost: 0, status: 'failed' });
  }

  return {
    creditBalance: refund?.creditBalance ?? null,
    task: refund ? { ...task, refund } : task,
  };
}

function parseHostedGeneration(body: HostedVideoRouteBody, requestId: string): HostedGenerationConfig | null {
  const paramsInput = body.params ?? body;
  const imageParams = normalizeHostedImageParams(paramsInput);

  if (imageParams) {
    return {
      creditsRequired: calculateHostedImageCost(imageParams.provider, imageParams.resolution),
      description: `Hosted ${imageParams.provider} image generation`,
      feature: 'hosted_kie_image_generation',
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
  if (videoParams) {
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
        referenceImageCount: videoParams.referenceMedia
          ?.filter((reference) => reference.mediaType === 'image').length ?? 0,
        referenceVideoCount: videoParams.referenceMedia
          ?.filter((reference) => reference.mediaType === 'video').length ?? 0,
        requestId,
        shotCount: videoParams.multiPrompt?.length ?? 0,
        sound: videoParams.multiShots ? true : Boolean(videoParams.sound),
      },
    };
  }

  const seedanceParams = normalizeHostedSeedanceParams(paramsInput);
  if (seedanceParams?.provider) {
    const hasVideoInput = seedanceParams.referenceMedia?.some((reference) => reference.mediaType === 'video') === true;

    return {
      creditsRequired: calculateHostedSeedanceCost(
        seedanceParams.provider,
        seedanceParams.mode,
        seedanceParams.duration,
        hasVideoInput,
      ),
      description: `Hosted ${seedanceParams.provider === 'bytedance/seedance-2-fast' ? 'Seedance 2.0 Fast' : 'Seedance 2.0'} generation`,
      feature: 'seedance_generation',
      ledgerSource: `hosted:${seedanceParams.provider}`,
      model: seedanceParams.provider,
      outputType: 'video',
      params: seedanceParams,
      provider: seedanceParams.provider,
      requestUnits: `${seedanceParams.duration}s`,
      usageMetadata: {
        aspectRatio: seedanceParams.aspectRatio,
        duration: seedanceParams.duration,
        hasEndImage: Boolean(seedanceParams.endImageUrl),
        hasStartImage: Boolean(seedanceParams.startImageUrl),
        hasVideoInput,
        mode: seedanceParams.mode,
        referenceAudioCount: seedanceParams.referenceMedia?.filter((reference) => reference.mediaType === 'audio').length ?? 0,
        referenceImageCount: seedanceParams.referenceMedia?.filter((reference) => reference.mediaType === 'image').length ?? 0,
        referenceVideoCount: seedanceParams.referenceMedia?.filter((reference) => reference.mediaType === 'video').length ?? 0,
        requestId,
        sound: Boolean(seedanceParams.sound),
      },
    };
  }

  const specialVideoParams = normalizeHostedSpecialVideoParams(paramsInput);
  if (!specialVideoParams?.provider) {
    return null;
  }

  return {
    creditsRequired: calculateHostedKlingCost('std', specialVideoParams.duration, false, false),
    description: `Hosted ${specialVideoParams.provider} generation`,
    feature: 'hosted_kie_video_generation',
    ledgerSource: `hosted:${specialVideoParams.provider}`,
    model: specialVideoParams.provider,
    outputType: 'video',
    params: specialVideoParams,
    provider: specialVideoParams.provider,
    requestUnits: `${specialVideoParams.duration}s`,
    usageMetadata: {
      aspectRatio: specialVideoParams.aspectRatio,
      duration: specialVideoParams.duration,
      hasEndImage: Boolean(specialVideoParams.endImageUrl),
      hasStartImage: Boolean(specialVideoParams.startImageUrl),
      mode: specialVideoParams.mode,
      referenceImageCount: specialVideoParams.referenceMedia?.filter((reference) => reference.mediaType === 'image').length ?? 0,
      referenceVideoCount: specialVideoParams.referenceMedia?.filter((reference) => reference.mediaType === 'video').length ?? 0,
      requestId,
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
    const url = new URL(context.request.url);
    const taskId = url.searchParams.get('taskId');
    const download = url.searchParams.get('download') === '1';

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
        const normalizedTaskId = taskId.trim();
        const task = await getHostedKlingTask(context.env, normalizedTaskId);
        const refunded = await attachFailedTaskRefund(context, hostedContext.user.id, normalizedTaskId, task);
        if (download) {
          return streamHostedTaskMedia(context, normalizedTaskId, refunded.task);
        }
        return json(
          buildRouteEnvelope({
            creditBalance: refunded.creditBalance ?? hostedContext.billing?.balance ?? 0,
            data: refunded.task,
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
      const refunded = await attachFailedTaskRefund(context, hostedContext.user.id, taskId, task);
      return json(
        buildRouteEnvelope({
          creditBalance: refunded.creditBalance ?? hostedContext.billing?.balance ?? 0,
          data: refunded.task,
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

  const moderation = await moderateAiInput(context.env, generation.params);
  if (blocksAiRequest(moderation)) {
    await insertAiAuditEvent(context, {
      feature: generation.feature,
      idempotencyKey,
      model: generation.model,
      moderation,
      prompt: generation.params,
      provider: generation.provider,
      requestId,
      status: 'blocked',
      userId: hostedContext.user.id,
    });

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          moderation.status === 'error' ? 'moderation_unavailable' : 'content_policy_violation',
          moderation.status === 'error'
            ? 'Hosted AI generation moderation is unavailable. Please try again later.'
            : 'This hosted AI generation request was blocked by content safety checks.',
          { categories: moderation.categories, outputType: generation.outputType, requestId },
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
      : generation.provider === 'bytedance/seedance-2' || generation.provider === 'bytedance/seedance-2-fast'
        ? await createHostedSeedanceTask(context.env, generation.params as HostedVideoParams)
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
      context.waitUntil(
        insertAiAuditEvent(context, {
          errorMessage: 'insufficient_credits',
          feature: generation.feature,
          idempotencyKey,
          model: generation.model,
          moderation,
          prompt: generation.params,
          provider: generation.provider,
          requestId,
          status: 'failed',
          userId: hostedContext.user.id,
        }).catch(() => {}),
      );
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
    context.waitUntil(
      insertAiAuditEvent(context, {
        creditCost: charge.charged ? creditsRequired : 0,
        feature: generation.feature,
        idempotencyKey,
        model: generation.model,
        moderation,
        prompt: generation.params,
        provider: generation.provider,
        providerTaskId: taskId,
        requestId,
        status: 'accepted',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

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
    context.waitUntil(
      insertAiAuditEvent(context, {
        errorMessage: error instanceof Error ? error.message : 'Hosted AI generation failed.',
        feature: generation.feature,
        idempotencyKey,
        model: generation.model,
        moderation,
        prompt: generation.params,
        provider: generation.provider,
        requestId,
        status: 'failed',
        userId: hostedContext.user.id,
      }).catch(() => {}),
    );

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
