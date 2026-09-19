import { describe, expect, it, vi } from 'vitest';
import { refundCreditsForFailedTask } from '../../functions/lib/credits';
import {
  runReservedHostedCharge,
  settleReservedHostedCharge,
} from '../../functions/lib/providers/hostedChargeFlow';
import { createCreditLedgerDb, grantRow } from './support/creditLedgerDb';

const baseInput = {
  creditsRequired: 25,
  description: 'Hosted test generation',
  idempotencyKey: 'idem-1',
  ledgerSource: 'hosted:test_generation',
  metadata: { provider: 'test', requestId: 'req-1' },
  userId: 'user-1',
};

describe('runReservedHostedCharge', () => {
  it('reserves credits before the provider runs and attaches the task id afterwards', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);
    const order: string[] = [];
    const createTask = vi.fn(async () => {
      order.push(`provider:balance=${rows.reduce((sum, row) => sum + row.amount, 0)}`);
      return { taskId: 'task-42' };
    });

    const outcome = await runReservedHostedCharge({
      ...baseInput,
      createTask,
      db,
      taskIdOf: (task) => task.taskId,
    });

    expect(outcome.status).toBe('accepted');
    expect(order).toEqual(['provider:balance=75']);
    const spend = rows.find((row) => row.entry_type === 'spend');
    expect(JSON.parse(spend?.metadata_json ?? '{}')).toMatchObject({ provider: 'test', taskId: 'task-42' });

    // The failed-task refund path still finds the charge through the task id.
    const refund = await refundCreditsForFailedTask(db, 'user-1', 'task-42');
    expect(refund).toMatchObject({ credits: 25, refunded: true, creditBalance: 100 });
  });

  it('does not call the provider when the balance is insufficient', async () => {
    const { db } = createCreditLedgerDb([grantRow('user-1', 5)]);
    const createTask = vi.fn(async () => ({ taskId: 'never' }));

    const outcome = await runReservedHostedCharge({ ...baseInput, createTask, db });

    expect(outcome.status).toBe('insufficient');
    expect(outcome.charge.balance).toBe(5);
    expect(createTask).not.toHaveBeenCalled();
  });

  it('refunds the reservation when the provider call fails', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);

    const outcome = await runReservedHostedCharge({
      ...baseInput,
      createTask: async () => {
        throw new Error('upstream 502');
      },
      db,
    });

    expect(outcome.status).toBe('provider_failed');
    if (outcome.status !== 'provider_failed') throw new Error('unreachable');
    expect(outcome.refund).toMatchObject({ credits: 25, refunded: true, creditBalance: 100 });
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(100);
    expect(rows.find((row) => row.entry_type === 'adjustment')).toMatchObject({
      amount: 25,
      source: 'refund:hosted:test_generation',
      source_id: 'failed-charge:idem-1',
    });
  });

  it('never refunds an idempotent repeat that charged nothing', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);
    await runReservedHostedCharge({ ...baseInput, createTask: async () => ({ taskId: 'task-1' }), db });

    const repeat = await runReservedHostedCharge({
      ...baseInput,
      createTask: async () => {
        throw new Error('upstream 502');
      },
      db,
    });

    expect(repeat.status).toBe('provider_failed');
    if (repeat.status !== 'provider_failed') throw new Error('unreachable');
    expect(repeat.charge.charged).toBe(false);
    expect(repeat.refund).toBeNull();
    expect(rows.reduce((sum, row) => sum + row.amount, 0)).toBe(75);
  });
});

describe('settleReservedHostedCharge', () => {
  it('refunds the difference when the provider billed less than the reservation', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);
    const outcome = await runReservedHostedCharge({ ...baseInput, createTask: async () => ({ ok: true }), db });
    if (outcome.status !== 'accepted') throw new Error('unreachable');

    const settlement = await settleReservedHostedCharge({
      actualCredits: 18,
      charge: outcome.charge,
      db,
      idempotencyKey: 'idem-1',
      ledgerSource: 'hosted:test_generation',
      userId: 'user-1',
    });

    expect(settlement).toEqual({ balance: 82, creditsCharged: 18, ledgerEntryId: outcome.charge.entry?.id });
    expect(rows.find((row) => row.entry_type === 'adjustment')).toMatchObject({
      amount: 7,
      source: 'hosted:test_generation:settlement',
      source_id: 'idem-1',
    });
  });

  it('never charges above the reservation and skips settlement for repeats', async () => {
    const { db, rows } = createCreditLedgerDb([grantRow('user-1', 100)]);
    const outcome = await runReservedHostedCharge({ ...baseInput, createTask: async () => ({ ok: true }), db });
    if (outcome.status !== 'accepted') throw new Error('unreachable');

    const capped = await settleReservedHostedCharge({
      actualCredits: 40,
      charge: outcome.charge,
      db,
      idempotencyKey: 'idem-1',
      ledgerSource: 'hosted:test_generation',
      userId: 'user-1',
    });
    expect(capped).toEqual({ balance: 75, creditsCharged: 25, ledgerEntryId: outcome.charge.entry?.id });
    expect(rows).toHaveLength(2);

    const repeat = await runReservedHostedCharge({ ...baseInput, createTask: async () => ({ ok: true }), db });
    if (repeat.status !== 'accepted') throw new Error('unreachable');
    const untouched = await settleReservedHostedCharge({
      actualCredits: 1,
      charge: repeat.charge,
      db,
      idempotencyKey: 'idem-1',
      ledgerSource: 'hosted:test_generation',
      userId: 'user-1',
    });
    expect(untouched.creditsCharged).toBe(0);
    expect(rows).toHaveLength(2);
  });
});
