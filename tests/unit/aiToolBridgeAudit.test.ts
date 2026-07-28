import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sanitizeAuditValue } from '../../src/services/aiTools/audit';
import {
  BridgeTraceStore,
  sanitizeTraceValue,
} from '../../tools/devBridge/traceStore';

describe('AI tool bridge audit sanitization', () => {
  it('redacts credentials and binary data while retaining reproducible arguments', () => {
    const input = {
      apiKey: 'secret-key',
      clipId: 'clip-123',
      nested: {
        authorization: 'Bearer secret',
        range: [1.25, 4.5],
      },
      preview: 'data:image/png;base64,AAAA',
    };

    expect(sanitizeAuditValue(input)).toEqual({
      apiKey: '[REDACTED]',
      clipId: 'clip-123',
      nested: {
        authorization: '[REDACTED]',
        range: [1.25, 4.5],
      },
      preview: '[binary/image data omitted]',
    });
    expect(sanitizeTraceValue(input)).toEqual({
      apiKey: '[REDACTED]',
      clipId: 'clip-123',
      nested: {
        authorization: '[REDACTED]',
        range: [1.25, 4.5],
      },
      preview: '[binary/image data omitted]',
    });
  });

  it('persists completed bridge calls and resolves idempotency keys after restart', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'masterselects-bridge-audit-'));
    const tracePath = path.join(tempRoot, 'history.jsonl');

    try {
      const firstStore = new BridgeTraceStore(tracePath, 20);
      const started = firstStore.begin({
        args: { clipId: 'clip-a' },
        idempotencyKey: 'stable-request',
        sessionId: 'session-a',
        source: 'mcp',
        surface: 'chat',
        tool: 'getClipDetails',
      });
      const completed = firstStore.complete(started.callId, {
        result: { success: true, data: { id: 'clip-a' } },
      });

      expect(completed?.status).toBe('succeeded');
      expect(completed?.durationMs).toBeGreaterThanOrEqual(0);

      const reloadedStore = new BridgeTraceStore(tracePath, 20);
      expect(reloadedStore.get(started.callId)).toMatchObject({
        callId: started.callId,
        idempotencyKey: 'stable-request',
        sessionId: 'session-a',
        status: 'succeeded',
        tool: 'getClipDetails',
      });
      expect(reloadedStore.findByIdempotencyKey('stable-request', 'session-a')?.callId)
        .toBe(started.callId);
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
