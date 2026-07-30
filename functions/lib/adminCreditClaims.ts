import {
  getCreditClaimStatus,
  hashCreditClaimToken,
  isValidClaimAmount,
  isValidClaimEmail,
  normalizeClaimEmail,
  type CreditClaimRow,
  type CreditClaimStatus,
} from './creditClaims';
import type { AppD1Database, Env } from './env';

const TOKEN_ENCRYPTION_CONTEXT = 'masterselects:admin-credit-link:v1:';
const encoder = new TextEncoder();

interface AdminCreditClaimRow extends CreditClaimRow {
  token_ciphertext: string | null;
  token_iv: string | null;
}

export interface AdminCreditClaim {
  amount: number;
  claimedAt: string | null;
  claimedEmail: string | null;
  createdAt: string;
  createdBy: string;
  description: string | null;
  expectedEmail: string | null;
  expiresAt: string | null;
  id: string;
  link: string | null;
  rotatable: boolean;
  status: CreditClaimStatus;
  title: string;
}

export interface CreateAdminCreditClaimInput {
  amount?: unknown;
  description?: unknown;
  expectedEmail?: unknown;
  expiresDays?: unknown;
  title?: unknown;
  unlocked?: unknown;
}

function encodeBase64Url(bytes: ArrayBuffer | ArrayBufferView): string {
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  const binary = atob(`${normalized}${padding}`);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getAdminClaimSecret(env: Env): string {
  const secret = env.ADMIN_SESSION_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('Admin claim encryption is not configured.');
  return secret;
}

async function getAdminClaimEncryptionKey(env: Env): Promise<CryptoKey> {
  const keyBytes = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${TOKEN_ENCRYPTION_CONTEXT}${getAdminClaimSecret(env)}`),
  );
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt', 'encrypt']);
}

export function generateAdminCreditClaimToken(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function encryptAdminCreditClaimToken(
  env: Env,
  claimId: string,
  token: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: encoder.encode(claimId),
      iv,
      name: 'AES-GCM',
      tagLength: 128,
    },
    await getAdminClaimEncryptionKey(env),
    encoder.encode(token),
  );
  return { ciphertext: encodeBase64Url(ciphertext), iv: encodeBase64Url(iv) };
}

export async function decryptAdminCreditClaimToken(
  env: Env,
  claimId: string,
  ciphertext: string,
  iv: string,
): Promise<string | null> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        additionalData: encoder.encode(claimId),
        iv: decodeBase64Url(iv),
        name: 'AES-GCM',
        tagLength: 128,
      },
      await getAdminClaimEncryptionKey(env),
      decodeBase64Url(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

function publicAppBaseUrl(request: Request, env: Env): string {
  const configured = env.MASTERSELECTS_PUBLIC_URL?.trim();
  const candidate = configured || new URL(request.url).origin;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('MASTERSELECTS_PUBLIC_URL must use HTTPS.');
  }
  return url.origin;
}

function buildClaimLink(request: Request, env: Env, token: string): string {
  const url = new URL('/credits/claim', publicAppBaseUrl(request, env));
  url.searchParams.set('code', token);
  return url.toString();
}

function cleanText(value: unknown, maximum: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function normalizeCreateInput(input: CreateAdminCreditClaimInput): {
  amount: number;
  description: string | null;
  expectedEmail: string | null;
  expiresAt: string | null;
  title: string;
} {
  const amount = Number(input.amount);
  if (!isValidClaimAmount(amount)) {
    throw new Error('Credits must be a whole number between 1 and 1,000,000.');
  }

  const unlocked = input.unlocked === true;
  const expectedEmail = unlocked ? '' : normalizeClaimEmail(input.expectedEmail);
  if (!unlocked && !isValidClaimEmail(expectedEmail)) {
    throw new Error('Enter a valid recipient email or allow any account.');
  }

  const expiresDays = Number(input.expiresDays ?? 30);
  if (!Number.isInteger(expiresDays) || expiresDays < 0 || expiresDays > 3650) {
    throw new Error('Expiry must be between 0 and 3650 days.');
  }

  return {
    amount,
    description: cleanText(input.description, 500) || null,
    expectedEmail: expectedEmail || null,
    expiresAt: expiresDays === 0
      ? null
      : new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString(),
    title: cleanText(input.title, 120) || 'MasterSelects credit reward',
  };
}

function runChanges(result: unknown): number | null {
  if (!result || typeof result !== 'object') return null;
  const direct = (result as { changes?: unknown }).changes;
  if (typeof direct === 'number') return direct;
  const nested = (result as { meta?: { changes?: unknown } }).meta?.changes;
  return typeof nested === 'number' ? nested : null;
}

export async function createAdminCreditClaim(
  db: AppD1Database,
  request: Request,
  env: Env,
  input: CreateAdminCreditClaimInput,
): Promise<AdminCreditClaim> {
  const normalized = normalizeCreateInput(input);
  const id = crypto.randomUUID();
  const token = generateAdminCreditClaimToken();
  const tokenHash = await hashCreditClaimToken(token);
  const encrypted = await encryptAdminCreditClaimToken(env, id, token);
  const createdAt = new Date().toISOString();
  const metadata = JSON.stringify({
    created_with: 'admin-dashboard',
    recipient_locked: Boolean(normalized.expectedEmail),
  });

  await db.prepare(
    `INSERT INTO credit_claims (
       id, token_hash, amount, title, description, expected_email, expires_at,
       created_by, created_at, metadata_json, token_ciphertext, token_iv
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 'admin-dashboard', ?, ?, ?, ?)`,
  )
    .bind(
      id,
      tokenHash,
      normalized.amount,
      normalized.title,
      normalized.description,
      normalized.expectedEmail,
      normalized.expiresAt,
      createdAt,
      metadata,
      encrypted.ciphertext,
      encrypted.iv,
    )
    .run();

  return {
    amount: normalized.amount,
    claimedAt: null,
    claimedEmail: null,
    createdAt,
    createdBy: 'admin-dashboard',
    description: normalized.description,
    expectedEmail: normalized.expectedEmail,
    expiresAt: normalized.expiresAt,
    id,
    link: buildClaimLink(request, env, token),
    rotatable: false,
    status: 'available',
    title: normalized.title,
  };
}

async function toAdminCreditClaim(
  row: AdminCreditClaimRow,
  request: Request,
  env: Env,
  now: Date,
): Promise<AdminCreditClaim> {
  const status = getCreditClaimStatus(row, now);
  const token = row.token_ciphertext && row.token_iv
    ? await decryptAdminCreditClaimToken(env, row.id, row.token_ciphertext, row.token_iv)
    : null;
  return {
    amount: Number(row.amount),
    claimedAt: row.claimed_at,
    claimedEmail: row.claimed_email,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    expectedEmail: row.expected_email,
    expiresAt: row.expires_at,
    id: row.id,
    link: token ? buildClaimLink(request, env, token) : null,
    rotatable: status === 'available' && !token,
    status,
    title: row.title,
  };
}

export async function listAdminCreditClaims(
  db: AppD1Database,
  request: Request,
  env: Env,
  limit = 500,
): Promise<AdminCreditClaim[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
  const rows = await db.prepare(
    `SELECT id, token_hash, amount, title, description, expected_email, expires_at,
            created_by, created_at, claimed_by_user_id, claimed_email, claimed_at,
            revoked_at, metadata_json, campaign, redeem_code_hash, token_ciphertext, token_iv
     FROM credit_claims
     ORDER BY created_at DESC
     LIMIT ?`,
  )
    .bind(safeLimit)
    .all<AdminCreditClaimRow>();
  const now = new Date();
  return Promise.all(rows.results.map((row) => toAdminCreditClaim(row, request, env, now)));
}

export async function rotateAdminCreditClaimLink(
  db: AppD1Database,
  request: Request,
  env: Env,
  claimId: string,
): Promise<AdminCreditClaim> {
  const row = await db.prepare(
    `SELECT id, token_hash, amount, title, description, expected_email, expires_at,
            created_by, created_at, claimed_by_user_id, claimed_email, claimed_at,
            revoked_at, metadata_json, campaign, redeem_code_hash, token_ciphertext, token_iv
     FROM credit_claims
     WHERE id = ?
     LIMIT 1`,
  )
    .bind(claimId)
    .first<AdminCreditClaimRow>();

  if (!row) throw new Error('Credit link not found.');
  if (getCreditClaimStatus(row) !== 'available') {
    throw new Error('Only open credit links can be renewed.');
  }

  const token = generateAdminCreditClaimToken();
  const tokenHash = await hashCreditClaimToken(token);
  const encrypted = await encryptAdminCreditClaimToken(env, row.id, token);
  const result = await db.prepare(
    `UPDATE credit_claims
     SET token_hash = ?, token_ciphertext = ?, token_iv = ?
     WHERE id = ?
       AND claimed_at IS NULL
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?)`,
  )
    .bind(tokenHash, encrypted.ciphertext, encrypted.iv, row.id, new Date().toISOString())
    .run();

  const changes = runChanges(result);
  if (changes !== null && changes < 1) {
    throw new Error('The credit link changed while it was being renewed. Refresh and try again.');
  }

  return {
    amount: Number(row.amount),
    claimedAt: null,
    claimedEmail: null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    expectedEmail: row.expected_email,
    expiresAt: row.expires_at,
    id: row.id,
    link: buildClaimLink(request, env, token),
    rotatable: false,
    status: 'available',
    title: row.title,
  };
}
