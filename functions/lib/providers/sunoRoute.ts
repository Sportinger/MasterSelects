import { insertAiAuditEvent } from '../aiAudit';
import { blocksAiRequest, moderateAiInput } from '../aiModeration';
import { getCreditLedgerEntryBySource } from '../credits';
import { json } from '../db';
import type { AppContext } from '../env';
import { completeUsageEvent, createUsageEvent } from '../usage';
import { runReservedHostedCharge } from './hostedChargeFlow';
import {
  calculateHostedSunoCost,
  createHostedSunoMusicTask,
  createHostedSunoSoundsTask,
  type HostedSunoParams,
} from './kieai';
import {
  createGatewayError,
  createHostedGatewayEnvelope,
  type HostedGatewayEnvelope,
} from './shared';

export interface HostedSunoRouteContext {
  billing: { balance?: number | null } | null;
  user: { email: string; id: string } | null;
}

function buildSunoEnvelope<TData>(
  input: Omit<HostedGatewayEnvelope<TData>, 'kind' | 'mode' | 'provider' | 'requestId'> & {
    requestId: string | null;
    provider?: string;
  },
): HostedGatewayEnvelope<TData> {
  return createHostedGatewayEnvelope({
    ...input,
    kind: 'ai.audio',
    mode: 'hosted',
    provider: input.provider ?? 'suno-music',
    requestId: input.requestId,
  });
}

export async function handleHostedSunoMusicRequest(
  context: AppContext,
  hostedContext: HostedSunoRouteContext,
  params: HostedSunoParams,
  idempotencyKey: string,
  requestId: string,
  sound = false,
): Promise<Response> {
  const creditsRequired = calculateHostedSunoCost();
  const provider = sound ? 'suno-sounds' : 'suno-music';
  const ledgerSource = sound ? 'hosted:suno_sounds' : 'hosted:suno_music';
  const existingCharge = await getCreditLedgerEntryBySource(
    context.env.DB,
    hostedContext.user!.id,
    ledgerSource,
    idempotencyKey,
  );

  if (!existingCharge && (hostedContext.billing?.balance ?? 0) < creditsRequired) {
    return json(
      buildSunoEnvelope({
        creditBalance: hostedContext.billing?.balance ?? 0,
        error: createGatewayError(
          'insufficient_credits',
          `You need more credits to generate hosted ${sound ? 'Suno sounds' : 'Suno music'}.`,
          { creditsRequired, provider, requestId },
        ),
        next: 'pricing',
        ok: false,
        provider,
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

  const moderation = await moderateAiInput(context.env, params);
  if (blocksAiRequest(moderation)) {
    await insertAiAuditEvent(context, {
      feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
      idempotencyKey,
      model: params.model ?? 'V5_5',
      moderation,
      prompt: params,
      provider,
      requestId,
      status: 'blocked',
      userId: hostedContext.user!.id,
    });

    return json(
      buildSunoEnvelope({
        error: createGatewayError(
          moderation.status === 'error' ? 'moderation_unavailable' : 'content_policy_violation',
          moderation.status === 'error'
            ? `Hosted ${sound ? 'Suno sounds' : 'Suno music'} moderation is unavailable. Please try again later.`
            : `This hosted ${sound ? 'Suno sounds' : 'Suno music'} request was blocked by content safety checks.`,
          { categories: moderation.categories, provider, requestId },
        ),
        ok: false,
        provider,
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
    creditCost: creditsRequired,
    feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
    idempotencyKey,
    metadata: {
      customMode: Boolean(params.customMode),
      instrumental: params.instrumental !== false,
      model: params.model ?? 'V5_5',
      provider,
      requestId,
    },
    model: params.model ?? 'V5_5',
    provider,
    requestUnits: sound ? '1 sound' : '1 song',
    userId: hostedContext.user!.id,
  });

  const label = sound ? 'Suno sounds' : 'Suno music';
  const session = {
    authenticated: true,
    email: hostedContext.user!.email,
    provider: 'cookie_session' as const,
  };
  const auditBase = {
    feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
    idempotencyKey,
    model: params.model ?? 'V5_5',
    moderation,
    prompt: params,
    provider,
    requestId,
    userId: hostedContext.user!.id,
  };

  // Credits are reserved before the provider task exists; a failed provider
  // call releases the reservation (see runReservedHostedCharge).
  const outcome = await runReservedHostedCharge({
    createTask: () => (sound
      ? createHostedSunoSoundsTask(context.env, params)
      : createHostedSunoMusicTask(context.env, params)),
    creditsRequired,
    db: context.env.DB,
    description: `Hosted ${label} generation`,
    idempotencyKey,
    ledgerSource,
    metadata: {
      customMode: Boolean(params.customMode),
      instrumental: params.instrumental !== false,
      model: params.model ?? 'V5_5',
      provider,
      requestId,
    },
    taskIdOf: (task) => task.taskId,
    userId: hostedContext.user!.id,
  });

  if (outcome.status === 'insufficient') {
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
    context.waitUntil(
      insertAiAuditEvent(context, { ...auditBase, errorMessage: 'insufficient_credits', status: 'failed' })
        .catch(() => {}),
    );
    return json(
      buildSunoEnvelope({
        creditBalance: outcome.charge.balance,
        error: createGatewayError(
          'insufficient_credits',
          `You need more credits to generate hosted ${label}.`,
          { creditsRequired, provider, requestId },
        ),
        next: 'pricing',
        ok: false,
        provider,
        requestId,
        session,
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
        ...auditBase,
        errorMessage: error instanceof Error ? error.message : `Hosted ${label} generation failed.`,
        status: 'failed',
      }).catch(() => {}),
    );

    return json(
      buildSunoEnvelope({
        creditBalance: outcome.refund?.creditBalance ?? outcome.charge.balance,
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : `Hosted ${label} generation failed.`,
          { requestId },
        ),
        ok: false,
        provider,
        requestId,
        session,
        status: 'error',
      }),
      { status: 502 },
    );
  }

  const { charge, result: { taskId } } = outcome;
  await completeUsageEvent(context.env.DB, idempotencyKey, {
    ledgerEntryId: charge.entry?.id ?? null,
    status: 'completed',
  });
  context.waitUntil(
    insertAiAuditEvent(context, {
      ...auditBase,
      creditCost: charge.charged ? creditsRequired : 0,
      providerTaskId: taskId,
      status: 'accepted',
    }).catch(() => {}),
  );

  return json(
    buildSunoEnvelope({
      creditBalance: charge.balance,
      creditMutationId: charge.entry?.id ?? null,
      creditsCharged: charge.charged ? creditsRequired : 0,
      data: {
        outputType: 'audio',
        provider,
        taskId,
      },
      ok: true,
      provider,
      requestId,
      session,
      status: 'accepted',
    }),
  );
}
