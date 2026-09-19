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
    const input = 'https://api.example.com/data?key=AIzaSyABC123DEF456GHI'; // gitleaks:allow -- synthetic redaction fixture
    const result = redactSecrets(input);
    expect(result).toContain(`?key=${REDACTED}`);
    expect(result).not.toContain('AIzaSyABC123DEF456GHI');
  });

  it('catches URL key params with & prefix', () => {
    const input = 'https://api.example.com/data?q=test&key=AIzaSyABC123DEF456GHI'; // gitleaks:allow -- synthetic redaction fixture
    const result = redactSecrets(input);
    expect(result).toContain(`&key=${REDACTED}`);
    expect(result).not.toContain('AIzaSyABC123DEF456GHI');
  });

  it('catches long hex tokens (40+ chars)', () => {
    const input = 'token: a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6'; // gitleaks:allow -- synthetic redaction fixture
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
    const input = 'key1=sk-proj-aaaBBBcccDDDeeeFFFgggHHH111 and Bearer tokenABCDEFGHIJKLMNOPQRSTU'; // gitleaks:allow -- synthetic redaction fixture
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
        apiKey: 'sk-proj-abc123def456ghi789jkl012mno345', // gitleaks:allow -- synthetic redaction fixture
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

describe('redactSecrets - provider key formats', () => {
  it('catches Stripe secret keys with underscores (sk_live_...)', () => {
    const input = `stripe: sk_live_${'a1B2'.repeat(16)}`;
    expect(redactSecrets(input)).toBe(`stripe: sk_${REDACTED}`);
  });

  it('catches Stripe test, restricted, publishable and webhook secrets', () => {
    for (const key of [
      `sk_test_${'a1B2'.repeat(6)}`,
      'rk_live_ABCDEFGHIJKLMNOPQRSTUV', // gitleaks:allow -- synthetic redaction fixture
      'pk_test_TYooMQauvdEDq54NiTphI7jx',
      'whsec_1234567890abcdefghijklmnopqrstuv',
    ]) {
      const result = redactSecrets(`value=${key}`);
      expect(result).toContain(REDACTED);
      expect(result).not.toContain(key.slice(-12));
    }
  });

  it('catches Google API keys outside of URL params', () => {
    const key = 'AIzaSyA1234567890abcdefghijklmnopqrstuv'; // gitleaks:allow -- synthetic redaction fixture
    expect(redactSecrets(`youtube key ${key} configured`)).toBe(`youtube key ${REDACTED} configured`);
  });

  it('catches GitHub tokens', () => {
    const token = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    expect(redactSecrets(`token ${token}`)).toBe(`token ${REDACTED}`);
    expect(redactSecrets('gho_0123456789abcdefghijklmnopqrstuvwxyz')).toBe(REDACTED);
  });

  it('catches bare JWTs without a Bearer prefix', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'; // gitleaks:allow -- synthetic redaction fixture
    expect(redactSecrets(`session=${jwt}; path=/`)).toBe(`session=${REDACTED}; path=/`);
  });

  it('catches Resend API keys', () => {
    expect(redactSecrets('RESEND_API_KEY=re_abcdefghijklmnopqrstuvwxyz012345')).toBe(`RESEND_API_KEY=re_${REDACTED}`); // gitleaks:allow -- synthetic redaction fixture
    expect(redactSecrets('re_123456789012345678901234')).toBe(`re_${REDACTED}`);
  });

  it('preserves ordinary identifiers that only resemble key prefixes', () => {
    for (const input of ['re_render_scheduled', 'pk_short', 'sk_live_short', 'ghp_tooShort', 'AIzaShort', 'eyJabc.def.ghi']) {
      expect(redactSecrets(input)).toBe(input);
    }
  });
});

describe('redactObject - key-based redaction', () => {
  it('redacts string values under sensitive keys even when the value looks harmless', () => {
    const result = redactObject({
      Authorization: 'Basic dXNlcjpwYXNz',
      apiKey: 'short',
      cookie: 'session=abc',
      credentials: { user: 'bob', secret: 'hunter2' },
      password: 'hunter2',
      refreshToken: 'r1',
    }) as Record<string, unknown>;
    expect(result.Authorization).toBe(REDACTED);
    expect(result.apiKey).toBe(REDACTED);
    expect(result.cookie).toBe(REDACTED);
    expect(result.password).toBe(REDACTED);
    expect(result.refreshToken).toBe(REDACTED);
    expect((result.credentials as Record<string, unknown>).user).toBe('bob');
    expect((result.credentials as Record<string, unknown>).secret).toBe(REDACTED);
  });

  it('leaves non-string and empty values under sensitive keys untouched', () => {
    const result = redactObject({
      keyframes: [{ time: 1 }],
      secretEnabled: false,
      token: '',
      tokenCount: 42,
    }) as Record<string, unknown>;
    expect(result.keyframes).toEqual([{ time: 1 }]);
    expect(result.secretEnabled).toBe(false);
    expect(result.token).toBe('');
    expect(result.tokenCount).toBe(42);
  });

  it('keeps ordinary keys intact', () => {
    const input = { clipId: 'clip-123', message: 'clip split at 5.2s', trackId: 'track-1' };
    expect(redactObject(input)).toEqual(input);
  });
});
