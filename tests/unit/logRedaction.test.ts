import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REDACTED } from '../../src/services/security/redact';

function createStorageMock(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear() {
      data.clear();
    },
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    key(index: number) {
      return [...data.keys()][index] ?? null;
    },
    removeItem(key: string) {
      data.delete(key);
    },
    setItem(key: string, value: string) {
      data.set(key, String(value));
    },
  };
}

async function loadLoggerModule() {
  vi.resetModules();
  const storage = createStorageMock();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true } as Response)));
  const mod = await import('../../src/services/logger');
  (window as { LogSync?: { stop?: () => void } }).LogSync?.stop?.();
  return mod;
}

describe('logger redaction integration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    (window as { LogSync?: { stop?: () => void } }).LogSync?.stop?.();
    vi.unstubAllGlobals();
  });

  it('redacts secrets in log messages', async () => {
    const { Logger } = await loadLoggerModule();
    Logger.setLevel('WARN');

    const log = Logger.create('Test');
    log.warn('API key is sk-proj-abc123def456ghi789jkl012mno345');

    const buffer = Logger.getBuffer();
    const lastEntry = buffer.at(-1);
    expect(lastEntry).toBeDefined();
    expect(lastEntry!.message).toContain(REDACTED);
    expect(lastEntry!.message).not.toContain('abc123def456ghi789');
  });

  it('redacts secrets in log data objects', async () => {
    const { Logger } = await loadLoggerModule();
    Logger.setLevel('WARN');

    const log = Logger.create('Test');
    log.warn('connection info', {
      url: 'https://api.example.com',
      token: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
    });

    const buffer = Logger.getBuffer();
    const lastEntry = buffer.at(-1);
    expect(lastEntry).toBeDefined();
    const data = lastEntry!.data as Record<string, string>;
    expect(data.url).toBe('https://api.example.com');
    expect(data.token).toContain(REDACTED);
  });

  it('preserves log entries without secrets', async () => {
    const { Logger } = await loadLoggerModule();
    Logger.setLevel('WARN');

    const log = Logger.create('Test');
    log.warn('clip split at 5.2s', { clipId: 'clip-123', trackId: 'track-1' });

    const buffer = Logger.getBuffer();
    const lastEntry = buffer.at(-1);
    expect(lastEntry).toBeDefined();
    expect(lastEntry!.message).toBe('clip split at 5.2s');
    const data = lastEntry!.data as Record<string, string>;
    expect(data.clipId).toBe('clip-123');
    expect(data.trackId).toBe('track-1');
  });

  it('redacts secrets in Error data', async () => {
    const { Logger } = await loadLoggerModule();

    const log = Logger.create('Test');
    const err = new Error('Auth failed with key sk-proj-abc123def456ghi789jkl012mno345');
    log.error('request failed', err);

    const buffer = Logger.getBuffer();
    const lastEntry = buffer.at(-1);
    expect(lastEntry).toBeDefined();
    const data = lastEntry!.data as { name: string; message: string };
    expect(data.message).toContain(REDACTED);
    expect(data.message).not.toContain('abc123def456ghi789');
  });

  it('getBuffer returns entries with redacted content', async () => {
    const { Logger } = await loadLoggerModule();
    Logger.setLevel('WARN');

    const log = Logger.create('Test');
    log.warn('x-api-key: mySecretKeyValue123456');

    const allEntries = Logger.getBuffer();
    const matched = allEntries.filter(e => e.module === 'Test' && e.message.includes(REDACTED));
    expect(matched.length).toBeGreaterThan(0);
    // Verify no raw secret in any buffered entry
    for (const entry of matched) {
      expect(entry.message).not.toContain('mySecretKeyValue123456');
    }
  });
});
