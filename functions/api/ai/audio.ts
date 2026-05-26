import { getUserBillingSnapshot } from '../../lib/billing';
import { getCreditLedgerEntryBySource, spendCredits } from '../../lib/credits';
import { getCurrentUser, json, methodNotAllowed, parseJson } from '../../lib/db';
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
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from '../../lib/providers/shared';
import { completeUsageEvent, createUsageEvent } from '../../lib/usage';
import type { AppContext, AppRouteHandler } from '../../lib/env';

interface HostedAudioRouteBody {
  action?: string;
  idempotencyKey?: string;
  params?: unknown;
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
    kind: 'ai.audio',
    mode: 'hosted',
    provider: input.provider ?? 'elevenlabs',
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
  const capabilities = buildHostedElevenLabsCapabilities();
  const authenticated = Boolean(hostedContext.user);

  return buildRouteEnvelope({
    byoRequired: !authenticated || !hostedContext.billing?.hostedAIEnabled,
    capability: capabilities,
    creditBalance: hostedContext.billing?.balance ?? 0,
    data: {
      capabilities,
      feature: 'hosted_ai_audio',
      modes: ['hosted', 'byo'],
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
        error: createGatewayError('auth_required', 'Hosted ElevenLabs speech requires a signed-in account.', {
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
          'Hosted ElevenLabs speech is not enabled for this account.',
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

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
      },
      status: 204,
    });
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
  const paramsInput = rawBody?.params ?? rawBody;
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

  try {
    const speech = await createHostedElevenLabsSpeech(context.env, speechParams);
    const providerCredits = speech.providerCharacterCost ?? estimatedCost.providerCredits;
    const actualCreditsRequired = calculateHostedElevenLabsCredits(providerCredits);
    const charge = await spendCredits(
      context.env.DB,
      hostedContext.user!.id,
      actualCreditsRequired,
      ledgerSource,
      idempotencyKey,
      'Hosted ElevenLabs speech generation',
      {
        actualProviderCredits: providerCredits,
        estimatedProviderCredits: estimatedCost.providerCredits,
        modelId: speechParams.modelId,
        outputFormat: speech.outputFormat,
        providerRequestId: speech.providerRequestId,
        requestId,
        size: speech.size,
        textCharacters: estimatedCost.textCharacters,
        voiceId: speechParams.voiceId,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, idempotencyKey, {
        creditCost: actualCreditsRequired,
        status: 'failed',
      });
      return json(
        buildRouteEnvelope({
          creditBalance: charge.balance,
          error: createGatewayError(
            'insufficient_credits',
            'You need more credits to generate hosted ElevenLabs speech.',
            {
              creditsRequired: actualCreditsRequired,
              providerCredits,
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

    await completeUsageEvent(context.env.DB, idempotencyKey, {
      creditCost: actualCreditsRequired,
      ledgerEntryId: charge.entry?.id ?? null,
      status: 'completed',
    });

    return new Response(speech.audio, {
      headers: {
        'Content-Type': speech.mimeType,
        'X-ElevenLabs-Character-Count': String(providerCredits),
        'X-ElevenLabs-Request-Id': speech.providerRequestId ?? '',
        'X-MasterSelects-Credit-Balance': String(charge.balance),
        'X-MasterSelects-Credits-Charged': String(charge.charged ? actualCreditsRequired : 0),
        'X-MasterSelects-Credits-Estimated': String(estimatedCost.creditsRequired),
        'X-MasterSelects-Output-Format': speech.outputFormat,
        'X-MasterSelects-Request-Id': requestId,
      },
      status: 200,
    });
  } catch (error) {
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });

    return json(
      buildRouteEnvelope({
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted ElevenLabs speech generation failed.',
          { requestId },
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
      { status: 502 },
    );
  }
};
