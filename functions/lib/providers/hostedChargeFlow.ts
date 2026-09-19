import {
  appendCreditLedgerEntry,
  attachTaskIdToCreditLedgerEntry,
  refundCreditsForFailedCharge,
  spendCredits,
  type FailedTaskCreditRefundResult,
  type SpendCreditsResult,
} from '../credits';
import type { AppD1Database } from '../env';

export interface ReservedHostedChargeInput<TResult> {
  /** Calls the upstream provider. Runs only after the credits are reserved. */
  createTask: () => Promise<TResult>;
  creditsRequired: number;
  db: AppD1Database;
  description: string;
  idempotencyKey: string;
  ledgerSource: string;
  metadata: Record<string, unknown>;
  /** Provider task id to record on the spend entry once the task exists. */
  taskIdOf?: (result: TResult) => string | null | undefined;
  userId: string;
}

export type ReservedHostedChargeOutcome<TResult> =
  | { charge: SpendCreditsResult; status: 'insufficient' }
  | {
      charge: SpendCreditsResult;
      error: unknown;
      refund: FailedTaskCreditRefundResult | null;
      status: 'provider_failed';
    }
  | { charge: SpendCreditsResult; result: TResult; status: 'accepted' };

/**
 * Charge-before-provider sequence shared by the hosted AI routes:
 *
 * 1. reserve the credits with the atomic ledger debit, so parallel requests
 *    cannot overdraw and repeats of one idempotency key are charged once;
 * 2. only then call the upstream provider;
 * 3. release the reservation through the refund ledger path when the
 *    provider call fails (never for an idempotent repeat that charged nothing);
 * 4. attach the provider task id to the spend entry so the failed-task refund
 *    and diagnostics ownership lookups keep finding the charge.
 */
export async function runReservedHostedCharge<TResult>(
  input: ReservedHostedChargeInput<TResult>,
): Promise<ReservedHostedChargeOutcome<TResult>> {
  const charge = await spendCredits(
    input.db,
    input.userId,
    input.creditsRequired,
    input.ledgerSource,
    input.idempotencyKey,
    input.description,
    input.metadata,
  );
  if (charge.insufficient) {
    return { charge, status: 'insufficient' };
  }

  let result: TResult;
  try {
    result = await input.createTask();
  } catch (error) {
    let refund: FailedTaskCreditRefundResult | null = null;
    if (charge.charged) {
      try {
        refund = await refundCreditsForFailedCharge(
          input.db,
          input.userId,
          input.ledgerSource,
          input.idempotencyKey,
          'provider_request_failed',
        );
      } catch (refundError) {
        console.error(
          '[hosted-ai] reservation refund failed',
          input.ledgerSource,
          input.idempotencyKey,
          refundError instanceof Error ? refundError.message : refundError,
        );
      }
    }
    return { charge, error, refund, status: 'provider_failed' };
  }

  const taskId = input.taskIdOf?.(result);
  if (taskId && charge.charged && charge.entry) {
    try {
      await attachTaskIdToCreditLedgerEntry(input.db, charge.entry.id, taskId);
    } catch (error) {
      console.error(
        '[hosted-ai] could not attach task id to ledger entry',
        charge.entry.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { charge, result, status: 'accepted' };
}

export interface ReservedChargeSettlement {
  balance: number;
  creditsCharged: number;
  ledgerEntryId: string | null;
}

/**
 * Settles a reservation against the provider's actual usage. The reservation
 * is an upper bound: when the provider billed less, the difference is refunded
 * as an idempotent adjustment; it is never topped up beyond the amount the
 * user was quoted, so a settlement can not overdraw the balance.
 */
export async function settleReservedHostedCharge(input: {
  actualCredits: number;
  charge: SpendCreditsResult;
  db: AppD1Database;
  idempotencyKey: string;
  ledgerSource: string;
  metadata?: Record<string, unknown> | null;
  userId: string;
}): Promise<ReservedChargeSettlement> {
  const { charge } = input;
  if (!charge.charged || !charge.entry) {
    return { balance: charge.balance, creditsCharged: 0, ledgerEntryId: charge.entry?.id ?? null };
  }

  const reserved = Math.abs(charge.entry.amount);
  const actual = Math.max(0, Math.min(reserved, Math.floor(input.actualCredits)));
  const refund = reserved - actual;
  if (refund <= 0) {
    return { balance: charge.balance, creditsCharged: reserved, ledgerEntryId: charge.entry.id };
  }

  const adjustment = await appendCreditLedgerEntry(input.db, {
    amount: refund,
    description: 'Hosted AI usage settlement refund',
    entryType: 'adjustment',
    metadata: {
      ...(input.metadata ?? {}),
      actualCredits: actual,
      originalLedgerEntryId: charge.entry.id,
      reservedCredits: reserved,
    },
    source: `${input.ledgerSource}:settlement`,
    sourceId: input.idempotencyKey,
    userId: input.userId,
  });

  return {
    balance: adjustment?.balance_after ?? charge.balance,
    creditsCharged: actual,
    ledgerEntryId: charge.entry.id,
  };
}
