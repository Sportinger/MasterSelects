import { describe, expect, it, vi } from 'vitest';

import { forwardHostedAgentRequest } from '../../functions/lib/hostedAgent/proxy';
import {
  HostedAgentK2MemoryLargeResultStore,
  HostedAgentK2MemorySessionStore,
} from '../../functions/lib/hostedAgent/k2Session';
import {
  HOSTED_AGENT_HEADERS,
  HostedAgentK2ClientSession,
  createHostedAgentK2FetchTransport,
  parseHostedAgentK2Sse,
  type HostedAgentEvent,
  type HostedAgentK1ToolBatchResult,
  type HostedAgentK2ClientTransport,
} from '../../src/services/kernelClient/hostedAgent';
import type { Env } from '../../functions/lib/env';

const CLIENT_ID = 'client-k2-security';
const SESSION_ID = 'session-k2-security';
const TURN_ID = 'turn-k2-security';
const TOOL_SCHEMA = 'tools-v1';

function toolEvent(
  sequence = 0,
): Extract<HostedAgentEvent, { kind: 'tool-batch-request' }> {
  return {
    eventId: String(sequence + 1),
    kind: 'tool-batch-request',
    roundIndex: sequence,
    sequence,
    sessionId: SESSION_ID,
    toolCalls: [{
      args: {},
      toolCallId: `tool-${sequence}`,
      toolName: 'getTimelineState',
    }],
    toolSchemaVersion: TOOL_SCHEMA,
    turnId: TURN_ID,
  };
}

function batch(
  modelContent: string,
  imageResultRefs?: string[],
): HostedAgentK1ToolBatchResult {
  return {
    authority: {
      approval: 'not-required',
      executionMode: 'read-only',
      policyChecked: true,
      stateRevisionAfter: 'revision-1',
      stateRevisionBefore: 'revision-1',
      validationPassed: true,
    },
    clientInstanceId: CLIENT_ID,
    results: [{
      imageResultRefs,
      modelContent,
      success: true,
      toolCallId: 'tool-0',
    }],
    sequence: 0,
    sessionId: SESSION_ID,
    toolSchemaVersion: TOOL_SCHEMA,
    turnId: TURN_ID,
  };
}

async function createSession(
  sessions: HostedAgentK2MemorySessionStore,
  options: {
    activeLeaseMs?: number;
    protectedState?: unknown;
    sessionId?: string;
    terminalTtlMs?: number;
  } = {},
) {
  return sessions.createSession({
    activeLeaseMs: options.activeLeaseMs ?? 10_000,
    clientInstanceId: CLIENT_ID,
    protectedState: options.protectedState,
    sessionId: options.sessionId ?? SESSION_ID,
    terminalTtlMs: options.terminalTtlMs ?? 10_000,
    toolExecutionMode: 'read-only',
    toolSchemaVersion: TOOL_SCHEMA,
    turnId: TURN_ID,
  });
}

function transportFor(
  sessions: HostedAgentK2MemorySessionStore,
): HostedAgentK2ClientTransport {
  return {
    async cancel(input) {
      await sessions.cancel(input);
    },
    async interrupt(input) {
      await sessions.interruptForReload(input);
    },
    async postToolResults(input) {
      return sessions.postToolResults(input);
    },
    async replayEvents(input) {
      return sessions.replayEvents(input);
    },
  };
}

describe('hosted-agent K2 lease, payload, and redaction security', () => {
  it('marks reload interrupted, rejects a new page without the lease, and purges protected state', async () => {
    let now = Date.parse('2026-07-30T12:00:00.000Z');
    const diagnostics: unknown[] = [];
    const secret = 'RAW_SYSTEM_PROMPT_DO_NOT_LOG';
    const sessions = new HostedAgentK2MemorySessionStore({
      diagnostics: (event) => diagnostics.push(event),
      now: () => now,
    });
    const lease = await createSession(sessions, {
      activeLeaseMs: 2_000,
      protectedState: {
        history: secret,
        providerCredential: 'sk-do-not-log',
      },
      terminalTtlMs: 1_000,
    });
    const client = new HostedAgentK2ClientSession({
      clientInstanceId: CLIENT_ID,
      lease,
      toolSchemaVersion: TOOL_SCHEMA,
      transport: transportFor(sessions),
      turnId: TURN_ID,
    });

    await client.interruptForReload();
    expect(client.status).toBe('interrupted');
    expect(sessions.getStatus(SESSION_ID)).toBe('interrupted');
    await expect(sessions.replayEvents({
      afterEventId: null,
      clientInstanceId: CLIENT_ID,
      leaseToken: 'new-page-has-no-old-lease',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(/page lease/i);

    now += 1_001;
    expect(sessions.sweep()).toEqual({ interrupted: 0, purged: 1 });
    expect(sessions.hasSession(SESSION_ID)).toBe(false);
    const logged = JSON.stringify(diagnostics);
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain('sk-do-not-log');
  });

  it('expires an orphaned tab lease as interrupted without cross-tab takeover', async () => {
    let now = 1_000_000;
    const sessions = new HostedAgentK2MemorySessionStore({ now: () => now });
    const lease = await createSession(sessions, {
      activeLeaseMs: 1_000,
      terminalTtlMs: 1_000,
    });
    now += 1_001;
    expect(sessions.sweep()).toEqual({ interrupted: 1, purged: 0 });
    expect(sessions.getStatus(SESSION_ID)).toBe('interrupted');
    await expect(sessions.replayEvents({
      afterEventId: null,
      clientInstanceId: 'other-tab',
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(/tab-bound/i);
  });

  it('uses authenticated short-lived binary references and keeps raw payloads out of diagnostics', async () => {
    let now = 2_000_000;
    const diagnostics: unknown[] = [];
    const sessions = new HostedAgentK2MemorySessionStore({
      diagnostics: (event) => diagnostics.push(event),
      now: () => now,
    });
    const lease = await createSession(sessions);
    const largeResults = new HostedAgentK2MemoryLargeResultStore(
      sessions,
      { now: () => now },
    );
    const binaryMarker = 'BINARY_IMAGE_BYTES_MUST_NOT_APPEAR';
    const bytes = new TextEncoder().encode(binaryMarker.repeat(20_000));
    const reference = largeResults.put({
      bytes,
      mediaType: 'image/png',
      sessionId: SESSION_ID,
      ttlMs: 1_000,
      turnId: TURN_ID,
    });
    expect(reference.id).toMatch(/^har_/);
    expect(reference.byteLength).toBe(bytes.byteLength);

    const read = await largeResults.read({
      clientInstanceId: CLIENT_ID,
      id: reference.id,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });
    expect(read.bytes).toEqual(bytes);
    await expect(largeResults.read({
      clientInstanceId: CLIENT_ID,
      id: reference.id,
      leaseToken: 'wrong-lease',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(/page lease/i);

    sessions.appendRuntimeEvent(SESSION_ID, toolEvent());
    const textMarker = 'LARGE_TIMELINE_RESULT_MUST_NOT_APPEAR_IN_LOGS';
    const largeText = `${textMarker}:${'x'.repeat(256 * 1024)}`;
    await expect(sessions.postToolResults({
      batch: batch(largeText, [reference.id]),
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).resolves.toMatchObject({ accepted: true, replayed: false });

    const logged = JSON.stringify(diagnostics);
    expect(logged).not.toContain(binaryMarker);
    expect(logged).not.toContain(textMarker);
    expect(logged).not.toContain(largeText);

    now += 1_001;
    expect(largeResults.sweep()).toBe(1);
    await expect(largeResults.read({
      clientInstanceId: CLIENT_ID,
      id: reference.id,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(/unavailable or expired/i);
  });

  it('rejects data URLs and conflicting result replays while accepting an identical retry', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    sessions.appendRuntimeEvent(SESSION_ID, toolEvent());
    const original = batch('{"tracks":[]}');
    const posted = {
      batch: original,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    };
    await expect(sessions.postToolResults(posted)).resolves.toMatchObject({
      replayed: false,
    });
    await expect(sessions.postToolResults(posted)).resolves.toMatchObject({
      replayed: true,
    });
    await expect(sessions.postToolResults({
      ...posted,
      batch: batch('{"tracks":["conflict"]}'),
    })).rejects.toThrow(/conflicting replay/i);

    const unsafeSession = new HostedAgentK2MemorySessionStore();
    const unsafeLease = await createSession(unsafeSession);
    unsafeSession.appendRuntimeEvent(SESSION_ID, toolEvent());
    const unsafe = batch('data:image/png;base64,AAAA');
    await expect(unsafeSession.postToolResults({
      batch: unsafe,
      clientInstanceId: CLIENT_ID,
      leaseToken: unsafeLease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).rejects.toThrow(/invalid, unsafe/i);
  });

  it('accepts a strictly shaped inline visual result on the authenticated tool-result channel', async () => {
    const sessions = new HostedAgentK2MemorySessionStore();
    const lease = await createSession(sessions);
    sessions.appendRuntimeEvent(SESSION_ID, toolEvent());
    const visual = batch('{"success":true,"data":{"dataUrl":"[image omitted]"}}');
    visual.results[0].providerContent = {
      openAiFollowupInput: [{
        content: [
          { text: 'Visual output from captureFrame:', type: 'input_text' },
          {
            detail: 'high',
            image_url: 'data:image/png;base64,iVBORw0KGgo=',
            type: 'input_image',
          },
        ],
        role: 'user',
      }],
    };

    await expect(sessions.postToolResults({
      batch: visual,
      clientInstanceId: CLIENT_ID,
      leaseToken: lease.leaseToken,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    })).resolves.toMatchObject({ accepted: true, replayed: false });
  });

  it('bounds and purges a load of short-lived terminal sessions', async () => {
    let now = 5_000_000;
    const sessions = new HostedAgentK2MemorySessionStore({ now: () => now });
    const sessionCount = 100;
    for (let index = 0; index < sessionCount; index += 1) {
      const sessionId = `load-session-${index}`;
      await createSession(sessions, {
        activeLeaseMs: 1_000,
        sessionId,
        terminalTtlMs: 1_000,
      });
      sessions.appendRuntimeEvent(sessionId, {
        creditsCharged: 0,
        eventId: '1',
        kind: 'turn-complete',
        message: 'Done.',
        rounds: 1,
        sessionId,
        turnId: TURN_ID,
      });
    }
    now += 1_001;
    expect(sessions.sweep()).toEqual({ interrupted: 0, purged: sessionCount });
    for (let index = 0; index < sessionCount; index += 1) {
      expect(sessions.hasSession(`load-session-${index}`)).toBe(false);
    }
  });

  it('forwards only the opaque page lease through the public proxy boundary', async () => {
    let forwardedLease = '';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      forwardedLease = new Headers(init?.headers).get(HOSTED_AGENT_HEADERS.pageLease) ?? '';
      return new Response('{"ok":true}', {
        headers: {
          'Content-Type': 'application/json',
          [HOSTED_AGENT_HEADERS.pageLease]: 'origin-rotated-lease',
        },
      });
    });
    const response = await forwardHostedAgentRequest({
      accept: 'application/json',
      assertion: 'signed-assertion',
      clientInstanceId: CLIENT_ID,
      env: {
        KERNEL_AUTH_TOKEN: 'kernel-token',
        KERNEL_ORIGIN: 'https://kernel.example.test',
      } as Env,
      method: 'GET',
      pageLease: 'page-lease-secret',
      requestSignal: new AbortController().signal,
      sessionId: SESSION_ID,
      turnId: TURN_ID,
      upstreamPath: `/kernel/hosted-agent/turns/${TURN_ID}/events`,
    });

    expect(forwardedLease).toBe('page-lease-secret');
    expect(response.headers.get(HOSTED_AGENT_HEADERS.pageLease)).toBe('origin-rotated-lease');
    expect(response.headers.has(HOSTED_AGENT_HEADERS.serviceAssertion)).toBe(false);
    fetchSpy.mockRestore();
  });

  it('parses ordered SSE envelopes and sends cursor plus page lease on reconnect', async () => {
    const sse = [
      `id: 1\nevent: session-ready\ndata: ${JSON.stringify({
        acceptedHistoryFormatVersion: 'history-v1',
        acceptedPromptVersion: 'prompt-v1',
        acceptedToolSchemaVersion: TOOL_SCHEMA,
        eventId: '1',
        kind: 'session-ready',
        maximumIterations: 400,
        maximumSpendCredits: 50,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
      })}\n\n`,
      `id: 2\nevent: narration-complete\ndata: ${JSON.stringify({
        eventId: '2',
        kind: 'narration-complete',
        phase: 'inspecting',
        roundIndex: 0,
        sessionId: SESSION_ID,
        text: 'Inspecting.',
        turnId: TURN_ID,
      })}\n\n`,
    ].join('');
    let requestHeaders = new Headers();
    const transport = createHostedAgentK2FetchTransport({
      apiBasePath: '/api/kernel',
      fetchImplementation: vi.fn(async (_url, init) => {
        requestHeaders = new Headers(init?.headers);
        return new Response(sse, {
          headers: {
            'Content-Type': 'text/event-stream',
            [HOSTED_AGENT_HEADERS.eventCursor]: '2',
            [HOSTED_AGENT_HEADERS.streamLeaseMs]: '55000',
          },
        });
      }),
    });
    const replay = await transport.replayEvents({
      afterEventId: '1',
      clientInstanceId: CLIENT_ID,
      leaseToken: 'opaque-page-lease',
      sessionId: SESSION_ID,
      turnId: TURN_ID,
    });

    expect(replay.events.map((event) => event.kind)).toEqual([
      'session-ready',
      'narration-complete',
    ]);
    expect(replay.cursor).toBe('2');
    expect(requestHeaders.get(HOSTED_AGENT_HEADERS.lastEventId)).toBe('1');
    expect(requestHeaders.get(HOSTED_AGENT_HEADERS.pageLease)).toBe('opaque-page-lease');
    expect(() => parseHostedAgentK2Sse(
      'id: 2\nevent: turn-complete\ndata: {"eventId":"different","kind":"turn-complete"}\n\n',
    )).toThrow(/envelope/i);
  });
});
