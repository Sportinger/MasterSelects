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
import type { HostedAgentK2OperationCheckpoint } from '../../src/services/kernelClient/hostedAgent/k2Client';

const STORAGE_KEY = 'masterselects.hostedAgent.fastV2.activeTurns.v3';

const timelineCheckpoint = {
  timelineRevision: 17,
  timelineStateCanonical: '[["video:0","video",0,1,0,1,null]]',
};

function request(
  executionProfile?: HostedAgentFastV2StartRequest['executionProfile'] | 'verified',
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
  } as unknown as HostedAgentFastV2StartRequest;
}

function operationCheckpoint(nextSequence = 3): HostedAgentK2OperationCheckpoint {
  const now = Date.now();
  return {
    descriptor: {
      allowedEffects: [],
      allowedOperationIds: ['timeline.editor.inspect.v1'],
      authoritySource: 'same-origin-authenticated-kernel-proxy-v1',
      capabilitySetId: 'fast-v2-test',
      clientInstanceId: 'client-v2',
      contractDigest: `sha256:${'b'.repeat(64)}`,
      contractVersion: 'test-contract-v1',
      expiresAtEpochMs: now + 60_000,
      initialPlanSequence: 0,
      issuedAtEpochMs: now,
      planDigest: `sha256:${'c'.repeat(64)}`,
      planVersion: 'test-plan-v1',
      schemaVersion: 1,
      sessionId: 'session-v2',
      turnId: 'turn-v2-resume',
    },
    nextSequence,
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
      operationCheckpoint: null,
      request: request(),
      ...timelineCheckpoint,
    });
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toMatchObject({
      assistantMessageId: 'message-v2',
      cursor: '7',
      request: {
        protocolVersion: 'fast-agent-v2',
        turnId: 'turn-v2-resume',
      },
      ...timelineCheckpoint,
      version: 3,
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
      operationCheckpoint: null,
      request: request(executionProfile),
      ...timelineCheckpoint,
    });

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toMatchObject({
      assistantMessageId: 'message-v2',
      cursor: '8',
      request: executionProfile === undefined
        ? { protocolVersion: 'fast-agent-v2' }
        : { executionProfile: 'fast', protocolVersion: 'fast-agent-v2' },
    });
  });

  it('does not persist a removed profile and removes a stale same-message snapshot', () => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '7',
      operationCheckpoint: null,
      request: request('fast'),
      ...timelineCheckpoint,
    });
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(true);

    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '8',
      operationCheckpoint: null,
      request: request('verified'),
      ...timelineCheckpoint,
    });

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(false);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('refuses to resume a stored snapshot with a removed profile', () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{
      assistantMessageId: 'message-v2',
      cursor: '7',
      operationCheckpoint: null,
      request: request('verified'),
      ...timelineCheckpoint,
      updatedAt: Date.now(),
      version: 3,
    }]));

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
    expect(hasHostedAgentFastV2ReloadSnapshot('message-v2')).toBe(false);
  });

  it('rejects stored provider authority and expired snapshots', () => {
    const stored = {
      assistantMessageId: 'message-v2',
      cursor: null,
      operationCheckpoint: null,
      request: { ...request(), systemPrompt: 'stored override' },
      ...timelineCheckpoint,
      updatedAt: Date.now(),
      version: 3,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([stored]));
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();

    delete stored.request.systemPrompt;
    stored.updatedAt = Date.now() - (11 * 60 * 1_000);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([stored]));
    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
  });

  it('persists the authenticated operation descriptor and next sequence together', () => {
    saveHostedAgentFastV2ReloadSnapshot({
      assistantMessageId: 'message-v2',
      cursor: '12',
      operationCheckpoint: operationCheckpoint(5),
      request: request('fast'),
      ...timelineCheckpoint,
    });

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toMatchObject({
      cursor: '12',
      operationCheckpoint: {
        descriptor: {
          clientInstanceId: 'client-v2',
          sessionId: 'session-v2',
          turnId: 'turn-v2-resume',
        },
        nextSequence: 5,
      },
      version: 3,
    });
  });

  it('rejects an operation checkpoint bound to another turn', () => {
    const checkpoint = operationCheckpoint();
    checkpoint.descriptor.turnId = 'other-turn';
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([{
      assistantMessageId: 'message-v2',
      cursor: '12',
      operationCheckpoint: checkpoint,
      request: request('fast'),
      ...timelineCheckpoint,
      updatedAt: Date.now(),
      version: 3,
    }]));

    expect(readHostedAgentFastV2ReloadSnapshot('message-v2')).toBeNull();
  });
});
