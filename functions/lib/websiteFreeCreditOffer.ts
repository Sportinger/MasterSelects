import {
  appendSetCookie,
  buildCookieOptions,
  readCookie,
  signStructuredValue,
  verifyStructuredValue,
} from './auth';
import {
  WEBSITE_FREE_CREDIT_CAMPAIGN,
  hashCreditClaimRedeemCode,
  hashCreditClaimToken,
  isWebsiteFreeCreditOffer,
  type CreditClaimRow,
} from './creditClaims';
import type { AppD1Database, Env } from './env';

export const WEBSITE_FREE_CREDIT_AMOUNT = 3_000;
export const WEBSITE_FREE_CREDIT_DURATION_MS = 60 * 60 * 1_000;

const WEBSITE_FREE_CREDIT_COOKIE = '__ms_website_free_credit';

interface WebsiteFreeCreditCookie {
  claimId: string;
  expiresAt: string;
  redeemCode: string;
}

interface WebsiteFreeCreditRow {
  amount: number;
  expires_at: string;
  id: string;
  redeem_code_hash: string;
}

interface WebsiteFreeCreditCampaignRow {
  active_claim_id: string | null;
  active_is_available: number;
  is_armed: number;
}

export interface WebsiteFreeCreditOffer {
  amount: number;
  expiresAt: string;
  redeemCode: string;
}

function createToken(): string {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

function createRedeemCode(): string {
  const values = new Uint32Array(1);
  const limit = 2 ** 32 - ((2 ** 32) % 1_000_000);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= limit);
  return String(values[0] % 1_000_000).padStart(6, '0');
}

function isWebsiteFreeCreditCookie(value: unknown): value is WebsiteFreeCreditCookie {
  if (!value || typeof value !== 'object') return false;
  const cookie = value as Partial<WebsiteFreeCreditCookie>;
  return typeof cookie.claimId === 'string'
    && /^\d{6}$/.test(cookie.redeemCode ?? '')
    && typeof cookie.expiresAt === 'string'
    && Number.isFinite(Date.parse(cookie.expiresAt));
}

async function readWebsiteFreeCreditCookie(env: Env, request: Request): Promise<WebsiteFreeCreditCookie | null> {
  const value = await verifyStructuredValue<unknown>(env, readCookie(request, WEBSITE_FREE_CREDIT_COOKIE));
  return isWebsiteFreeCreditCookie(value) && Date.parse(value.expiresAt) > Date.now() ? value : null;
}

async function getCurrentOffer(
  db: AppD1Database,
  cookie: WebsiteFreeCreditCookie | null,
  now: string,
): Promise<WebsiteFreeCreditOffer | null> {
  if (!cookie) return null;

  const row = await db
    .prepare(
      `
        SELECT claim.id, claim.amount, claim.expires_at, claim.redeem_code_hash
        FROM credit_claim_campaigns AS campaign
        JOIN credit_claims AS claim ON claim.id = campaign.active_claim_id
        WHERE campaign.id = ?
          AND campaign.is_armed = 1
          AND claim.id = ?
          AND claim.claimed_at IS NULL
          AND claim.revoked_at IS NULL
          AND claim.expires_at > ?
        LIMIT 1
      `,
    )
    .bind(WEBSITE_FREE_CREDIT_CAMPAIGN, cookie.claimId, now)
    .first<WebsiteFreeCreditRow>();

  if (!row || row.redeem_code_hash !== await hashCreditClaimRedeemCode(cookie.redeemCode)) return null;
  return { amount: Number(row.amount), expiresAt: row.expires_at, redeemCode: cookie.redeemCode };
}

export async function acquireWebsiteFreeCreditOffer(
  env: Env,
  request: Request,
  now = new Date(),
): Promise<WebsiteFreeCreditOffer | null> {
  const nowIso = now.toISOString();
  const current = await getCurrentOffer(
    env.DB,
    await readWebsiteFreeCreditCookie(env, request),
    nowIso,
  );
  if (current) return current;

  const campaign = await env.DB
    .prepare(
      `
        SELECT campaign.is_armed,
               campaign.active_claim_id,
               CASE WHEN active.id IS NOT NULL
                          AND active.claimed_at IS NULL
                          AND active.revoked_at IS NULL
                          AND active.expires_at > ?
                    THEN 1 ELSE 0 END AS active_is_available
        FROM credit_claim_campaigns AS campaign
        LEFT JOIN credit_claims AS active ON active.id = campaign.active_claim_id
        WHERE campaign.id = ?
        LIMIT 1
      `,
    )
    .bind(nowIso, WEBSITE_FREE_CREDIT_CAMPAIGN)
    .first<WebsiteFreeCreditCampaignRow>();

  if (Number(campaign?.is_armed) !== 1 || Number(campaign?.active_is_available) === 1) return null;

  const claimId = crypto.randomUUID();
  const redeemCode = createRedeemCode();
  const redeemCodeHash = await hashCreditClaimRedeemCode(redeemCode);
  const tokenHash = await hashCreditClaimToken(createToken());
  const expiresAt = new Date(now.getTime() + WEBSITE_FREE_CREDIT_DURATION_MS).toISOString();

  await env.DB.batch([
    env.DB
      .prepare(
        `
          INSERT OR IGNORE INTO credit_claims (
            id, token_hash, amount, title, description, expected_email, expires_at,
            campaign, created_by, metadata_json, redeem_code_hash
          )
          VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `,
      )
      .bind(
        claimId,
        tokenHash,
        WEBSITE_FREE_CREDIT_AMOUNT,
        'FREE FOR YOU',
        'A one-hour MasterSelects welcome gift.',
        expiresAt,
        WEBSITE_FREE_CREDIT_CAMPAIGN,
        'website-offer',
        JSON.stringify({ automatic: true, campaign: WEBSITE_FREE_CREDIT_CAMPAIGN }),
        redeemCodeHash,
      ),
    env.DB
      .prepare(
        `
          UPDATE credit_claim_campaigns
          SET active_claim_id = ?, updated_at = ?
          WHERE id = ?
            AND is_armed = 1
            AND EXISTS (SELECT 1 FROM credit_claims WHERE id = ?)
            AND (
              active_claim_id IS NULL
              OR NOT EXISTS (
                SELECT 1
                FROM credit_claims
                WHERE id = credit_claim_campaigns.active_claim_id
                  AND claimed_at IS NULL
                  AND revoked_at IS NULL
                  AND expires_at > ?
              )
            )
        `,
      )
      .bind(claimId, nowIso, WEBSITE_FREE_CREDIT_CAMPAIGN, claimId, nowIso),
  ]);

  const activeClaimId = await env.DB
    .prepare('SELECT active_claim_id FROM credit_claim_campaigns WHERE id = ? LIMIT 1')
    .bind(WEBSITE_FREE_CREDIT_CAMPAIGN)
    .first<string>('active_claim_id');

  if (activeClaimId !== claimId) {
    await env.DB
      .prepare('UPDATE credit_claims SET revoked_at = ?, redeem_code_hash = NULL WHERE id = ? AND claimed_at IS NULL')
      .bind(nowIso, claimId)
      .run();
    return null;
  }

  return { amount: WEBSITE_FREE_CREDIT_AMOUNT, expiresAt, redeemCode };
}

export async function setWebsiteFreeCreditOfferCookie(
  env: Env,
  request: Request,
  headers: Headers,
  offer: WebsiteFreeCreditOffer,
): Promise<void> {
  const claimId = await env.DB
    .prepare('SELECT active_claim_id FROM credit_claim_campaigns WHERE id = ? LIMIT 1')
    .bind(WEBSITE_FREE_CREDIT_CAMPAIGN)
    .first<string>('active_claim_id');
  if (!claimId) return;

  const value = await signStructuredValue(env, {
    claimId,
    expiresAt: offer.expiresAt,
    redeemCode: offer.redeemCode,
  } satisfies WebsiteFreeCreditCookie);
  appendSetCookie(headers, WEBSITE_FREE_CREDIT_COOKIE, value, buildCookieOptions(request, {
    expires: new Date(offer.expiresAt),
    maxAge: Math.max(0, Math.ceil((Date.parse(offer.expiresAt) - Date.now()) / 1_000)),
  }));
}

export async function hasMatchingWebsiteFreeCreditOfferCookie(
  env: Env,
  request: Request,
  claim: CreditClaimRow,
): Promise<boolean> {
  if (!isWebsiteFreeCreditOffer(claim)) return true;
  const cookie = await readWebsiteFreeCreditCookie(env, request);
  return Boolean(
    cookie
    && cookie.claimId === claim.id
    && claim.redeem_code_hash
    && claim.redeem_code_hash === await hashCreditClaimRedeemCode(cookie.redeemCode),
  );
}
