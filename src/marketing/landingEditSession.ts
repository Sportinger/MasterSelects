export type LandingReviewPromptMode = 'revise' | 'variant';

export type LandingEditVariantStatus = 'running' | 'ready' | 'failed';

export interface LandingEditVariant {
  compositionId?: string;
  createdAt: number;
  historyMessageIds: string[];
  id: string;
  label: string;
  latestPrompt: string;
  parentVariantId?: string;
  status: LandingEditVariantStatus;
  updatedAt: number;
}

export interface LandingEditSession {
  activeVariantId: string;
  createdAt: number;
  id: string;
  variants: LandingEditVariant[];
}

export interface LandingEditTurn {
  requestHistoryMessageIds: string[];
  session: LandingEditSession;
  targetVariantId: string;
}

function createVariantId(): string {
  return `landing-variant-${globalThis.crypto.randomUUID()}`;
}

function turnMessageIds(jobId: string): string[] {
  return [`user-${jobId}`, `assistant-${jobId}`];
}

export function createLandingEditSession(
  jobId: string,
  prompt: string,
  now = Date.now(),
): LandingEditTurn {
  const variantId = createVariantId();
  return {
    requestHistoryMessageIds: [],
    session: {
      activeVariantId: variantId,
      createdAt: now,
      id: `landing-edit-${globalThis.crypto.randomUUID()}`,
      variants: [{
        createdAt: now,
        historyMessageIds: turnMessageIds(jobId),
        id: variantId,
        label: 'Version 1',
        latestPrompt: prompt,
        status: 'running',
        updatedAt: now,
      }],
    },
    targetVariantId: variantId,
  };
}

export function beginLandingEditTurn(input: {
  compositionId: string;
  jobId: string;
  mode: LandingReviewPromptMode;
  now?: number;
  prompt: string;
  session: LandingEditSession;
}): LandingEditTurn {
  const now = input.now ?? Date.now();
  const selected = input.session.variants.find(
    variant => variant.id === input.session.activeVariantId,
  );
  if (!selected) throw new Error('The selected chat edit version is no longer available.');

  const requestHistoryMessageIds = [...selected.historyMessageIds];
  if (input.mode === 'variant') {
    const variantId = createVariantId();
    const nextVariant: LandingEditVariant = {
      compositionId: input.compositionId,
      createdAt: now,
      historyMessageIds: [...requestHistoryMessageIds, ...turnMessageIds(input.jobId)],
      id: variantId,
      label: `Version ${input.session.variants.length + 1}`,
      latestPrompt: input.prompt,
      parentVariantId: selected.id,
      status: 'running',
      updatedAt: now,
    };
    return {
      requestHistoryMessageIds,
      session: {
        ...input.session,
        activeVariantId: variantId,
        variants: [...input.session.variants, nextVariant],
      },
      targetVariantId: variantId,
    };
  }

  return {
    requestHistoryMessageIds,
    session: {
      ...input.session,
      variants: input.session.variants.map(variant => (
        variant.id === selected.id
          ? {
              ...variant,
              compositionId: input.compositionId,
              historyMessageIds: [...requestHistoryMessageIds, ...turnMessageIds(input.jobId)],
              latestPrompt: input.prompt,
              status: 'running',
              updatedAt: now,
            }
          : variant
      )),
    },
    targetVariantId: selected.id,
  };
}

export function settleLandingEditTurn(input: {
  compositionId: string;
  now?: number;
  session: LandingEditSession;
  status: Extract<LandingEditVariantStatus, 'ready' | 'failed'>;
  targetVariantId: string;
}): LandingEditSession {
  const now = input.now ?? Date.now();
  return {
    ...input.session,
    activeVariantId: input.targetVariantId,
    variants: input.session.variants.map(variant => (
      variant.id === input.targetVariantId
        ? {
            ...variant,
            compositionId: input.compositionId,
            status: input.status,
            updatedAt: now,
          }
        : variant
    )),
  };
}

export function selectLandingEditVariant(
  session: LandingEditSession,
  variantId: string,
): LandingEditSession | null {
  const variant = session.variants.find(candidate => candidate.id === variantId);
  if (!variant?.compositionId) return null;
  return session.activeVariantId === variantId
    ? session
    : { ...session, activeVariantId: variantId };
}

export function isLandingEditSession(value: unknown): value is LandingEditSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LandingEditSession>;
  return typeof candidate.id === 'string'
    && typeof candidate.activeVariantId === 'string'
    && typeof candidate.createdAt === 'number'
    && Array.isArray(candidate.variants)
    && candidate.variants.length > 0
    && candidate.variants.length <= 30
    && candidate.variants.some(variant => variant?.id === candidate.activeVariantId)
    && candidate.variants.every(variant => (
      variant
      && typeof variant.id === 'string'
      && typeof variant.label === 'string'
      && typeof variant.latestPrompt === 'string'
      && typeof variant.createdAt === 'number'
      && typeof variant.updatedAt === 'number'
      && (variant.status === 'running' || variant.status === 'ready' || variant.status === 'failed')
      && (variant.compositionId === undefined || typeof variant.compositionId === 'string')
      && (variant.parentVariantId === undefined || typeof variant.parentVariantId === 'string')
      && Array.isArray(variant.historyMessageIds)
      && variant.historyMessageIds.length <= 400
      && variant.historyMessageIds.every(id => typeof id === 'string' && id.length <= 240)
    ));
}
