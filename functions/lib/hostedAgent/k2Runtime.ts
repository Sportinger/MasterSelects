import {
  runHostedAgentK1,
  type RunHostedAgentK1Input,
} from './k1Runtime';
import { HostedAgentK2MemorySessionStore } from './k2Session';
import type {
  HostedAgentK1RuntimeResult,
  HostedAgentK2SessionStatus,
} from '../../../src/services/kernelClient/hostedAgent/contracts';

export interface RunHostedAgentK2Input extends Omit<
  RunHostedAgentK1Input,
  'bridge' | 'onEvent' | 'sessionId' | 'signal'
> {
  sessionId: string;
  sessions: HostedAgentK2MemorySessionStore;
}

export type HostedAgentK2RuntimeResult =
  | HostedAgentK1RuntimeResult
  | {
      status: 'cancelled' | 'interrupted';
    };

/**
 * Couples the K1 provider loop to the K2 replayable session boundary. The
 * semantic editor still runs client-side; this bridge only waits for the
 * exactly-once grouped result posted by that page.
 */
export async function runHostedAgentK2(
  input: RunHostedAgentK2Input,
): Promise<HostedAgentK2RuntimeResult> {
  try {
    return await runHostedAgentK1({
      ...input,
      bridge: {
        executeToolBatch: async (batch) => input.sessions.waitForToolResults({
          sequence: batch.sequence,
          sessionId: input.sessionId,
          signal: input.sessions.runtimeSignal(input.sessionId),
        }),
      },
      onEvent: (event) => {
        input.sessions.appendRuntimeEvent(input.sessionId, event);
      },
      sessionId: input.sessionId,
      signal: input.sessions.runtimeSignal(input.sessionId),
    });
  } catch (runtimeError) {
    const status = input.sessions.getStatus(input.sessionId);
    if (status === 'cancelled' || status === 'interrupted') {
      return { status };
    }
    throw runtimeError;
  }
}

export async function cancelHostedAgentK2Session(input: {
  clientInstanceId: string;
  leaseToken: string;
  onCancelBilling?: () => Promise<void>;
  sessionId: string;
  sessions: HostedAgentK2MemorySessionStore;
  turnId: string;
}): Promise<void> {
  await input.sessions.cancel(input);
  await input.onCancelBilling?.();
}

export async function interruptHostedAgentK2SessionForReload(input: {
  clientInstanceId: string;
  leaseToken: string;
  onInterruptBilling?: () => Promise<void>;
  sessionId: string;
  sessions: HostedAgentK2MemorySessionStore;
  turnId: string;
}): Promise<void> {
  await input.sessions.interruptForReload(input);
  await input.onInterruptBilling?.();
}

export function hostedAgentK2Status(
  sessions: HostedAgentK2MemorySessionStore,
  sessionId: string,
): HostedAgentK2SessionStatus {
  return sessions.getStatus(sessionId);
}
