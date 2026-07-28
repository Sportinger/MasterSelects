import { getCreditLedgerEntryBySource, spendCredits } from '../credits';
import { json } from '../db';
import type { AppContext, Env } from '../env';
import { completeUsageEvent, createUsageEvent } from '../usage';
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

  try {
    const result = await provider.create(context.env, prepared);
    const charge = await spendCredits(
      context.env.DB,
      user.id,
      creditsRequired,
      provider.ledgerSource,
      safeIdempotencyKey,
      `Hosted ${provider.displayName} transcription`,
      {
        durationSeconds: prepared.durationSeconds,
        language: prepared.language ?? 'auto',
        model: result.model,
        requestId,
        wordCount: result.words.length,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, safeIdempotencyKey, { status: 'failed' });
      return json(
        buildTranscriptionEnvelope(provider, {
          creditBalance: charge.balance,
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

    await completeUsageEvent(context.env.DB, safeIdempotencyKey, {
      ledgerEntryId: charge.entry?.id ?? null,
      status: 'completed',
    });

    return json(buildTranscriptionEnvelope(provider, {
      creditBalance: charge.balance,
      creditsCharged: charge.charged ? creditsRequired : 0,
      data: result,
      ok: true,
      requestId,
      session,
      status: 'completed',
    }));
  } catch (error) {
    await completeUsageEvent(context.env.DB, safeIdempotencyKey, { status: 'failed' });
    return json(
      buildTranscriptionEnvelope(provider, {
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
}
