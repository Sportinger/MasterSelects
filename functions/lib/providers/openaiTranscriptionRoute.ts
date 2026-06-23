import { getCreditLedgerEntryBySource, spendCredits } from '../credits';
import { json } from '../db';
import type { AppContext } from '../env';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from './shared';
import { completeUsageEvent, createUsageEvent } from '../usage';
import {
  calculateHostedOpenAITranscriptionCredits,
  createHostedOpenAITranscription,
  normalizeHostedOpenAITranscriptionParams,
  prepareHostedOpenAITranscription,
} from './openaiTranscription';

interface HostedOpenAITranscriptionRouteInput {
  billing: { balance?: number | null } | null;
  context: AppContext;
  idempotencyKey?: string;
  paramsInput: unknown;
  requestId: string;
  user: { email: string; id: string };
}

function buildOpenAIEnvelope<TData>(
  input: Omit<HostedGatewayEnvelope<TData>, 'kind' | 'mode' | 'provider' | 'requestId'> & {
    requestId: string | null;
  },
): HostedGatewayEnvelope<TData> {
  return createHostedGatewayEnvelope({
    ...input,
    kind: 'ai.audio',
    mode: 'hosted',
    provider: 'openai',
    requestId: input.requestId,
  });
}

export async function handleHostedOpenAITranscriptionRequest({
  billing,
  context,
  idempotencyKey,
  paramsInput,
  requestId,
  user,
}: HostedOpenAITranscriptionRouteInput): Promise<Response> {
  const session = { authenticated: true, email: user.email, provider: 'cookie_session' as const };
  const params = normalizeHostedOpenAITranscriptionParams(paramsInput);
  if (!params) {
    return json(
      buildOpenAIEnvelope({
        error: createGatewayError('invalid_request', 'Expected valid OpenAI transcription parameters.', { requestId }),
        ok: false,
        requestId,
        session,
        status: 'error',
      }),
      { status: 400 },
    );
  }

  let prepared: ReturnType<typeof prepareHostedOpenAITranscription>;
  try {
    prepared = prepareHostedOpenAITranscription(params);
  } catch (error) {
    return json(
      buildOpenAIEnvelope({
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

  const creditsRequired = calculateHostedOpenAITranscriptionCredits(prepared.durationSeconds);
  const safeIdempotencyKey = idempotencyKey && idempotencyKey.trim()
    ? idempotencyKey.trim()
    : `${requestId}:ai.audio.transcription`;
  const ledgerSource = 'hosted:openai_transcription';
  const existingCharge = await getCreditLedgerEntryBySource(context.env.DB, user.id, ledgerSource, safeIdempotencyKey);

  if (!existingCharge && (billing?.balance ?? 0) < creditsRequired) {
    return json(
      buildOpenAIEnvelope({
        creditBalance: billing?.balance ?? 0,
        error: createGatewayError('insufficient_credits', 'You need more credits to transcribe with OpenAI.', {
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

  await createUsageEvent(context.env.DB, {
    creditCost: creditsRequired,
    feature: 'hosted_ai_transcription',
    idempotencyKey: safeIdempotencyKey,
    metadata: {
      durationSeconds: prepared.durationSeconds,
      language: prepared.language ?? 'auto',
      requestId,
    },
    model: 'whisper-1',
    provider: 'openai',
    requestUnits: `${Math.ceil(prepared.durationSeconds)} sec`,
    userId: user.id,
  });

  try {
    const result = await createHostedOpenAITranscription(context.env, prepared);
    const charge = await spendCredits(
      context.env.DB,
      user.id,
      creditsRequired,
      ledgerSource,
      safeIdempotencyKey,
      'Hosted OpenAI transcription',
      {
        durationSeconds: prepared.durationSeconds,
        language: prepared.language ?? 'auto',
        requestId,
        wordCount: result.words.length,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, safeIdempotencyKey, { status: 'failed' });
      return json(
        buildOpenAIEnvelope({
          creditBalance: charge.balance,
          error: createGatewayError('insufficient_credits', 'You need more credits to transcribe with OpenAI.', {
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

    return json(buildOpenAIEnvelope({
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
      buildOpenAIEnvelope({
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : 'Hosted OpenAI transcription failed.',
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
