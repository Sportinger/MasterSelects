import { getCreditLedgerEntryBySource } from '../credits';
import { json } from '../db';
import type { AppContext, Env } from '../env';
import { completeUsageEvent, createUsageEvent } from '../usage';
import { runReservedHostedCharge } from './hostedChargeFlow';
import {
  normalizeHostedOpenAITranscriptionParams,
  prepareHostedOpenAITranscription,
  type PreparedHostedOpenAITranscription,
} from './openaiTranscription';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from './shared';

export interface HostedTranscriptionRouteInput {
  billing: { balance?: number | null } | null;
  context: AppContext;
  idempotencyKey?: string;
  paramsInput: unknown;
  requestId: string;
  user: { email: string; id: string };
}

export interface HostedTranscriptionWord {
  confidence?: number;
  end: number;
  speaker?: number | string;
  speakerConfidence?: number;
  start: number;
  word: string;
}

export interface HostedTranscriptionProvider {
  calculateCredits(durationSeconds: number): number;
  create(
    env: Env,
    input: PreparedHostedOpenAITranscription,
  ): Promise<{ durationSeconds: number; model: string; words: HostedTranscriptionWord[] }>;
  displayName: string;
  id: 'deepgram' | 'openai';
  ledgerSource: string;
  model: string;
  resolveModel?(input: PreparedHostedOpenAITranscription): string;
}

function buildTranscriptionEnvelope<TData>(
  provider: HostedTranscriptionProvider,
  input: Omit<HostedGatewayEnvelope<TData>, 'kind' | 'mode' | 'provider' | 'requestId'> & {
    requestId: string | null;
  },
): HostedGatewayEnvelope<TData> {
  return createHostedGatewayEnvelope({
    ...input,
    kind: 'ai.audio',
    mode: 'hosted',
    provider: provider.id,
    requestId: input.requestId,
  });
}

export async function handleHostedTranscriptionRequest(
  provider: HostedTranscriptionProvider,
  {
    billing,
    context,
    idempotencyKey,
    paramsInput,
    requestId,
    user,
  }: HostedTranscriptionRouteInput,
): Promise<Response> {
  const session = { authenticated: true, email: user.email, provider: 'cookie_session' as const };
  const params = normalizeHostedOpenAITranscriptionParams(paramsInput);
  if (!params) {
    return json(
      buildTranscriptionEnvelope(provider, {
        error: createGatewayError('invalid_request', `Expected valid ${provider.displayName} transcription parameters.`, { requestId }),
        ok: false,
        requestId,
        session,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  let prepared: PreparedHostedOpenAITranscription;
  try {
    prepared = prepareHostedOpenAITranscription(params);
  } catch (error) {
    return json(
      buildTranscriptionEnvelope(provider, {
        error: createGatewayError(
          'invalid_request',
          error instanceof Error ? error.message : 'Expected a valid WAV audio payload.',
          { requestId },
        ),
        ok: false,
        requestId,
        session,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  const creditsRequired = provider.calculateCredits(prepared.durationSeconds);
  const safeIdempotencyKey = idempotencyKey && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : `${requestId}:ai.audio.transcription.${provider.id}`;
  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    user.id,
    provider.ledgerSource,
    safeIdempotencyKey,
  );

  if (!existingCharge && (billing?.balance ?? 0) < creditsRequired) {
    return json(
      buildTranscriptionEnvelope(provider, {
        creditBalance: billing?.balance ?? 0,
        error: createGatewayError('insufficient_credits', `You need more credits to transcribe with ${provider.displayName}.`, {
          creditsRequired,
          durationSeconds: prepared.durationSeconds,
          requestId,
        }),
        next: 'pricing',
        ok: false,
        requestId,
        session,
        status: 'requires_billing',
      }),
      { status: 402 },
    );
  }

  const requestedModel = provider.resolveModel?.(prepared) ?? provider.model;
  await createUsageEvent(context.env.DB, {
    creditCost: creditsRequired,
    feature: 'hosted_ai_transcription',
    idempotencyKey: safeIdempotencyKey,
    metadata: {
      durationSeconds: prepared.durationSeconds,
      language: prepared.language ?? 'auto',
      provider: provider.id,
      requestId,
    },
    model: requestedModel,
    provider: provider.id,
    requestUnits: `${Math.ceil(prepared.durationSeconds)} sec`,
    userId: user.id,
  });

  // Credits are reserved before the provider call; a failed call releases the
  // reservation (see runReservedHostedCharge).
  const outcome = await runReservedHostedCharge({
    createTask: () => provider.create(context.env, prepared),
    creditsRequired,
    db: context.env.DB,
    description: `Hosted ${provider.displayName} transcription`,
    idempotencyKey: safeIdempotencyKey,
    ledgerSource: provider.ledgerSource,
    metadata: {
      durationSeconds: prepared.durationSeconds,
      language: prepared.language ?? 'auto',
      model: requestedModel,
      requestId,
    },
    userId: user.id,
  });

  if (outcome.status === 'insufficient') {
    await completeUsageEvent(context.env.DB, safeIdempotencyKey, { status: 'failed' });
    return json(
      buildTranscriptionEnvelope(provider, {
        creditBalance: outcome.charge.balance,
        error: createGatewayError('insufficient_credits', `You need more credits to transcribe with ${provider.displayName}.`, {
          creditsRequired,
          requestId,
        }),
        next: 'pricing',
        ok: false,
        requestId,
        session,
        status: 'requires_billing',
      }),
      { status: 402 },
    );
  }

  if (outcome.status === 'provider_failed') {
    const { error } = outcome;
    await completeUsageEvent(context.env.DB, safeIdempotencyKey, { status: 'failed' });
    return json(
      buildTranscriptionEnvelope(provider, {
        creditBalance: outcome.refund?.creditBalance ?? outcome.charge.balance,
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : `Hosted ${provider.displayName} transcription failed.`,
          { requestId },
        ),
        ok: false,
        requestId,
        session,
        status: 'error',
      }),
      { status: 502 },
    );
  }

  const { charge, result } = outcome;
  await completeUsageEvent(context.env.DB, safeIdempotencyKey, {
    ledgerEntryId: charge.entry?.id ?? null,
    status: 'completed',
  });

  return json(buildTranscriptionEnvelope(provider, {
    creditBalance: charge.balance,
    creditMutationId: charge.entry?.id ?? null,
    creditsCharged: charge.charged ? creditsRequired : 0,
    data: result,
    ok: true,
    requestId,
    session,
    status: 'completed',
  }));
}
