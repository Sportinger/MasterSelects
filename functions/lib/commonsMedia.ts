import type { Env } from './env';

export interface CommonsImportTokenPayload {
  expiresAt: number;
  mimeType: string;
  originalUrl: string;
  title: string;
  version: 1;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function signingSecret(env: Env): string {
  const secret = env.SESSION_SECRET?.trim();
  if (!secret) throw new Error('Commons import signing is not configured.');
  return secret;
}

async function signingKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(signingSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export function assertCommonsUploadUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid Wikimedia Commons media URL.');
  }
  if (
    url.protocol !== 'https:'
    || url.hostname !== 'upload.wikimedia.org'
    || url.username !== ''
    || url.password !== ''
    || url.hash !== ''
  ) throw new Error('Wikimedia Commons media URL is not allowed.');
  return url;
}

export async function signCommonsImportToken(
  env: Env,
  payload: CommonsImportTokenPayload,
): Promise<string> {
  assertCommonsUploadUrl(payload.originalUrl);
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    await signingKey(env),
    new TextEncoder().encode(encoded),
  ));
  return `${encoded}.${base64UrlEncode(signature)}`;
}

export async function verifyCommonsImportToken(
  env: Env,
  token: string,
): Promise<CommonsImportTokenPayload> {
  const [encoded, signatureText, ...rest] = token.split('.');
  if (!encoded || !signatureText || rest.length > 0) throw new Error('Invalid Commons import token.');
  const valid = await crypto.subtle.verify(
    'HMAC',
    await signingKey(env),
    ownedArrayBuffer(base64UrlDecode(signatureText)),
    new TextEncoder().encode(encoded),
  );
  if (!valid) throw new Error('Invalid Commons import token.');
  const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as CommonsImportTokenPayload;
  if (
    payload.version !== 1
    || !Number.isFinite(payload.expiresAt)
    || payload.expiresAt <= Date.now()
    || typeof payload.title !== 'string'
    || typeof payload.mimeType !== 'string'
    || typeof payload.originalUrl !== 'string'
  ) throw new Error('Expired or invalid Commons import token.');
  assertCommonsUploadUrl(payload.originalUrl);
  return payload;
}

export function plainCommonsMetadata(value: unknown, maximum = 1_500): string {
  const source = typeof value === 'object' && value !== null && 'value' in value
    ? String((value as { value: unknown }).value ?? '')
    : '';
  return source
    .replace(/<[^>]*>/gu, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maximum);
}
