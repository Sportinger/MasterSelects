import type {
  HostedAgentEvent,
  HostedAgentK2BatchPostResponse,
  HostedAgentK2EventReplay,
} from './contracts';
import {
  HostedAgentFastV2UnsupportedOperationError,
  type HostedAgentFastV2FetchTransport,
} from './fastV2FetchTransport';
import type {
  HostedAgentK2ClientTransport,
} from './k2Client';

/**
 * Reuses the proven K2 cursor/operation state machine after the dedicated V2
 * parser has validated every event. V2 has no generic browser tool batches and
 * its fast-immediate profile never posts a settlement receipt.
 */
export function adaptHostedAgentFastV2TransportToK2(
  transport: HostedAgentFastV2FetchTransport,
): HostedAgentK2ClientTransport {
  return {
    async cancel(input) {
      await transport.cancel(input);
    },
    async interrupt(input) {
      await transport.cancel(input);
    },
    async postOperationResult(input): Promise<HostedAgentK2BatchPostResponse> {
      return transport.postOperationResult(input);
    },
    async postOperationSettlement(input): Promise<HostedAgentK2BatchPostResponse> {
      return transport.postOperationSettlement(input);
    },
    async postToolResults() {
      throw new HostedAgentFastV2UnsupportedOperationError(
        'Fast V2 does not accept client-authored provider tool results.',
      );
    },
    async replayEvents(input): Promise<HostedAgentK2EventReplay> {
      const replay = await transport.replayEvents(input);
      return {
        ...replay,
        // The strict V2 union has different session-ready pins, while every
        // event branch consumed by K2 is structurally identical at runtime.
        events: replay.events as unknown as HostedAgentEvent[],
      };
    },
  };
}
