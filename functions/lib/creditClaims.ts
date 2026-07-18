import { getCreditBalance } from './credits';
import type { AppD1Database, AppD1Statement, AppUser } from './env';

export const CREDIT_CLAIM_HASH_CONTEXT = 'masterselects:credit-claim:v1:';
export const CREDIT_CLAIM_REDEEM_CODE_HASH_CONTEXT = 'masterselects:credit-redeem-code:v1:';
export const CREDIT_CLAIM_LEDGER_SOURCE = 'manual:credit_claim';
export const FREE_CREDIT_CAMPAIGN = 'free-credit';
export const WEBSITE_FREE_CREDIT_CAMPAIGN = 'website-free-credit';

const MAX_CLAIM_AMOUNT = 1_000_000;
const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 256;
const FREE_OFFER_REDEEM_CODE_PATTERN = /^\d{6}$/;
const textEncoder = new TextEncoder();

export type CreditClaimStatus = 'available' | 'claimed' | 'expired' | 'invalid' | 'revoked';

export interface CreditClaimRow {
  amount: number;
  campaign: string | null;
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
  redeem_code_hash: string | null;
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
  freeOffer: boolean;
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

export async function hashCreditClaimRedeemCode(input: unknown): Promise<string> {
  const code = normalizeCreditClaimRedeemCode(input);
  if (!isValidCreditClaimRedeemCode(code)) {
    return '';
  }

  const digest = await crypto.subtle.digest(
    'SHA-256',
    textEncoder.encode(`${CREDIT_CLAIM_REDEEM_CODE_HASH_CONTEXT}${code}`),
  );
  return toHex(digest);
}

export function getCreditClaimLedgerSourceId(claimId: string): string {
  return `credit-claim:${claimId}`;
}

export function normalizeCreditClaimRedeemCode(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

export function isValidCreditClaimRedeemCode(input: unknown): boolean {
  return FREE_OFFER_REDEEM_CODE_PATTERN.test(normalizeCreditClaimRedeemCode(input));
}

export function isFreeCreditOffer(claim: CreditClaimRow): boolean {
  return claim.campaign === FREE_CREDIT_CAMPAIGN || claim.campaign === WEBSITE_FREE_CREDIT_CAMPAIGN;
}

export function isWebsiteFreeCreditOffer(claim: CreditClaimRow): boolean {
  return claim.campaign === WEBSITE_FREE_CREDIT_CAMPAIGN;
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
    freeOffer: isFreeCreditOffer(claim),
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
               revoked_at, metadata_json, campaign, redeem_code_hash
        FROM credit_claims
        WHERE token_hash = ?
        LIMIT 1
      `,
    )
    .bind(tokenHash)
    .first<CreditClaimRow>();
}

export async function getCreditClaimByRedeemCode(
  db: AppD1Database,
  code: unknown,
): Promise<CreditClaimRow | null> {
  const redeemCodeHash = await hashCreditClaimRedeemCode(code);
  if (!redeemCodeHash) {
    return null;
  }

  return db
    .prepare(
      `
        SELECT id, token_hash, amount, title, description, expected_email, expires_at,
               created_by, created_at, claimed_by_user_id, claimed_email, claimed_at,
               revoked_at, metadata_json, campaign, redeem_code_hash
        FROM credit_claims
        WHERE redeem_code_hash = ?
        LIMIT 1
      `,
    )
    .bind(redeemCodeHash)
    .first<CreditClaimRow>();
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
  const campaignId = isFreeCreditOffer(claim) ? claim.campaign : null;
  const isFreeOffer = Boolean(campaignId);
  const ledgerEntryId = crypto.randomUUID();
  const sourceId = getCreditClaimLedgerSourceId(claim.id);
  const metadata = JSON.stringify({
    claim_id: claim.id,
    email_locked: Boolean(expectedEmail),
    title: claim.title,
  });

  const reservation = isFreeOffer
    ? db
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
            AND EXISTS (
              SELECT 1
              FROM credit_claim_campaigns
              WHERE id = ?
                AND is_armed = 1
                AND active_claim_id = ?
            )
        `,
      )
      .bind(user.id, requestedEmail, claimedAt, claim.id, claimedAt, campaignId, claim.id)
    : db
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
      .bind(user.id, requestedEmail, claimedAt, claim.id, claimedAt);

  const ledger = db
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
        SELECT
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
        WHERE EXISTS (
          SELECT 1
          FROM credit_claims
          WHERE id = ?
            AND claimed_by_user_id = ?
            AND claimed_at = ?
        )
        ${isFreeOffer ? `
          AND EXISTS (
            SELECT 1
            FROM credit_claim_campaigns
            WHERE id = ?
              AND is_armed = 0
              AND claimed_claim_id = ?
          )
        ` : ''}
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
      claim.id,
      user.id,
      claimedAt,
      ...(isFreeOffer ? [campaignId, claim.id] : []),
    );

  const statements: AppD1Statement[] = [reservation];
  if (isFreeOffer) {
    statements.push(
      db
        .prepare(
          `
            UPDATE credit_claim_campaigns
            SET is_armed = 0,
                claimed_claim_id = ?,
                active_claim_id = NULL,
                updated_at = ?
            WHERE id = ?
              AND is_armed = 1
              AND active_claim_id = ?
              AND EXISTS (
                SELECT 1
                FROM credit_claims
                WHERE id = ?
                  AND claimed_by_user_id = ?
                  AND claimed_at = ?
              )
          `,
        )
        .bind(claim.id, claimedAt, campaignId, claim.id, claim.id, user.id, claimedAt),
    );
  }
  statements.push(ledger);

  try {
    const results = await db.batch(statements);
    const reservationChanges = getRunChanges(results[0]);
    const ledgerChanges = getRunChanges(results.at(-1));

    if ((reservationChanges !== null && reservationChanges < 1)
      || (ledgerChanges !== null && ledgerChanges < 1)) {
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
  } catch {
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

  return {
    amount,
    claimedAt,
    creditBalance: await getCreditBalance(db, user.id),
    ledgerEntryId,
    ok: true,
    status: 'redeemed',
  };
}
