import type {
  HostedAgentK1BillingPort,
  HostedAgentK1ClientBridge,
} from './k1Runtime';
import type {
  HostedAgentK1ProviderRoundRequest,
  HostedAgentK1ProviderRoundResponse,
  HostedAgentK1ToolBatchResult,
} from '../../../src/services/kernelClient/hostedAgent/contracts';
import type { HostedAgentK1Provider } from './k1Provider';

export interface HostedAgentK1ReplayProvider extends HostedAgentK1Provider {
  readonly requests: HostedAgentK1ProviderRoundRequest[];
}

export interface HostedAgentK1RecordedBridge extends HostedAgentK1ClientBridge {
  readonly requests: Array<Parameters<HostedAgentK1ClientBridge['executeToolBatch']>[0]>;
  readonly results: HostedAgentK1ToolBatchResult[];
}

export interface HostedAgentK1RecordedBilling extends HostedAgentK1BillingPort {
  readonly authorizations: Array<Parameters<HostedAgentK1BillingPort['authorizeRound']>[0]>;
  readonly completions: Array<Parameters<HostedAgentK1BillingPort['completeTurn']>[0]>;
  readonly settlements: Array<Parameters<HostedAgentK1BillingPort['settleRound']>[0]>;
  readonly totalCreditsCharged: number;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createHostedAgentK1ReplayProvider(
  responses: HostedAgentK1ProviderRoundResponse[],
): HostedAgentK1ReplayProvider {
  const requests: HostedAgentK1ProviderRoundRequest[] = [];
  let cursor = 0;
  return {
    requests,
    async complete(request): Promise<HostedAgentK1ProviderRoundResponse> {
      requests.push(clone(request));
      const response = responses[cursor];
      if (!response) {
        throw new Error(`No recorded provider response exists for round ${cursor}.`);
      }
      cursor += 1;
      return clone(response);
    },
  };
}

export function createHostedAgentK1RecordedBridge(
  execute: (
    input: Parameters<HostedAgentK1ClientBridge['executeToolBatch']>[0],
  ) => Promise<HostedAgentK1ToolBatchResult> | HostedAgentK1ToolBatchResult,
): HostedAgentK1RecordedBridge {
  const requests: HostedAgentK1RecordedBridge['requests'] = [];
  const results: HostedAgentK1ToolBatchResult[] = [];
  return {
    requests,
    results,
    async executeToolBatch(input): Promise<HostedAgentK1ToolBatchResult> {
      requests.push(clone(input));
      const result = await execute(clone(input));
      results.push(clone(result));
      return result;
    },
  };
}

export function createHostedAgentK1RecordedBilling(): HostedAgentK1RecordedBilling {
  const authorizations: HostedAgentK1RecordedBilling['authorizations'] = [];
  const completions: HostedAgentK1RecordedBilling['completions'] = [];
  const settlements: HostedAgentK1RecordedBilling['settlements'] = [];
  const settledByKey = new Map<string, number>();
  let nextRoundIndex = 0;
  let completed = false;
  let maximumSpendCredits = 0;
  let maximumIterations = 0;
  let totalCreditsCharged = 0;

  return {
    authorizations,
    completions,
    settlements,
    get totalCreditsCharged() {
      return totalCreditsCharged;
    },
    async authorizeRound(input): Promise<void> {
      if (completed) {
        throw new Error('The recorded billing turn is already complete.');
      }
      if (
        input.roundIndex !== nextRoundIndex
        || input.roundIndex >= input.maximumIterations
      ) {
        throw new Error('The recorded billing turn rejected an out-of-sequence round.');
      }
      if (authorizations.length === 0) {
        maximumSpendCredits = input.maximumSpendCredits;
        maximumIterations = input.maximumIterations;
      } else if (
        maximumSpendCredits !== input.maximumSpendCredits
        || maximumIterations !== input.maximumIterations
      ) {
        throw new Error('The recorded billing limits changed during the turn.');
      }
      authorizations.push(clone(input));
    },
    async settleRound(input) {
      const replay = settledByKey.get(input.idempotencyKey);
      if (replay !== undefined) {
        return {
          creditBalance: maximumSpendCredits - totalCreditsCharged,
          creditsCharged: replay,
          ledgerEntryId: replay > 0 ? `recorded-ledger:${input.idempotencyKey}` : null,
          replayed: true,
          totalCreditsCharged,
        };
      }
      const authorization = authorizations.at(-1);
      if (!authorization || authorization.roundIndex !== input.roundIndex) {
        throw new Error('The recorded provider round lacks authorization.');
      }
      const credits = input.usage.providerCredits === null
        ? 5
        : Math.max(0, Math.ceil(input.usage.providerCredits * 6 - 1e-9));
      if (totalCreditsCharged + credits > maximumSpendCredits) {
        throw new Error('The recorded provider round exceeds maximum spend.');
      }
      totalCreditsCharged += credits;
      nextRoundIndex += 1;
      settlements.push(clone(input));
      settledByKey.set(input.idempotencyKey, credits);
      return {
        creditBalance: maximumSpendCredits - totalCreditsCharged,
        creditsCharged: credits,
        ledgerEntryId: credits > 0 ? `recorded-ledger:${input.idempotencyKey}` : null,
        replayed: false,
        totalCreditsCharged,
      };
    },
    async completeTurn(input) {
      if (nextRoundIndex === 0 || settlements.length !== authorizations.length) {
        throw new Error('The recorded billing turn cannot complete with unsettled rounds.');
      }
      completed = true;
      completions.push(clone(input));
      return { creditsCharged: totalCreditsCharged };
    },
  };
}
