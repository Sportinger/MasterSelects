import { useAccountStore } from '../../stores/accountStore';
import {
  activeCreditActivityCount,
  useCreditActivityStore,
  type CreditActivityTerminalStatus,
  type CreditVisualSettlementKind,
} from '../../stores/creditActivityStore';

export interface ConfirmedCreditUpdate {
  activityId?: string;
  activityTotalCredits?: number;
  balance: number;
  credits: number;
  kind: CreditVisualSettlementKind;
  mutationId: string;
  source: string;
}

const MAX_PROCESSED_MUTATIONS = 512;
const processedMutations = new Set<string>();
const processedMutationOrder: string[] = [];
// Initialize from the live account store so a Vite hot update during an
// in-flight agent turn does not mistake the same account for a user switch and
// erase the confirmed RUN total. Real login/logout changes still flow through
// the account-store subscription below.
let coordinatorUserId: string | null = useAccountStore.getState().user?.id ?? null;
let reconciliationTimer: ReturnType<typeof setTimeout> | null = null;

function finiteCredits(value: number): number {
  return Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
}

function rememberMutation(mutationId: string): boolean {
  if (processedMutations.has(mutationId)) {
    return false;
  }
  processedMutations.add(mutationId);
  processedMutationOrder.push(mutationId);
  while (processedMutationOrder.length > MAX_PROCESSED_MUTATIONS) {
    const expired = processedMutationOrder.shift();
    if (expired) processedMutations.delete(expired);
  }
  return true;
}

export function syncCreditRuntimeUser(userId: string | null): void {
  if (coordinatorUserId === userId) return;
  coordinatorUserId = userId;
  processedMutations.clear();
  processedMutationOrder.length = 0;
  if (reconciliationTimer) {
    clearTimeout(reconciliationTimer);
    reconciliationTimer = null;
  }
  useCreditActivityStore.getState().reset();
}

useAccountStore.subscribe((state, previousState) => {
  const nextUserId = state.user?.id ?? null;
  const previousUserId = previousState.user?.id ?? null;
  if (nextUserId !== previousUserId) {
    syncCreditRuntimeUser(nextUserId);
  }
});

function syncCurrentUser(): void {
  syncCreditRuntimeUser(useAccountStore.getState().user?.id ?? null);
}

export function beginCreditActivity(input: {
  feature: string;
  id: string;
  targetId?: string;
}): void {
  syncCurrentUser();
  useCreditActivityStore.getState().beginActivity(input);
}

export function recordCreditActivityTotal(activityId: string, totalCredits: number): void {
  syncCurrentUser();
  useCreditActivityStore.getState().recordActivityTotal(activityId, totalCredits);
}

export function reconcileCreditBalance(balance: number): void {
  const safeBalance = finiteCredits(balance);
  useAccountStore.getState().applyHostedCreditBalance(safeBalance);
}

export function applyConfirmedCreditUpdate(update: ConfirmedCreditUpdate): boolean {
  syncCurrentUser();
  const credits = finiteCredits(update.credits);
  const balance = finiteCredits(update.balance);
  const mutationId = update.mutationId.trim();
  if (!mutationId) return false;

  if (update.activityId && update.activityTotalCredits !== undefined) {
    useCreditActivityStore.getState().recordActivityTotal(
      update.activityId,
      update.activityTotalCredits,
    );
  }
  if (!rememberMutation(mutationId)) {
    return false;
  }

  const account = useAccountStore.getState();
  const previousBalance = finiteCredits(account.creditBalance);
  const canAnimate = account.isInitialized && Boolean(account.session?.authenticated);
  const nextBalance = update.kind === 'debit' && canAnimate
    ? Math.min(previousBalance, balance)
    : balance;

  account.applyHostedCreditBalance(nextBalance);

  if (update.kind === 'debit' && update.activityTotalCredits === undefined) {
    useCreditActivityStore.getState().recordActivityDebit(update.activityId, credits);
  }

  const visibleChange = update.kind === 'debit'
    ? nextBalance < previousBalance
    : nextBalance > previousBalance;
  if (!canAnimate || credits === 0 || !visibleChange) {
    return true;
  }

  const activity = update.activityId
    ? useCreditActivityStore.getState().activities[update.activityId]
    : undefined;
  useCreditActivityStore.getState().pushVisualSettlement({
    activityId: update.activityId,
    createdAt: Date.now(),
    credits,
    fromBalance: previousBalance,
    id: `${mutationId}:${Date.now()}`,
    kind: update.kind,
    mutationId,
    source: update.source,
    targetId: activity?.targetId,
    toBalance: nextBalance,
  });
  return true;
}

export function scheduleCreditAccountReconciliation(delayMs = 350): void {
  if (reconciliationTimer) clearTimeout(reconciliationTimer);
  reconciliationTimer = setTimeout(() => {
    reconciliationTimer = null;
    void useAccountStore.getState().loadAccountState();
  }, Math.max(0, delayMs));
}

export function endCreditActivity(input: {
  id: string;
  status: CreditActivityTerminalStatus;
}): void {
  syncCurrentUser();
  useCreditActivityStore.getState().endActivity(input.id, input.status);
  if (activeCreditActivityCount() === 0) {
    scheduleCreditAccountReconciliation();
  }
}

export function resetCreditCoordinatorForTests(): void {
  coordinatorUserId = null;
  processedMutations.clear();
  processedMutationOrder.length = 0;
  if (reconciliationTimer) clearTimeout(reconciliationTimer);
  reconciliationTimer = null;
  useCreditActivityStore.getState().reset();
}
