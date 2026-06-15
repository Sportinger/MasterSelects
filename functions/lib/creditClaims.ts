import { getCreditBalance } from './credits';
import type { AppD1Database, AppUser } from './env';

export const CREDIT_CLAIM_HASH_CONTEXT = 'masterselects:credit-claim:v1:';
export const CREDIT_CLAIM_LEDGER_SOURCE = 'manual:credit_claim';

const MAX_CLAIM_AMOUNT = 1_000_000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;
const textEncoder = new TextEncoder();

export type CreditClaimStatus = 'available' | 'claimed' | 'expired' | 'invalid' | 'revoked';

export interface CreditClaimRow {
  amount: number;
  claimed_at: string | null;
  claimed_by_user_id: string | null;
  claimed_email: string | null;
  created_at: string;
  created_by: string;
  description: string | null;
  expected_email: string | null;
  expires_at: string | null;
  id: string;
  metadata_json: string | null;
  revoked_at: string | null;
  title: string;
  token_hash: string;
}

export interface CreditClaimPublicStatus {
  amount: number;
  claimable: boolean;
  claimedAt: string | null;
  createdAt: string;
  description: string | null;
  emailLocked: boolean;
  expiresAt: string | null;
  status: CreditClaimStatus;
  title: string;
}

export interface RedeemCreditClaimResult {
  amount: number;
  claimedAt: string | null;
  creditBalance: number;
  error?: 'already_claimed' | 'email_mismatch' | 'expired' | 'invalid' | 'revoked' | 'write_failed';
  ledgerEntryId: string | null;
  ok: boolean;
  status: CreditClaimStatus | 'redeemed';
}

interface CreditLedgerInsertRow {
  id: string;
}

function toHex(input: ArrayBuffer): string {
  return [...new Uint8Array(input)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function getRunChanges(result: unknown): number | null {
  if (!result || typeof result !== 'object') {
    return null;
  }

  const direct = (result as { changes?: unknown }).changes;
  if (typeof direct === 'number') {
    return direct;
  }

  const meta = (result as { meta?: { changes?: unknown } }).meta;
  if (typeof meta?.changes === 'number') {
    return meta.changes;
  }

  return null;
}

export function normalizeCreditClaimToken(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export function isValidCreditClaimToken(input: unknown): boolean {
  const token = normalizeCreditClaimToken(input);
  return token.length >= MIN_TOKEN_LENGTH
    && token.length <= MAX_TOKEN_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(token);
}

export function normalizeClaimEmail(input: unknown): string {
  return typeof input === 'string' ? input.trim().toLowerCase() : '';
}

export function isValidClaimEmail(input: unknown): boolean {
  const email = normalizeClaimEmail(input);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidClaimAmount(input: unknown): input is number {
  return typeof input === 'number'
    && Number.isInteger(input)
    && input > 0
    && input <= MAX_CLAIM_AMOUNT;
}

export async function hashCreditClaimToken(input: unknown): Promise<string> {
  const token = normalizeCreditClaimToken(input);
  if (!isValidCreditClaimToken(token)) {
    return '';
  }

  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(`${CREDIT_CLAIM_HASH_CONTEXT}${token}`));
  return toHex(digest);
}

export function getCreditClaimLedgerSourceId(claimId: string): string {
  return `credit-claim:${claimId}`;
}

export function getCreditClaimStatus(claim: CreditClaimRow, now = new Date()): CreditClaimStatus {
  if (!isValidClaimAmount(Number(claim.amount))) {
    return 'invalid';
  }

  if (claim.revoked_at) {
    return 'revoked';
  }

  if (claim.claimed_at) {
    return 'claimed';
  }

  if (claim.expires_at && Date.parse(claim.expires_at) <= now.getTime()) {
    return 'expired';
  }

  return 'available';
}

export function isCreditClaimEmailEligible(claim: CreditClaimRow, user: AppUser | null | undefined): boolean {
  if (!user) {
    return false;
  }

  const expectedEmail = normalizeClaimEmail(claim.expected_email);
  if (!expectedEmail) {
    return true;
  }

  return normalizeClaimEmail(user.email) === expectedEmail;
}

export function toCreditClaimPublicStatus(
  claim: CreditClaimRow,
  user: AppUser | null | undefined,
  now = new Date(),
): CreditClaimPublicStatus {
  const status = getCreditClaimStatus(claim, now);
  return {
    amount: Number(claim.amount),
    claimable: status === 'available' && isCreditClaimEmailEligible(claim, user),
    claimedAt: claim.claimed_at,
    createdAt: claim.created_at,
    description: claim.description,
    emailLocked: Boolean(normalizeClaimEmail(claim.expected_email)),
    expiresAt: claim.expires_at,
    status,
    title: claim.title,
  };
}

export async function getCreditClaimByToken(
  db: AppD1Database,
  token: unknown,
): Promise<CreditClaimRow | null> {
  const tokenHash = await hashCreditClaimToken(token);
  if (!tokenHash) {
    return null;
  }

  return db
    .prepare(
      `
        SELECT id, token_hash, amount, title, description, expected_email, expires_at,
               created_by, created_at, claimed_by_user_id, claimed_email, claimed_at,
               revoked_at, metadata_json
        FROM credit_claims
        WHERE token_hash = ?
        LIMIT 1
      `,
    )
    .bind(tokenHash)
    .first<CreditClaimRow>();
}

async function releaseClaimReservation(
  db: AppD1Database,
  claimId: string,
  userId: string,
  claimedAt: string,
): Promise<void> {
  await db
    .prepare(
      `
        UPDATE credit_claims
        SET claimed_by_user_id = NULL,
            claimed_email = NULL,
            claimed_at = NULL
        WHERE id = ?
          AND claimed_by_user_id = ?
          AND claimed_at = ?
      `,
    )
    .bind(claimId, userId, claimedAt)
    .run();
}

export async function redeemCreditClaim(
  db: AppD1Database,
  claim: CreditClaimRow,
  user: AppUser,
  emailInput: unknown,
  now = new Date(),
): Promise<RedeemCreditClaimResult> {
  const status = getCreditClaimStatus(claim, now);
  const amount = Number(claim.amount);
  const currentBalance = await getCreditBalance(db, user.id);

  if (status !== 'available') {
    return {
      amount,
      claimedAt: claim.claimed_at,
      creditBalance: currentBalance,
      error: status === 'claimed' ? 'already_claimed' : status,
      ledgerEntryId: null,
      ok: false,
      status,
    };
  }

  const requestedEmail = normalizeClaimEmail(emailInput);
  const sessionEmail = normalizeClaimEmail(user.email);
  const expectedEmail = normalizeClaimEmail(claim.expected_email);

  if (!isValidClaimEmail(requestedEmail) || requestedEmail !== sessionEmail) {
    return {
      amount,
      claimedAt: null,
      creditBalance: currentBalance,
      error: 'email_mismatch',
      ledgerEntryId: null,
      ok: false,
      status: 'available',
    };
  }

  if (expectedEmail && requestedEmail !== expectedEmail) {
    return {
      amount,
      claimedAt: null,
      creditBalance: currentBalance,
      error: 'email_mismatch',
      ledgerEntryId: null,
      ok: false,
      status: 'available',
    };
  }

  const claimedAt = now.toISOString();
  const reservation = await db
    .prepare(
      `
        UPDATE credit_claims
        SET claimed_by_user_id = ?,
            claimed_email = ?,
            claimed_at = ?
        WHERE id = ?
          AND claimed_at IS NULL
          AND revoked_at IS NULL
          AND (expires_at IS NULL OR expires_at > ?)
      `,
    )
    .bind(user.id, requestedEmail, claimedAt, claim.id, claimedAt)
    .run();

  const changes = getRunChanges(reservation);
  if (changes !== null && changes < 1) {
    return {
      amount,
      claimedAt: null,
      creditBalance: await getCreditBalance(db, user.id),
      error: 'already_claimed',
      ledgerEntryId: null,
      ok: false,
      status: 'claimed',
    };
  }

  const ledgerEntryId = crypto.randomUUID();
  const sourceId = getCreditClaimLedgerSourceId(claim.id);
  const metadata = JSON.stringify({
    claim_id: claim.id,
    email_locked: Boolean(expectedEmail),
    title: claim.title,
  });

  try {
    const insertResult = await db
      .prepare(
        `
          INSERT INTO credit_ledger (
            id,
            user_id,
            entry_type,
            amount,
            balance_after,
            source,
            source_id,
            description,
            metadata_json,
            created_at
          )
          VALUES (
            ?,
            ?,
            'grant',
            ?,
            COALESCE((SELECT SUM(amount) FROM credit_ledger WHERE user_id = ?), 0) + ?,
            ?,
            ?,
            ?,
            ?,
            ?
          )
        `,
      )
      .bind(
        ledgerEntryId,
        user.id,
        amount,
        user.id,
        amount,
        CREDIT_CLAIM_LEDGER_SOURCE,
        sourceId,
        claim.description || claim.title,
        metadata,
        claimedAt,
      )
      .run();

    const insertChanges = getRunChanges(insertResult);
    if (insertChanges !== null && insertChanges < 1) {
      throw new Error('Credit ledger insert did not write a row.');
    }
  } catch {
    await releaseClaimReservation(db, claim.id, user.id, claimedAt);
    return {
      amount,
      claimedAt: null,
      creditBalance: await getCreditBalance(db, user.id),
      error: 'write_failed',
      ledgerEntryId: null,
      ok: false,
      status: 'available',
    };
  }

  const row = await db
    .prepare(
      `
        SELECT id
        FROM credit_ledger
        WHERE id = ?
        LIMIT 1
      `,
    )
    .bind(ledgerEntryId)
    .first<CreditLedgerInsertRow>();

  return {
    amount,
    claimedAt,
    creditBalance: await getCreditBalance(db, user.id),
    ledgerEntryId: row?.id ?? ledgerEntryId,
    ok: true,
    status: 'redeemed',
  };
}
