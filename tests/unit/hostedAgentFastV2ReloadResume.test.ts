import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearHostedAgentFastV2ReloadSnapshot,
  hasHostedAgentFastV2ReloadSnapshot,
  readHostedAgentFastV2ReloadSnapshot,
  saveHostedAgentFastV2ReloadSnapshot,
} from '../../src/services/kernelClient/hostedAgent/fastV2ReloadResume';
import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  type HostedAgentFastV2StartRequest,
} from '../../src/services/kernelClient/hostedAgent/fastV2StartContract';

const STORAGE_KEY = 'masterselects.hostedAgent.fastV2.activeTurns.v1';

function request(
  executionProfile?: HostedAgentFastV2StartRequest['executionProfile'],
): HostedAgentFastV2StartRequest {
  return {
    clientInstanceId: 'client-v2',
    compactSnapshot: {
      payload: { clips: [], tracks: [] },
      schemaVersion: 1,
      stateFingerprint: `sha256:${'a'.repeat(64)}`,
      timelineRevision: 3,
    },
    editorBuildId: 'masterselects:2.4.4',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    ...(executionProfile === undefined ? {} : { executionProfile }),
    protocolVersion: 'fast-agent-v2',
    request: 'Inspect the timeline.',
    runSource: 'ui',
    turnId: 'turn-v2-resume',
    visualReferences: [],
  };
}

describe('Fast V2 reload resume snapshot', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.useRealTimers();
  });

  it('persists the exact revision-bound request and cursor', () => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '7',
      request: request(),
    });
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toMatchObject({
      assistantMessageId: 'message-v2',
      cursor: '7',
      request: {
        protocolVersion: 'fast-agent-v2',
        turnId: 'turn-v2-resume',
      },
      version: 1,
    });
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(true);

    clearHostedAgentFastV2ReloadSnapshot('message-v2');
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(false);
  });

  it.each([
    ['legacy missing-profile', undefined],
    ['explicit Fast', 'fast' as const],
  ])('keeps %s reload resume unchanged', (_label, executionProfile) => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '8',
      request: request(executionProfile),
    });

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toMatchObject({
      assistantMessageId: 'message-v2',
      cursor: '8',
      request: executionProfile === undefined
        ? { protocolVersion: 'fast-agent-v2' }
        : { executionProfile: 'fast', protocolVersion: 'fast-agent-v2' },
    });
  });

  it('does not persist Verified and removes a stale same-message Fast snapshot', () => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '7',
      request: request('fast'),
    });
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(true);

    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '8',
      request: request('verified'),
    });

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses to resume a stored Verified snapshot', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{
      assistantMessageId: 'message-v2',
      cursor: '7',
      request: request('verified'),
      updatedAt: Date.now(),
      version: 1,
    }]));

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(false);
  });

  it('rejects stored provider authority and expired snapshots', () => {
    const stored = {
      assistantMessageId: 'message-v2',
      cursor: null,
      request: { ...request(), systemPrompt: 'stored override' },
      updatedAt: Date.now(),
      version: 1,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([stored]));
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();

    delete stored.request.systemPrompt;
    stored.updatedAt = Date.now() - (11 * 60 * 1_000);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([stored]));
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
  });
});
