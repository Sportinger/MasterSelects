import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  beginLandingEditTurn,
  createLandingEditSession,
  selectLandingEditVariant,
  settleLandingEditTurn,
} from '../../src/marketing/landingEditSession';

describe('landing edit session', () => {
  beforeEach(() => {
    let sequence = 0;
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(
      () => `00000000-0000-4000-8000-${String(sequence += 1).padStart(12, '0')}`,
    );
  });

  it('keeps revisions on the active variant and extends its history branch', () => {
    const first = createLandingEditSession('job-1', 'Make an edit', 100);
    const ready = settleLandingEditTurn({
      compositionId: 'comp-1',
      now: 110,
      session: first.session,
      status: 'ready',
      targetVariantId: first.targetVariantId,
    });
    const next = beginLandingEditTurn({
      compositionId: 'comp-1',
      jobId: 'job-2',
      mode: 'revise',
      now: 120,
      prompt: 'Shorten the hook',
      session: ready,
    });

    expect(next.session.variants).toHaveLength(1);
    expect(next.requestHistoryMessageIds).toEqual(['user-job-1', 'assistant-job-1']);
    expect(next.session.variants[0]).toMatchObject({
      compositionId: 'comp-1',
      historyMessageIds: [
        'user-job-1',
        'assistant-job-1',
        'user-job-2',
        'assistant-job-2',
      ],
      latestPrompt: 'Shorten the hook',
      status: 'running',
    });
  });

  it('creates an isolated sibling branch only for an explicit new version', () => {
    const first = createLandingEditSession('job-1', 'Make an edit', 100);
    const ready = settleLandingEditTurn({
      compositionId: 'comp-1',
      session: first.session,
      status: 'ready',
      targetVariantId: first.targetVariantId,
    });
    const variant = beginLandingEditTurn({
      compositionId: 'comp-2',
      jobId: 'job-2',
      mode: 'variant',
      prompt: 'Try a calmer version',
      session: ready,
    });

    expect(variant.session.variants).toHaveLength(2);
    expect(variant.requestHistoryMessageIds).toEqual(['user-job-1', 'assistant-job-1']);
    expect(variant.session.variants[0]?.historyMessageIds).toEqual([
      'user-job-1',
      'assistant-job-1',
    ]);
    expect(variant.session.variants[1]).toMatchObject({
      compositionId: 'comp-2',
      historyMessageIds: [
        'user-job-1',
        'assistant-job-1',
        'user-job-2',
        'assistant-job-2',
      ],
      label: 'Version 2',
      parentVariantId: first.targetVariantId,
    });
  });

  it('only selects variants backed by a composition', () => {
    const first = createLandingEditSession('job-1', 'Make an edit', 100);
    expect(selectLandingEditVariant(first.session, first.targetVariantId)).toBeNull();
    const ready = settleLandingEditTurn({
      compositionId: 'comp-1',
      session: first.session,
      status: 'ready',
      targetVariantId: first.targetVariantId,
    });
    expect(selectLandingEditVariant(ready, first.targetVariantId)?.activeVariantId)
      .toBe(first.targetVariantId);
  });
});
