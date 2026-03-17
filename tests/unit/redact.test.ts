import { describe, expect, it } from 'vitest';
import { redactSecrets, redactObject, REDACTED } from '../../src/services/security/redact';

describe('redactSecrets', () => {
  it('catches OpenAI keys (sk-proj-...)', () => {
    const input = 'key is sk-proj-abc123def456ghi789jkl012mno345';
    const result = redactSecrets(input);
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('abc123def456ghi789');
  });

  it('catches OpenAI keys (sk-...)', () => {
    const input = 'using sk-abcdefghijklmnopqrstuvwxyz1234';
    const result = redactSecrets(input);
    expect(result).toBe(`using sk-${REDACTED}`);
  });

  it('catches Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
    const result = redactSecrets(input);
    expect(result).toContain(`Bearer ${REDACTED}`);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  it('catches x-api-key values', () => {
    const input = 'x-api-key: mySecretKeyValue123456';
    const result = redactSecrets(input);
    expect(result).toContain(`x-api-key: ${REDACTED}`);
    expect(result).not.toContain('mySecretKeyValue123456');
  });

  it('catches URL key params', () => {
    const input = 'https://api.example.com/data?key=AIzaSyABC123DEF456GHI';
    const result = redactSecrets(input);
    expect(result).toContain(`?key=${REDACTED}`);
    expect(result).not.toContain('AIzaSyABC123DEF456GHI');
  });

  it('catches URL key params with & prefix', () => {
    const input = 'https://api.example.com/data?q=test&key=AIzaSyABC123DEF456GHI';
    const result = redactSecrets(input);
    expect(result).toContain(`&key=${REDACTED}`);
    expect(result).not.toContain('AIzaSyABC123DEF456GHI');
  });

  it('catches long hex tokens (40+ chars)', () => {
    const input = 'token: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6';
    const result = redactSecrets(input);
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('a1b2c3d4e5f6a1b2c3d4e5f6');
  });

  it('catches long alphanumeric tokens (40+ chars)', () => {
    const input = 'secret=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEF';
    const result = redactSecrets(input);
    expect(result).toContain(REDACTED);
    expect(result).not.toContain('AbCdEfGhIjKlMnOpQrStUvWxYz0123456789ABCDEF');
  });

  it('preserves normal text', () => {
    const input = 'clip split at 5.2s on track 1';
    expect(redactSecrets(input)).toBe(input);
  });

  it('preserves short strings', () => {
    const input = 'error code 42';
    expect(redactSecrets(input)).toBe(input);
  });

  it('preserves UUIDs', () => {
    const input = 'clip-a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(redactSecrets(input)).toBe(input);
  });

  it('preserves hex color codes', () => {
    const input = 'color: #ff4444';
    expect(redactSecrets(input)).toBe(input);
  });

  it('preserves short API-like strings (under threshold)', () => {
    const input = 'key: abc123';
    expect(redactSecrets(input)).toBe(input);
  });

  it('handles multiple secrets in one string', () => {
    const input = 'key1=sk-proj-aaaBBBcccDDDeeeFFFgggHHH111 and Bearer tokenABCDEFGHIJKLMNOPQRSTU';
    const result = redactSecrets(input);
    expect(result).toContain(`sk-${REDACTED}`);
    expect(result).toContain(`Bearer ${REDACTED}`);
  });

  it('is idempotent — redacting twice produces the same result', () => {
    const input = 'key is sk-proj-abc123def456ghi789jkl012mno345';
    const once = redactSecrets(input);
    const twice = redactSecrets(once);
    expect(twice).toBe(once);
  });
});

describe('redactObject', () => {
  it('handles nested objects with secrets', () => {
    const obj = {
      config: {
        apiKey: 'sk-proj-abc123def456ghi789jkl012mno345',
        name: 'test',
      },
    };
    const result = redactObject(obj) as Record<string, Record<string, string>>;
    expect(result.config.apiKey).toContain(REDACTED);
    expect(result.config.name).toBe('test');
  });

  it('handles arrays', () => {
    const arr = [
      'normal text',
      'sk-proj-abc123def456ghi789jkl012mno345',
      42,
    ];
    const result = redactObject(arr) as unknown[];
    expect(result[0]).toBe('normal text');
    expect(result[1]).toContain(REDACTED);
    expect(result[2]).toBe(42);
  });

  it('handles null and undefined', () => {
    expect(redactObject(null)).toBeNull();
    expect(redactObject(undefined)).toBeUndefined();
  });

  it('handles numbers and booleans', () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
    expect(redactObject(false)).toBe(false);
  });

  it('handles Error objects (redacts message)', () => {
    const err = new Error('Failed with key sk-proj-abc123def456ghi789jkl012mno345');
    const result = redactObject(err) as { name: string; message: string };
    expect(result.name).toBe('Error');
    expect(result.message).toContain(REDACTED);
    expect(result.message).not.toContain('abc123def456ghi789');
  });

  it('handles deeply nested structures', () => {
    const obj = {
      level1: {
        level2: {
          secret: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature',
          safe: 'hello',
        },
      },
    };
    const result = redactObject(obj) as Record<string, Record<string, Record<string, string>>>;
    expect(result.level1.level2.secret).toContain(REDACTED);
    expect(result.level1.level2.safe).toBe('hello');
  });
});
