import { timingSafeEqualStrings } from './constantTime';
import type { AppD1Database, AppUser } from './env';

export interface ReviewerAccount extends AppUser {
  credential_hash: string;
}

export class ReviewerAccessRevokedError extends Error {
  constructor() { super('Reviewer access revoked'); this.name = 'ReviewerAccessRevokedError'; }
}

/** Review accounts are provisioned explicitly; logging in never creates a user. */
export async function getReviewerAccount(db: AppD1Database, userId: string): Promise<ReviewerAccount | null> {
  return db.prepare(`SELECT u.id, u.email, r.credential_hash
    FROM reviewer_accounts r JOIN users u ON u.id = r.user_id
    WHERE r.user_id = ? AND r.enabled = 1`).bind(userId).first<ReviewerAccount>();
}

/** Includes disabled accounts, so ordinary sign-in cannot bypass review isolation. */
export async function isReviewerAccount(db: AppD1Database, userId: string): Promise<boolean> {
  const row = await db.prepare('SELECT user_id FROM reviewer_accounts WHERE user_id = ?')
    .bind(userId).first<{ user_id: string }>();
  return row !== null;
}

export async function hashReviewerCredential(credential: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyReviewerCredential(
  db: AppD1Database, userId: string, credential: string,
): Promise<ReviewerAccount | null> {
  // Only independently generated 256-bit credentials are supported, not human passwords.
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential) || userId.length > 80) return null;
  const account = await getReviewerAccount(db, userId);
  const hash = await hashReviewerCredential(credential);
  return account && timingSafeEqualStrings(hash, account.credential_hash) ? account : null;
}
