import { recomputePreparedGenerationFingerprint } from './canonical';
import type {
  ApprovePreparedStoryboardGenerationInput,
  PreparedStoryboardGeneration,
  StoryboardGenerationApproval,
  StoryboardGenerationApprovalToken,
} from './types';
import { STORYBOARD_GENERATION_APPROVAL_TTL_MS } from './types';

interface StoredApproval {
  expiresAt: number;
  fingerprint: string;
  maxSpend: number;
  priceAmount: number;
  priceUnit: StoryboardGenerationApproval['priceUnit'];
  pricingVersion: string;
  projectId: string;
  requestCount: number;
  token: StoryboardGenerationApprovalToken;
  userId: string;
}

const approvals = new Map<StoryboardGenerationApprovalToken, StoredApproval>();

function createOpaqueToken(): StoryboardGenerationApprovalToken {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('Secure random approval tokens are unavailable in this runtime.');
  }
  return (
    `storyboard-approval:${globalThis.crypto.randomUUID()}`
  ) as StoryboardGenerationApprovalToken;
}

function assertApprovalTtl(expiresInMs: number): void {
  if (
    !Number.isFinite(expiresInMs)
    || expiresInMs <= 0
    || expiresInMs > 15 * 60 * 1000
  ) {
    throw new Error('Generation approval expiry must be between 1 ms and 15 minutes.');
  }
}

export async function approvePreparedStoryboardGeneration(
  prepared: PreparedStoryboardGeneration,
  input: ApprovePreparedStoryboardGenerationInput,
): Promise<StoryboardGenerationApproval> {
  if (input.explicitUserApproval !== true) {
    throw new Error('Generation requires explicit user approval.');
  }
  if (input.userId !== prepared.userId || input.projectId !== prepared.projectId) {
    throw new Error('Generation approval user/project does not match the prepared batch.');
  }
  if (input.priceUnit !== prepared.quote.perRequest.unit) {
    throw new Error('Generation approval price unit changed.');
  }
  if (
    !Number.isFinite(input.maxSpend)
    || input.maxSpend < prepared.quote.total
  ) {
    throw new Error('Generation approval maxSpend is below the exact prepared total.');
  }
  const recomputed = await recomputePreparedGenerationFingerprint(prepared);
  if (recomputed !== prepared.fingerprint) {
    throw new Error('Prepared generation changed before approval.');
  }

  const expiresInMs = input.expiresInMs ?? STORYBOARD_GENERATION_APPROVAL_TTL_MS;
  assertApprovalTtl(expiresInMs);
  const token = createOpaqueToken();
  const expiresAt = (input.now ?? Date.now()) + expiresInMs;
  approvals.set(token, {
    expiresAt,
    fingerprint: prepared.fingerprint,
    maxSpend: input.maxSpend,
    priceAmount: prepared.quote.perRequest.amount,
    priceUnit: input.priceUnit,
    pricingVersion: prepared.quote.perRequest.pricingVersion,
    projectId: input.projectId,
    requestCount: prepared.candidateCount,
    token,
    userId: input.userId,
  });
  return {
    expiresAt,
    maxSpend: input.maxSpend,
    priceUnit: input.priceUnit,
    token,
  };
}

export async function validateStoryboardGenerationApproval(
  prepared: PreparedStoryboardGeneration,
  token: StoryboardGenerationApprovalToken,
  input: { now: number; projectId: string; userId: string },
): Promise<StoredApproval> {
  const approval = approvals.get(token);
  if (!approval) throw new Error('Unknown or revoked generation approval token.');
  if (input.now >= approval.expiresAt) {
    approvals.delete(token);
    throw new Error('Generation approval token expired.');
  }
  if (
    input.userId !== approval.userId
    || input.projectId !== approval.projectId
    || prepared.userId !== approval.userId
    || prepared.projectId !== approval.projectId
  ) {
    throw new Error('Generation approval user/project changed.');
  }
  const recomputed = await recomputePreparedGenerationFingerprint(prepared);
  if (
    recomputed !== prepared.fingerprint
    || recomputed !== approval.fingerprint
  ) {
    throw new Error('Prepared request/count/route/provider/model changed after approval.');
  }
  if (prepared.candidateCount !== approval.requestCount) {
    throw new Error('Prepared generation request count changed after approval.');
  }
  if (
    prepared.quote.perRequest.amount !== approval.priceAmount
    || prepared.quote.perRequest.unit !== approval.priceUnit
    || prepared.quote.perRequest.pricingVersion !== approval.pricingVersion
  ) {
    throw new Error('Prepared generation price changed after approval.');
  }
  if (prepared.quote.total > approval.maxSpend) {
    throw new Error('Prepared generation exceeds approved maxSpend.');
  }
  return approval;
}

export function revokeStoryboardGenerationApproval(
  token: StoryboardGenerationApprovalToken,
): void {
  approvals.delete(token);
}
