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

  it('compacts the trace file to its newest whole lines once it grows past the budget', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-trace-compact-'));
    const tracePath = path.join(directory, 'history.jsonl');
    try {
      const line = (index: number) => `${JSON.stringify({ callId: `call-${index}`, tool: 'getStats', startedAt: index, padding: 'x'.repeat(200) })}\n`;
      fs.writeFileSync(tracePath, Array.from({ length: 100 }, (_, index) => line(index)).join(''));
      const sizeBefore = fs.statSync(tracePath).size;
      new BridgeTraceStore(tracePath, 20, 4_000);
      const text = fs.readFileSync(tracePath, 'utf8');
      expect(text.length).toBeLessThanOrEqual(2_000);
      expect(text.length).toBeLessThan(sizeBefore);
      expect(text.endsWith(line(99))).toBe(true);
      for (const kept of text.trim().split('\n')) expect(() => JSON.parse(kept)).not.toThrow();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
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
