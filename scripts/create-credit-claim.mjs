#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const CREDIT_CLAIM_HASH_CONTEXT = 'masterselects:credit-claim:v1:';
const DEFAULT_DATABASE_ID = 'a2f0a1aa-6bd9-4c75-9406-d09b93635eac';
const DEFAULT_URL_BASE = 'https://www.masterselects.com';
const MAX_CLAIM_AMOUNT = 1_000_000;

function usage() {
  console.log(`Usage:
  npm run credits:create-claim -- --amount 3000 --email user@example.com --description "3 reported issues"

Options:
  --amount <credits>       Required. Positive integer credit amount.
  --email <address>        Locks the claim to this verified account email.
  --unlocked               Allow any verified account to redeem the link.
  --title <text>           Claim page title. Default: "MasterSelects credit reward".
  --description <text>     Claim page description.
  --expires-days <days>    Expiration window. Default: 30. Use 0 for no expiry.
  --created-by <name>      Audit label. Default: cloudflare-admin.
  --url-base <url>         Public app URL. Default: ${DEFAULT_URL_BASE}.
  --dry-run                Print the claim without writing D1.

Environment:
  CLOUDFLARE_API_TOKEN     Required unless --dry-run.
  CLOUDFLARE_ACCOUNT_ID    Optional. Uses the first account if omitted.
  CLOUDFLARE_D1_DATABASE_ID Optional. Defaults to MasterSelects D1.`);
}

function parseArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const entry = argv[index];

    if (!entry.startsWith('--')) {
      continue;
    }

    const key = entry.slice(2);
    if (key === 'dry-run' || key === 'help' || key === 'unlocked') {
      args[key] = true;
      continue;
    }

    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }

    args[key] = value;
    index += 1;
  }

  return args;
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function asPositiveInteger(value, name) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_CLAIM_AMOUNT) {
    throw new Error(`${name} must be an integer between 1 and ${MAX_CLAIM_AMOUNT}.`);
  }

  return amount;
}

function asNonNegativeInteger(value, name) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return amount;
}

function createCode() {
  return randomBytes(32).toString('base64url');
}

function hashCode(code) {
  return createHash('sha256').update(`${CREDIT_CLAIM_HASH_CONTEXT}${code}`).digest('hex');
}

async function cloudflareRequest(path, options = {}) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    throw new Error('CLOUDFLARE_API_TOKEN is required.');
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });
  const payload = await response.json();

  if (!response.ok || !payload.success) {
    const message = payload.errors?.map((error) => error.message).join('; ') || `Cloudflare request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

async function resolveAccountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) {
    return process.env.CLOUDFLARE_ACCOUNT_ID;
  }

  const accounts = await cloudflareRequest('/accounts');
  const accountId = accounts?.[0]?.id;
  if (!accountId) {
    throw new Error('No Cloudflare account was returned for this token.');
  }

  return accountId;
}

async function insertClaim(claim) {
  const accountId = await resolveAccountId();
  const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || DEFAULT_DATABASE_ID;
  const sql = `
    INSERT INTO credit_claims (
      id,
      token_hash,
      amount,
      title,
      description,
      expected_email,
      expires_at,
      created_by,
      metadata_json
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  await cloudflareRequest(`/accounts/${accountId}/d1/database/${databaseId}/query`, {
    body: JSON.stringify({
      params: [
        claim.id,
        claim.tokenHash,
        claim.amount,
        claim.title,
        claim.description,
        claim.expectedEmail,
        claim.expiresAt,
        claim.createdBy,
        claim.metadataJson,
      ],
      sql,
    }),
    method: 'POST',
  });
}

function printClaim(claim) {
  console.log(JSON.stringify({
    amount: claim.amount,
    createdBy: claim.createdBy,
    description: claim.description,
    email: claim.expectedEmail,
    expiresAt: claim.expiresAt,
    id: claim.id,
    link: claim.link,
    title: claim.title,
  }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const amount = asPositiveInteger(args.amount, '--amount');
  const email = normalizeEmail(args.email);

  if (!args.unlocked && !isValidEmail(email)) {
    throw new Error('--email is required unless --unlocked is set.');
  }

  const expiresDays = asNonNegativeInteger(args['expires-days'] ?? '30', '--expires-days');
  const code = createCode();
  const urlBase = String(args['url-base'] || process.env.MASTERSELECTS_URL || DEFAULT_URL_BASE).replace(/\/+$/, '');
  const expiresAt = expiresDays > 0
    ? new Date(Date.now() + expiresDays * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const claim = {
    amount,
    createdBy: String(args['created-by'] || 'cloudflare-admin'),
    description: args.description ? String(args.description) : null,
    expectedEmail: args.unlocked ? null : email,
    expiresAt,
    id: randomUUID(),
    link: `${urlBase}/credits/claim?code=${encodeURIComponent(code)}`,
    metadataJson: JSON.stringify({
      created_with: 'scripts/create-credit-claim.mjs',
      recipient_locked: !args.unlocked,
    }),
    title: String(args.title || 'MasterSelects credit reward'),
    tokenHash: hashCode(code),
  };

  if (!args['dry-run']) {
    await insertClaim(claim);
  }

  printClaim(claim);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
