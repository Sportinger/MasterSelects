import { insertAiAuditEvent } from '../aiAudit';
import { blocksAiRequest, moderateAiInput } from '../aiModeration';
import { getCreditLedgerEntryBySource, spendCredits } from '../credits';
import { json } from '../db';
import type { AppContext } from '../env';
import { completeUsageEvent, createUsageEvent } from '../usage';
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

  try {
    const { taskId } = sound
      ? await createHostedSunoSoundsTask(context.env, params)
      : await createHostedSunoMusicTask(context.env, params);
    const charge = await spendCredits(
      context.env.DB,
      hostedContext.user!.id,
      creditsRequired,
      ledgerSource,
      idempotencyKey,
      `Hosted ${sound ? 'Suno sounds' : 'Suno music'} generation`,
      {
        customMode: Boolean(params.customMode),
        instrumental: params.instrumental !== false,
        model: params.model ?? 'V5_5',
        provider,
        requestId,
        taskId,
      },
    );

    if (charge.insufficient) {
      await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
      context.waitUntil(
        insertAiAuditEvent(context, {
          errorMessage: 'insufficient_credits',
          feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
          idempotencyKey,
          model: params.model ?? 'V5_5',
          moderation,
          prompt: params,
          provider,
          requestId,
          status: 'failed',
          userId: hostedContext.user!.id,
        }).catch(() => {}),
      );
      return json(
        buildSunoEnvelope({
          creditBalance: charge.balance,
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

    await completeUsageEvent(context.env.DB, idempotencyKey, {
      ledgerEntryId: charge.entry?.id ?? null,
      status: 'completed',
    });
    context.waitUntil(
      insertAiAuditEvent(context, {
        creditCost: charge.charged ? creditsRequired : 0,
        feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
        idempotencyKey,
        model: params.model ?? 'V5_5',
        moderation,
        prompt: params,
        provider,
        providerTaskId: taskId,
        requestId,
        status: 'accepted',
        userId: hostedContext.user!.id,
      }).catch(() => {}),
    );

    return json(
      buildSunoEnvelope({
        creditBalance: charge.balance,
        creditsCharged: charge.charged ? creditsRequired : 0,
        data: {
          outputType: 'audio',
          provider,
          taskId,
        },
        ok: true,
        provider,
        requestId,
        session: {
          authenticated: true,
          email: hostedContext.user!.email,
          provider: 'cookie_session',
        },
        status: 'accepted',
      }),
    );
  } catch (error) {
    await completeUsageEvent(context.env.DB, idempotencyKey, { status: 'failed' });
    context.waitUntil(
      insertAiAuditEvent(context, {
        errorMessage: error instanceof Error ? error.message : `Hosted ${sound ? 'Suno sounds' : 'Suno music'} generation failed.`,
        feature: sound ? 'suno_sounds_generation' : 'suno_music_generation',
        idempotencyKey,
        model: params.model ?? 'V5_5',
        moderation,
        prompt: params,
        provider,
        requestId,
        status: 'failed',
        userId: hostedContext.user!.id,
      }).catch(() => {}),
    );

    return json(
      buildSunoEnvelope({
        error: createGatewayError(
          'provider_request_failed',
          error instanceof Error ? error.message : `Hosted ${sound ? 'Suno sounds' : 'Suno music'} generation failed.`,
          { requestId },
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
      { status: 502 },
    );
  }
}
