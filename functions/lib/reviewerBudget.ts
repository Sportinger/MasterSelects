import type { AppD1Database } from './env';
import { readRunChanges } from './d1Result';

export interface ReviewerCostUpperBound {
  /** Includes all providers, retries, taxes, FX and deferred work for this operation. */
  euroMicros: number;
  operationDigest: string;
}

/**
 * Only the winning insert may initiate upstream work. Replays never initiate it.
 * Reservations are deliberately not automatically refunded: timeouts and errors
 * do not prove that an external provider did not bill the request.
 * Callers must supply a proven maximum, never an estimate or client-supplied price.
 */
export async function reserveReviewerCost(
  db: AppD1Database, userId: string, requestId: string, bound: ReviewerCostUpperBound | null,
): Promise<'reserved' | 'replay' | 'blocked'> {
  if (!bound || !Number.isSafeInteger(bound.euroMicros) || bound.euroMicros <= 0
    || bound.euroMicros > 5_000_000 || !/^[a-f0-9]{64}$/.test(bound.operationDigest)
    || !requestId || requestId.length > 200) return 'blocked';
  try {
    const result = await db.prepare(`INSERT INTO reviewer_cost_reservations
      (user_id, request_id, operation_digest, upper_bound_eur_micros) VALUES (?, ?, ?, ?)`)
      .bind(userId, requestId, bound.operationDigest, bound.euroMicros).run();
    return readRunChanges(result) === 1 ? 'reserved' : 'blocked';
  } catch {
    // A uniqueness failure is a replay only when the entire operation matches.
    const existing = await db.prepare(`SELECT operation_digest, upper_bound_eur_micros
      FROM reviewer_cost_reservations WHERE user_id = ? AND request_id = ?`)
      .bind(userId, requestId)
      .first<{ operation_digest: string; upper_bound_eur_micros: number }>().catch(() => null);
    return existing?.operation_digest === bound.operationDigest
      && existing.upper_bound_eur_micros === bound.euroMicros ? 'replay' : 'blocked';
  }
}
