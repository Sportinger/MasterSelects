// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
  HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
  HOSTED_AGENT_FAST_V2_MAX_START_BYTES,
  HOSTED_AGENT_FAST_V2_MAX_TIMELINE_TRANSCRIPT_WORDS,
  HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS,
  HostedAgentFastV2ContractError,
  parseHostedAgentFastV2StartRequest,
  resolveHostedAgentFastV2ExecutionProfile,
} from '../../src/services/kernelClient/hostedAgent/fastV2StartContract';

const FINGERPRINT =
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function validStartRequest(): Record<string, unknown> {
  return {
    clientInstanceId: 'client:v2:test',
    compactSnapshot: {
      payload: {
        clips: [{ duration: 4, startTime: 0, trackType: 'video' }],
        selectedClipIds: ['clip:1'],
      },
      schemaVersion: 1,
      stateFingerprint: FINGERPRINT,
      timelineRevision: 12,
    },
    editorBuildId: '2.4.4',
    executionContractDigest: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_DIGEST,
    executionContractVersion: HOSTED_AGENT_FAST_V2_EXECUTION_CONTRACT_VERSION,
    protocolVersion: 'fast-agent-v2',
    request: 'Remove the selected range.',
    requestedExecutionMode: 'normal',
    requestedModelClass: 'fast',
    runSource: 'ui',
    turnId: 'turn:v2:test',
    userPreferences: { locale: 'de-DE', preserveLinkedAudio: true },
    visualReferences: [],
  };
}

describe('Fast Agent V2 browser start contract', () => {
  it('pins the timeline transcript projection to 100,000 words', () => {
    expect(HOSTED_AGENT_FAST_V2_MAX_TIMELINE_TRANSCRIPT_WORDS).toBe(100_000);

    const accepted = validStartRequest();
    accepted.compactSnapshot = {
      ...(accepted.compactSnapshot as Record<string, unknown>),
      payload: {
        clips: [{
          transcript: {
            words: Array(HOSTED_AGENT_FAST_V2_MAX_TIMELINE_TRANSCRIPT_WORDS).fill(null),
          },
        }],
      },
    };
    expect(parseHostedAgentFastV2StartRequest(accepted).compactSnapshot.timelineRevision)
      .toBe(12);

    const rejected = structuredClone(accepted);
    const clips = ((rejected.compactSnapshot as Record<string, unknown>)
      .payload as Record<string, unknown>).clips as Array<Record<string, unknown>>;
    const transcript = clips[0]!.transcript as Record<string, unknown>;
    (transcript.words as unknown[]).push(null);
    expect(() => parseHostedAgentFastV2StartRequest(rejected))
      .toThrow(HostedAgentFastV2ContractError);
  });

  it('allows enough server-owned rounds for multi-stage editing workflows', () => {
    expect(HOSTED_AGENT_FAST_V2_MAXIMUM_ITERATIONS).toBe(24);
  });

  it('accepts only bounded user data plus the pinned public execution contract', () => {
    expect(parseHostedAgentFastV2StartRequest(validStartRequest())).toEqual(validStartRequest());
  });

  it('accepts only the three opaque server-owned model speed classes', () => {
    for (const requestedModelClass of ['very-fast', 'fast', 'slow'] as const) {
      expect(parseHostedAgentFastV2StartRequest({
        ...validStartRequest(),
        requestedModelClass,
      }).requestedModelClass).toBe(requestedModelClass);
    }
    for (const requestedModelClass of ['quality', 'gpt-5.6-sol', 'deepseek', '', null]) {
      expect(() => parseHostedAgentFastV2StartRequest({
        ...validStartRequest(),
        requestedModelClass,
      })).toThrow(HostedAgentFastV2ContractError);
    }
  });

  it('accepts only the semantic Logic agent mode and keeps standard as omission', () => {
    expect(parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      requestedAgentMode: 'logic',
    }).requestedAgentMode).toBe('logic');
    expect(parseHostedAgentFastV2StartRequest(validStartRequest()).requestedAgentMode)
      .toBeUndefined();

    for (const requestedAgentMode of ['standard', 'codex', 'openai', '', null]) {
      expect(() => parseHostedAgentFastV2StartRequest({
        ...validStartRequest(),
        requestedAgentMode,
      })).toThrow(HostedAgentFastV2ContractError);
    }
  });

  it('accepts only the Normal Path profile and resolves its legacy omission to fast', () => {
    const legacy = parseHostedAgentFastV2StartRequest(validStartRequest());
    expect(legacy.executionProfile).toBeUndefined();
    expect(resolveHostedAgentFastV2ExecutionProfile(legacy.executionProfile)).toBe('fast');

    const parsed = parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      executionProfile: 'fast',
    });
    expect(parsed.executionProfile).toBe('fast');
    expect(resolveHostedAgentFastV2ExecutionProfile(parsed.executionProfile)).toBe('fast');

    for (const invalid of [null, '', 'quality', 'verified', false]) {
      expect(() => resolveHostedAgentFastV2ExecutionProfile(invalid))
        .toThrow(HostedAgentFastV2ContractError);
      expect(() => parseHostedAgentFastV2StartRequest({
        ...validStartRequest(),
        executionProfile: invalid,
      })).toThrow(HostedAgentFastV2ContractError);
    }
  });

  it('accepts only a bounded Seedance preproduction run binding', () => {
    const preproductionRunId = 'seedance-preproduction-direct-edit-0001';
    expect(parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      preproductionRunId,
    }).preproductionRunId).toBe(preproductionRunId);

    for (const invalid of ['other-run-1', 'seedance-preproduction-short', '../seedance-run', '']) {
      expect(() => parseHostedAgentFastV2StartRequest({
        ...validStartRequest(),
        preproductionRunId: invalid,
      })).toThrow(HostedAgentFastV2ContractError);
    }
  });

  it.each([
    'clientCapabilities',
    'historyFormatVersion',
    'maximumIterations',
    'maximumOutputTokens',
    'maxTurnSpendCredits',
    'model',
    'modelPrompt',
    'playbookPrompt',
    'promptVersion',
    'providerInput',
    'reasoningEffort',
    'recoveryPolicy',
    'routePreference',
    'systemPrompt',
    'temperature',
    'toolSchemaVersion',
    'tools',
  ])('rejects client-authored authority field %s', (field) => {
    expect(() => parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      [field]: field === 'tools' ? [] : 'client override',
    })).toThrow(HostedAgentFastV2ContractError);
  });

  it('rejects execution-contract version or digest substitution', () => {
    expect(() => parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      executionContractVersion: 'client-contract-v99',
    })).toThrow(HostedAgentFastV2ContractError);
    expect(() => parseHostedAgentFastV2StartRequest({
      ...validStartRequest(),
      executionContractDigest:
        'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    })).toThrow(HostedAgentFastV2ContractError);
  });

  it('requires every turn to carry a revision-bound structural snapshot', () => {
    const withoutSnapshot = validStartRequest();
    delete withoutSnapshot.compactSnapshot;
    expect(() => parseHostedAgentFastV2StartRequest(withoutSnapshot))
      .toThrow(HostedAgentFastV2ContractError);

    const invalidRevision = validStartRequest();
    invalidRevision.compactSnapshot = {
      ...(invalidRevision.compactSnapshot as Record<string, unknown>),
      timelineRevision: 12.5,
    };
    expect(() => parseHostedAgentFastV2StartRequest(invalidRevision))
      .toThrow(HostedAgentFastV2ContractError);
  });

  it('rejects hidden binary/provider content and prototype-path keys in snapshot data', () => {
    const dataUrl = validStartRequest();
    dataUrl.compactSnapshot = {
      ...(dataUrl.compactSnapshot as Record<string, unknown>),
      payload: { image: 'data:image/png;base64,AAAA' },
    };
    expect(() => parseHostedAgentFastV2StartRequest(dataUrl))
      .toThrow(HostedAgentFastV2ContractError);

    const prototypePath = validStartRequest();
    prototypePath.compactSnapshot = {
      ...(prototypePath.compactSnapshot as Record<string, unknown>),
      payload: JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
    };
    expect(() => parseHostedAgentFastV2StartRequest(prototypePath))
      .toThrow(HostedAgentFastV2ContractError);
  });

  it('accepts bounded initial visual data only through the explicit visual channel', () => {
    const request = validStartRequest();
    request.visualReferences = [{
      id: 'reference:1',
      mediaType: 'image/png',
      role: 'initial',
      source: 'data:image/png;base64,AAAA',
      transport: 'data-url',
    }];
    expect(parseHostedAgentFastV2StartRequest(request).visualReferences).toHaveLength(1);

    (request.visualReferences as Array<Record<string, unknown>>)[0]!.role = 'tool-result';
    expect(() => parseHostedAgentFastV2StartRequest(request))
      .toThrow(HostedAgentFastV2ContractError);
  });

  it('admits substantially larger sessions and keeps one canonical UTF-8 ceiling', () => {
    const formerlyOversized = validStartRequest();
    formerlyOversized.visualReferences = [1, 2].map((index) => ({
      id: `reference-${index}`,
      mediaType: 'image/png',
      role: 'initial',
      source: `data:image/png;base64,${'A'.repeat(700_000)}`,
      transport: 'data-url',
    }));
    expect(parseHostedAgentFastV2StartRequest(formerlyOversized).visualReferences)
      .toHaveLength(2);

    const oversized = validStartRequest();
    oversized.compactSnapshot = {
      ...(oversized.compactSnapshot as Record<string, unknown>),
      payload: {
        largeBlocks: Array.from({ length: 504 }, () => 'A'.repeat(100_000)),
      },
    };
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength)
      .toBeGreaterThan(HOSTED_AGENT_FAST_V2_MAX_START_BYTES);
    expect(() => parseHostedAgentFastV2StartRequest(oversized))
      .toThrow('canonical total byte bound');
  });

  it('accepts semantic snapshots above the former 250,000-node ceiling', () => {
    const request = validStartRequest();
    request.compactSnapshot = {
      ...(request.compactSnapshot as Record<string, unknown>),
      payload: {
        sourceWindows: Object.fromEntries(Array.from(
          { length: 600 },
          (_, index) => [`source-${index}`, Array.from({ length: 600 }, () => 0)],
        )),
      },
    };

    expect(parseHostedAgentFastV2StartRequest(request).compactSnapshot.timelineRevision)
      .toBe(12);
  });
});
