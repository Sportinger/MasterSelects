import { getUserBillingSnapshot } from '../../lib/billing';
import { insertAiAuditEvent } from '../../lib/aiAudit';
import { blocksAiRequest, moderateAiInput } from '../../lib/aiModeration';
import { getCreditLedgerEntryBySource, refundCreditsForFailedTask } from '../../lib/credits';
import { getAiUser, isGuestAiUser, json, methodNotAllowed, parseJson } from '../../lib/db';
import { rejectByokCredentials } from '../../lib/noByok';
import { runReservedHostedCharge, settleReservedHostedCharge } from '../../lib/providers/hostedChargeFlow';
import {
  buildHostedElevenLabsCapabilities,
  calculateHostedElevenLabsCredits,
  createHostedElevenLabsSpeech,
  estimateHostedElevenLabsSpeechCost,
  listHostedElevenLabsModels,
  listHostedElevenLabsVoices,
  normalizeHostedElevenLabsSpeechParams,
  normalizeHostedElevenLabsVoiceSearchParams,
} from '../../lib/providers/elevenlabs';
import {
  getHostedSunoMusicTask,
  normalizeHostedSunoParams,
  normalizeHostedSunoSoundsParams,
  type HostedSunoTask,
} from '../../lib/providers/kieai';
import {
  handleHostedDeepgramTranscriptionRequest,
} from '../../lib/providers/deepgramTranscriptionRoute';
import {
  handleHostedOpenAITranscriptionRequest,
} from '../../lib/providers/openaiTranscriptionRoute';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from '../../lib/providers/shared';
import { handleHostedSunoMusicRequest } from '../../lib/providers/sunoRoute';
import { completeUsageEvent, createUsageEvent } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface HostedAudioRouteBody {
  action?: string;
  idempotencyKey?: string;
  params?: unknown;
}

interface HostedAiContext {
  billing: Awaited<ReturnType<typeof getUserBillingSnapshot>> | null;
  guest: boolean;
  user: ReturnType<typeof getAiUser>;
}

function buildRouteEnvelope<TData>(
  input: Omit<HostedGatewayEnvelope<TData>, 'kind' | 'mode' | 'provider' | 'requestId'> & {
    requestId: string | null;
    provider?: string;
  },
): HostedGatewayEnvelope<TData> {
  const session = input.session?.email?.endsWith('@guest.masterselects.invalid')
    ? { authenticated: false, email: null, guest: true, provider: 'guest' }
    : input.session;
  return createHostedGatewayEnvelope({
    ...input,
    kind: 'ai.audio',
    mode: 'hosted',
    provider: input.provider ?? 'elevenlabs',
    requestId: input.requestId,
    session,
  });
}

function resolveHostedContext(context: AppContext): HostedAiContext {
  const user = getAiUser(context);

  return {
    billing: null,
    guest: isGuestAiUser(context),
    user,
  };
}

async function loadHostedContext(context: AppContext): Promise<HostedAiContext> {
  const { user } = resolveHostedContext(context);

  if (!user) {
    return {
      billing: null,
      guest: false,
      user: null,
    };
  }

  return {
    billing: await getUserBillingSnapshot(context.env.DB, user.id, { guest: isGuestAiUser(context) }),
    guest: isGuestAiUser(context),
    user,
  };
}

function buildCapabilityResponse(context: AppContext, hostedContext: HostedAiContext): HostedGatewayEnvelope<Record<string, unknown>> {
  const requestId = context.data.requestId ?? null;
  const capabilities = {
    elevenlabs: buildHostedElevenLabsCapabilities(),
    openaiTranscription: {
      creditsPerMinute: 6,
      models: ['whisper-1', 'gpt-4o-transcribe-diarize'],
      provider: 'openai',
    },
    suno: {
      models: ['V5_5', 'V5', 'V4_5PLUS', 'V4_5', 'V4'],
      pollingSupported: true,
      provider: 'suno-music',
    },
  };
  const authenticated = Boolean(hostedContext.user);

  return buildRouteEnvelope({
    capability: capabilities,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities,
      feature: 'hosted_ai_audio',
      modes: ['hosted'],
      pollingSupported: false,
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

function requireHostedAudioAccess(
  hostedContext: HostedAiContext,
  requestId: string | null,
): Response | null {
  if (!hostedContext.user) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('auth_required', 'Hosted audio features require a signed-in account.', {
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
          'Hosted audio features are not enabled for this account.',
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

  return null;
}

async function attachFailedTaskRefund(
  context: AppContext,
  userId: string,
  taskId: string,
  task: HostedSunoTask,
): Promise<{ creditBalance: number | null; task: HostedSunoTask & { refund?: unknown } }> {
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

  const requestId = context.data.requestId ?? crypto.randomUUID();

  if (context.request.method === 'GET') {
    const url = new URL(context.request.url);
    const action = url.searchParams.get('action') ?? 'capabilities';
    const hostedContext = await loadHostedContext(context);

    if (action === 'capabilities') {
      return json(buildCapabilityResponse(context, hostedContext));
    }

    const accessError = requireHostedAudioAccess(hostedContext, requestId);
    if (accessError) {
      return accessError;
    }

    try {
      if (action === 'models') {
        const models = await listHostedElevenLabsModels(context.env);
        return json(
          buildRouteEnvelope({
            creditBalance: hostedContext.billing?.balance ?? 0,
            data: { models },
            ok: true,
            requestId,
            session: {
              authenticated: true,
              email: hostedContext.user?.email ?? null,
              provider: 'cookie_session',
            },
            status: 'completed',
          }),
        );
      }

      if (action === 'voices') {
        const result = await listHostedElevenLabsVoices(
          context.env,
          normalizeHostedElevenLabsVoiceSearchParams(url.searchParams),
        );
        return json(
          buildRouteEnvelope({
            creditBalance: hostedContext.billing?.balance ?? 0,
            data: result,
            ok: true,
            requestId,
            session: {
              authenticated: true,
              email: hostedContext.user?.email ?? null,
              provider: 'cookie_session',
            },
            status: 'completed',
          }),
        );
      }

      if (action === 'status') {
        const taskId = url.searchParams.get('taskId')?.trim() ?? '';
        if (!taskId) {
          return json(
            buildRouteEnvelope({
              error: createGatewayError('invalid_task_id', 'A taskId is required.', { requestId }),
              ok: false,
              provider: 'suno-music',
              requestId,
              status: 'error',
            }),
            { status: 400 },
          );
        }

        const task = await getHostedSunoMusicTask(context.env, taskId);
        const refunded = await attachFailedTaskRefund(context, hostedContext.user!.id, taskId, task);
        return json(
          buildRouteEnvelope({
            creditBalance: refunded.creditBalance ?? hostedContext.billing?.balance ?? 0,
            data: refunded.task,
            ok: true,
            provider: 'suno-music',
            requestId,
            session: {
              authenticated: true,
              email: hostedContext.user?.email ?? null,
              provider: 'cookie_session',
            },
            status: task.status === 'completed' ? 'completed' : task.status === 'failed' ? 'error' : 'processing',
          }),
        );
      }
    } catch (error) {
      return json(
        buildRouteEnvelope({
          error: createGatewayError(
            'provider_request_failed',
            error instanceof Error ? error.message : 'Hosted ElevenLabs request failed.',
            { action, requestId },
          ),
          ok: false,
          requestId,
          status: 'error',
        }),
        { status: 502 },
      );
    }

    return json(
      buildRouteEnvelope({
        error: createGatewayError('invalid_action', 'Unsupported hosted audio action.', {
          action,
          requestId,
        }),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  if (context.request.method !== 'POST') {
    return methodNotAllowed(['GET', 'POST', 'OPTIONS']);
  }

  const rawBody = (await parseJson<HostedAudioRouteBody>(context.request)) ?? null;
  const byokBodyError = rejectByokCredentials({ payload: rawBody });
  if (byokBodyError) {
    return byokBodyError;
  }
  const paramsInput = rawBody?.params ?? rawBody;

  if (rawBody?.action === 'music' || rawBody?.action === 'sound') {
    const sound = rawBody.action === 'sound';
    const musicParams = sound
      ? normalizeHostedSunoSoundsParams(paramsInput)
      : normalizeHostedSunoParams(paramsInput);

    if (!musicParams) {
      return json(
        buildRouteEnvelope({
          error: createGatewayError('invalid_request', `Expected valid Suno ${sound ? 'sounds' : 'music'} parameters.`, {
            requestId,
          }),
          ok: false,
          provider: sound ? 'suno-sounds' : 'suno-music',
          requestId,
          status: 'error',
        }),
        { status: 400 },
      );
    }

    const hostedContext = await loadHostedContext(context);
    const accessError = requireHostedAudioAccess(hostedContext, requestId);
    if (accessError) {
      return accessError;
    }

    const idempotencyKey =
      typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
        ? rawBody.idempotencyKey.trim()
        : `${requestId}:ai.audio.${sound ? 'suno-sounds' : 'suno'}`;

    return handleHostedSunoMusicRequest(context, hostedContext, musicParams, idempotencyKey, requestId, sound);
  }

  if (rawBody?.action === 'transcription') {
    const hostedContext = await loadHostedContext(context);
    const accessError = requireHostedAudioAccess(hostedContext, requestId);
    if (accessError) {
      return accessError;
    }

    const transcriptionProvider = typeof paramsInput === 'object'
      && paramsInput !== null
      && 'provider' in paramsInput
      && paramsInput.provider === 'deepgram'
      ? 'deepgram'
      : 'openai';

    if (transcriptionProvider === 'deepgram') {
      return handleHostedDeepgramTranscriptionRequest({
        billing: hostedContext.billing,
        context,
        idempotencyKey: rawBody.idempotencyKey,
        paramsInput,
        requestId,
        user: hostedContext.user!,
      });
    }

    return handleHostedOpenAITranscriptionRequest({
      billing: hostedContext.billing,
      context,
      idempotencyKey: rawBody.idempotencyKey,
      paramsInput,
      requestId,
      user: hostedContext.user!,
    });
  }

  const speechParams = normalizeHostedElevenLabsSpeechParams(paramsInput);

  if (!speechParams) {
    return json(
      buildRouteEnvelope({
        error: createGatewayError('invalid_request', 'Expected valid ElevenLabs speech parameters.', {
          requestId,
        }),
        ok: false,
        requestId,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  const hostedContext = await loadHostedContext(context);
  const accessError = requireHostedAudioAccess(hostedContext, requestId);
  if (accessError) {
    return accessError;
  }

  const estimatedCost = estimateHostedElevenLabsSpeechCost(speechParams);
  const idempotencyKey =
    typeof rawBody?.idempotencyKey === 'string' && rawBody.idempotencyKey.trim().length > 0
      ? rawBody.idempotencyKey.trim()
      : `${requestId}:ai.audio`;
  const ledgerSource = 'hosted:elevenlabs_tts';
  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    hostedContext.user!.id,
    ledgerSource,
    idempotencyKey,
  );

  if (!existingCharge && (hostedContext.billing?.balance ?? 0) < estimatedCost.creditsRequired) {
    return json(
      buildRouteEnvelope({
        creditBalance: hostedContext.billing?.balance ?? 0,
        error: createGatewayError(
          'insufficient_credits',
          'You need more credits to generate hosted ElevenLabs speech.',
          {
            creditsRequired: estimatedCost.creditsRequired,
            providerCredits: estimatedCost.providerCredits,
            requestId,
            textCharacters: estimatedCost.textCharacters,
          },
        ),
        next: 'pricing',
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user!.email,
          provider: 'cookie_session',
        },
        status: 'requires_billing',
      }),
      { status: 402 },
    );
  }

  const moderation = await moderateAiInput(context.env, {
    modelId: speechParams.modelId,
    text: speechParams.text,
    voiceId: speechParams.voiceId,
  });
  if (blocksAiRequest(moderation)) {
    await insertAiAuditEvent(context, {
      feature: 'hosted_ai_audio',
      idempotencyKey,
      model: speechParams.modelId,
      moderation,
      prompt: {
        modelId: speechParams.modelId,
        text: speechParams.text,
        voiceId: speechParams.voiceId,
      },
      provider: 'elevenlabs',
      requestId,
      status: 'blocked',
      userId: hostedContext.user!.id,
    });

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          moderation.status === 'error' ? 'moderation_unavailable' : 'content_policy_violation',
          moderation.status === 'error'
            ? 'Hosted ElevenLabs moderation is unavailable. Please try again later.'
            : 'This hosted ElevenLabs speech request was blocked by content safety checks.',
          { categories: moderation.categories, requestId },
        ),
        ok: false,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user!.email,
          provider: 'cookie_session',
        },
        status: 'error',
      }),
      { status: moderation.status === 'error' ? 503 : 400 },
    );
  }

  await createUsageEvent(context.env.DB, {
    creditCost: estimatedCost.creditsRequired,
    feature: 'hosted_ai_audio',
    idempotencyKey,
    metadata: {
      estimatedProviderCredits: estimatedCost.providerCredits,
      estimatedUsd: estimatedCost.usdEstimate,
      modelId: speechParams.modelId,
      outputFormat: speechParams.outputFormat,
      requestId,
      textCharacters: estimatedCost.textCharacters,
      voiceId: speechParams.voiceId,
    },
    model: speechParams.modelId,
    provider: 'elevenlabs',
    requestUnits: `${estimatedCost.textCharacters} chars`,
    userId: hostedContext.user!.id,
  });

  const speechSession = {
    authenticated: true,
    email: hostedContext.user!.email,
    provider: 'cookie_session' as const,
  };
  const speechAudit = {
    feature: 'hosted_ai_audio',
    idempotencyKey,
    model: speechParams.modelId,
    moderation,
    prompt: {
      modelId: speechParams.modelId,
      text: speechParams.text,
      voiceId: speechParams.voiceId,
    },
    provider: 'elevenlabs',
    requestId,
    userId: hostedContext.user!.id,
  };

  // The estimate is reserved before ElevenLabs is called and settled against
  // the provider's character count afterwards (never above the estimate); a
  // failed provider call releases the reservation.
  const outcome = await runReservedHostedCharge({
    createTask: () => createHostedElevenLabsSpeech(context.env, speechParams),
    creditsRequired: estimatedCost.creditsRequired,
    db: context.env.DB,
    description: 'Hosted ElevenLabs speech generation',
    idempotencyKey,
    ledgerSource,
    metadata: {
      estimatedProviderCredits: estimatedCost.providerCredits,
      modelId: speechParams.modelId,
      outputFormat: speechParams.outputFormat,
      requestId,
      textCharacters: estimatedCost.textCharacters,
      voiceId: speechParams.voiceId,
    },
    userId: hostedContext.user!.id,
  });

  if (outcome.status === 'insufficient') {
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
    context.waitUntil(
      insertAiAuditEvent(context, { ...speechAudit, errorMessage: 'insufficient_credits', status: 'failed' })
        .catch(() => {}),
    );
    return json(
      buildRouteEnvelope({
        creditBalance: outcome.charge.balance,
        error: createGatewayError(
          'insufficient_credits',
          'You need more credits to generate hosted ElevenLabs speech.',
          {
            creditsRequired: estimatedCost.creditsRequired,
            providerCredits: estimatedCost.providerCredits,
            requestId,
            textCharacters: estimatedCost.textCharacters,
          },
        ),
        next: 'pricing',
        ok: false,
        requestId,
        session: speechSession,
        status: 'requires_billing',
      }),
      { status: 402 },
    );
  }

  if (outcome.status === 'provider_failed') {
    const { error } = outcome;
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
    context.waitUntil(
      insertAiAuditEvent(context, {
        ...speechAudit,
        errorMessage: error instanceof Error ? error.message : 'Hosted ElevenLabs speech generation failed.',
        status: 'failed',
      }).catch(() => {}),
    );

    return json(
      buildRouteEnvelope({
        creditBalance: outcome.refund?.creditBalance ?? outcome.charge.balance,
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted ElevenLabs speech generation failed.',
          { requestId },
        ),
        ok: false,
        requestId,
        session: speechSession,
        status: 'error',
      }),
      { status: 502 },
    );
  }

  const { charge, result: speech } = outcome;
  const providerCredits = speech.providerCharacterCost ?? estimatedCost.providerCredits;
  const settlement = await settleReservedHostedCharge({
    actualCredits: calculateHostedElevenLabsCredits(providerCredits),
    charge,
    db: context.env.DB,
    idempotencyKey,
    ledgerSource,
    metadata: {
      actualProviderCredits: providerCredits,
      providerRequestId: speech.providerRequestId,
      requestId,
      size: speech.size,
    },
    userId: hostedContext.user!.id,
  });

  await completeUsageEvent(context.env.DB, idempotencyKey, {
    creditCost: settlement.creditsCharged,
    ledgerEntryId: settlement.ledgerEntryId,
    status: 'completed',
  });
  context.waitUntil(
    insertAiAuditEvent(context, { ...speechAudit, creditCost: settlement.creditsCharged, status: 'completed' })
      .catch(() => {}),
  );

  return new Response(speech.audio, {
    headers: {
      'Content-Type': speech.mimeType,
      'X-ElevenLabs-Character-Count': String(providerCredits),
      'X-ElevenLabs-Request-Id': speech.providerRequestId ?? '',
      'X-MasterSelects-Credit-Balance': String(settlement.balance),
      'X-MasterSelects-Credit-Mutation-Id': settlement.ledgerEntryId ?? '',
      'X-MasterSelects-Credits-Charged': String(settlement.creditsCharged),
      'X-MasterSelects-Credits-Estimated': String(estimatedCost.creditsRequired),
      'X-MasterSelects-Output-Format': speech.outputFormat,
      'X-MasterSelects-Request-Id': requestId,
    },
    status: 200,
  });
};
