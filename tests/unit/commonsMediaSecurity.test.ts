import { describe, expect, it } from 'vitest';

import type { Env } from '../../functions/lib/env';
import {
  assertCommonsUploadUrl,
  signCommonsImportToken,
  verifyCommonsImportToken,
} from '../../functions/lib/commonsMedia';

const env = { SESSION_SECRET: 'test-only-commons-signing-secret' } as Env;

describe('Wikimedia Commons import boundary', () => {
  it('allows only exact HTTPS upload.wikimedia.org URLs', () => {
    expect(assertCommonsUploadUrl('https://upload.wikimedia.org/example.jpg').hostname)
      .toBe('upload.wikimedia.org');
    expect(() => assertCommonsUploadUrl('http://upload.wikimedia.org/example.jpg')).toThrow();
    expect(() => assertCommonsUploadUrl('https://upload.wikimedia.org.evil.example/example.jpg')).toThrow();
  });

  it('round-trips signed import details and rejects tampering', async () => {
    const token = await signCommonsImportToken(env, {
      expiresAt: Date.now() + 60_000,
      mimeType: 'image/jpeg',
      originalUrl: 'https://upload.wikimedia.org/example.jpg',
      title: 'Example.jpg',
      version: 1,
    });

    await expect(verifyCommonsImportToken(env, token)).resolves.toMatchObject({
      mimeType: 'image/jpeg',
      title: 'Example.jpg',
    });
    const [payload, signature] = token.split('.');
    const tamperedSignature = `${signature?.startsWith('A') ? 'B' : 'A'}${signature?.slice(1) ?? ''}`;
    await expect(verifyCommonsImportToken(env, `${payload}.${tamperedSignature}`)).rejects.toThrow();
  });
});
