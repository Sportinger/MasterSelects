import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillingSummaryResponse } from '../../src/services/cloudApi';
import {
  applyConfirmedCreditUpdate,
  beginCreditActivity,
  endCreditActivity,
  recordCreditActivityTotal,
  resetCreditCoordinatorForTests,
} from '../../src/services/credits/creditBalanceCoordinator';
import { useAccountStore } from '../../src/stores/accountStore';
import { useCreditActivityStore } from '../../src/stores/creditActivityStore';

function billingSummary(creditBalance: number): BillingSummaryResponse {
  return {
    creditBalance,
    creditMeterReference: 250,
  } as BillingSummaryResponse;
}

function setAuthenticatedAccount(creditBalance = 200, userId = 'user-1'): void {
  useAccountStore.setState({
    billingSummary: billingSummary(creditBalance),
    creditBalance,
    creditMeterReference: 250,
    dialog: null,
    isInitialized: true,
    session: { authenticated: true, provider: 'magic_link' },
    user: { email: `${userId}@example.com`, id: userId },
  });
}

describe('creditBalanceCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetCreditCoordinatorForTests();
    setAuthenticatedAccount();
  });

  afterEach(() => {
    resetCreditCoordinatorForTests();
    vi.useRealTimers();
  });

  it('deduplicates mutations, mirrors balances, and never restores a debit from a late snapshot', () => {
    beginCreditActivity({ feature: 'AI video', id: 'video-1' });

    const firstAccepted = applyConfirmedCreditUpdate({
      activityId: 'video-1',
      balance: 180,
      credits: 20,
      kind: 'debit',
      mutationId: 'debit:hosted:video:ledger-1',
      source: 'hosted:video',
    });
    const replayAccepted = applyConfirmedCreditUpdate({
      activityId: 'video-1',
      balance: 180,
      credits: 20,
      kind: 'debit',
      mutationId: 'debit:hosted:video:ledger-1',
      source: 'hosted:video',
    });
    applyConfirmedCreditUpdate({
      activityId: 'video-1',
      balance: 190,
      credits: 1,
      kind: 'debit',
      mutationId: 'debit:hosted:video:ledger-late',
      source: 'hosted:video',
    });

    expect(firstAccepted).toBe(true);
    expect(replayAccepted).toBe(false);
    expect(useAccountStore.getState()).toMatchObject({
      creditBalance: 180,
      creditMeterReference: 250,
    });
    expect(useAccountStore.getState().billingSummary?.creditBalance).toBe(180);
    expect(useCreditActivityStore.getState()).toMatchObject({
      sessionConfirmedCredits: 21,
    });
    expect(useCreditActivityStore.getState().activities['video-1']?.confirmedCredits).toBe(21);
    expect(useCreditActivityStore.getState().visualSettlements).toHaveLength(1);
  });

  it('uses cumulative-max agent totals across settlement replay and terminal reconciliation', () => {
    beginCreditActivity({ feature: 'AI agent', id: 'turn-1' });

    applyConfirmedCreditUpdate({
      activityId: 'turn-1',
      activityTotalCredits: 3,
      balance: 197,
      credits: 3,
      kind: 'debit',
      mutationId: 'debit:hosted:ai_chat:ledger-1',
      source: 'hosted:ai_chat',
    });
    applyConfirmedCreditUpdate({
      activityId: 'turn-1',
      activityTotalCredits: 3,
      balance: 197,
      credits: 3,
      kind: 'debit',
      mutationId: 'debit:hosted:ai_chat:ledger-1',
      source: 'hosted:ai_chat',
    });
    applyConfirmedCreditUpdate({
      activityId: 'turn-1',
      activityTotalCredits: 7,
      balance: 193,
      credits: 4,
      kind: 'debit',
      mutationId: 'debit:hosted:ai_chat:ledger-2',
      source: 'hosted:ai_chat',
    });
    recordCreditActivityTotal('turn-1', 7);

    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(7);
    expect(useCreditActivityStore.getState().activities['turn-1']?.confirmedCredits).toBe(7);

    endCreditActivity({ id: 'turn-1', status: 'completed' });
    expect(useCreditActivityStore.getState()).toMatchObject({
      activities: {},
      terminalSummary: { credits: 7, status: 'completed' },
    });
  });

  it('accepts pre-initialization balance as a non-animated bootstrap instead of minning against zero', () => {
    useAccountStore.setState({
      billingSummary: null,
      creditBalance: 0,
      creditMeterReference: 0,
      isInitialized: false,
      session: null,
      user: { email: 'user-1@example.com', id: 'user-1' },
    });
    beginCreditActivity({ feature: 'AI transcription', id: 'transcription-1' });

    applyConfirmedCreditUpdate({
      activityId: 'transcription-1',
      balance: 90,
      credits: 10,
      kind: 'debit',
      mutationId: 'debit:hosted:transcription:ledger-1',
      source: 'hosted:transcription',
    });

    expect(useAccountStore.getState().creditBalance).toBe(90);
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(10);
    expect(useCreditActivityStore.getState().visualSettlements).toEqual([]);
  });

  it('allows positive mutations while keeping no-op refund replays silent', () => {
    applyConfirmedCreditUpdate({
      balance: 220,
      credits: 20,
      kind: 'grant',
      mutationId: 'grant:claim:ledger-1',
      source: 'claim',
    });
    const replayAccepted = applyConfirmedCreditUpdate({
      balance: 220,
      credits: 20,
      kind: 'grant',
      mutationId: 'grant:claim:ledger-1',
      source: 'claim',
    });

    expect(replayAccepted).toBe(false);
    expect(useAccountStore.getState().creditBalance).toBe(220);
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(0);
    expect(useCreditActivityStore.getState().visualSettlements).toHaveLength(1);
    expect(useCreditActivityStore.getState().visualSettlements[0]).toMatchObject({
      credits: 20,
      kind: 'grant',
    });
  });

  it('accepts a zero-cost protocol settlement without inventing run spend or motion', () => {
    beginCreditActivity({ feature: 'AI agent', id: 'turn-free' });
    const accepted = applyConfirmedCreditUpdate({
      activityId: 'turn-free',
      activityTotalCredits: 0,
      balance: 200,
      credits: 0,
      kind: 'debit',
      mutationId: 'debit:hosted:ai_chat:zero-cost-round',
      source: 'hosted:ai_chat',
    });

    expect(accepted).toBe(true);
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(0);
    expect(useCreditActivityStore.getState().visualSettlements).toEqual([]);
    expect(useAccountStore.getState().creditBalance).toBe(200);
  });

  it('clears user-bound activities and mutation dedupe state on account switch', () => {
    beginCreditActivity({ feature: 'AI chat', id: 'chat-1' });
    applyConfirmedCreditUpdate({
      activityId: 'chat-1',
      balance: 190,
      credits: 10,
      kind: 'debit',
      mutationId: 'debit:hosted:chat:shared-ledger-id',
      source: 'hosted:chat',
    });

    setAuthenticatedAccount(300, 'user-2');
    expect(useCreditActivityStore.getState().activities).toEqual({});
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(0);
    beginCreditActivity({ feature: 'AI chat', id: 'chat-2' });
    const acceptedForSecondUser = applyConfirmedCreditUpdate({
      activityId: 'chat-2',
      balance: 290,
      credits: 10,
      kind: 'debit',
      mutationId: 'debit:hosted:chat:shared-ledger-id',
      source: 'hosted:chat',
    });

    expect(acceptedForSecondUser).toBe(true);
    expect(useCreditActivityStore.getState().activities).not.toHaveProperty('chat-1');
    expect(useCreditActivityStore.getState().activities).toHaveProperty('chat-2');
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(10);
  });

  it('clears ephemeral credit state immediately on logout', () => {
    beginCreditActivity({ feature: 'AI chat', id: 'chat-logout' });
    applyConfirmedCreditUpdate({
      activityId: 'chat-logout',
      balance: 190,
      credits: 10,
      kind: 'debit',
      mutationId: 'debit:hosted:chat:logout-ledger',
      source: 'hosted:chat',
    });

    useAccountStore.setState({ session: null, user: null });

    expect(useCreditActivityStore.getState()).toMatchObject({
      activities: {},
      sessionConfirmedCredits: 0,
      terminalSummary: null,
      visualSettlements: [],
    });
  });

  it('caps decorative settlement retention', () => {
    beginCreditActivity({ feature: 'AI generation', id: 'generation-1' });
    for (let index = 0; index < 40; index += 1) {
      applyConfirmedCreditUpdate({
        activityId: 'generation-1',
        balance: 199 - index,
        credits: 1,
        kind: 'debit',
        mutationId: `debit:hosted:generation:ledger-${index}`,
        source: 'hosted:generation',
      });
    }

    expect(useCreditActivityStore.getState().visualSettlements).toHaveLength(24);
    expect(useCreditActivityStore.getState().sessionConfirmedCredits).toBe(40);
  });
});
