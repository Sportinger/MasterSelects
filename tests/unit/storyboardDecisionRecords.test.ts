import { beforeEach, describe, expect, it } from 'vitest';
import {
  buildStoryboardDecisionContinuationPrompt,
  createStoryboardDecisionRecord,
  markStoryboardDecisionStale,
  resolveStoryboardDecisionRecord,
  validateStoryboardDecisionSelection,
} from '../../src/services/storyboard/decisions';
import {
  cloneStoryboardProjectState,
  type KernelDecisionPrompt,
} from '../../src/services/storyboard/contracts';
import {
  createEmptyStoryboardStoreProjectState,
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../src/stores/storyboardStore';
import {
  normalizeFlashBoardChatMessage,
  serializeFlashBoardChatMessage,
} from '../../src/services/project/flashBoardChatProjectCodec';

const prompt: KernelDecisionPrompt = {
  id: 'decision-cut-1',
  kind: 'cut',
  question: 'Which rhythm should lead the scene?',
  baseFingerprint: {
    schemaVersion: 1,
    algorithm: 'sha-256',
    value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  },
  options: [
    {
      id: 'balanced',
      title: 'Balanced',
      summary: 'Keep the pauses that carry meaning.',
      tradeoffs: ['Slightly longer'],
      estimatedCredits: 0,
    },
    {
      id: 'dynamic',
      title: 'Dynamic',
      summary: 'Tighten the pauses for momentum.',
      tradeoffs: ['Less breathing room'],
      estimatedCredits: 0,
    },
  ],
  allowFreeform: false,
};

describe('durable storyboard decisions', () => {
  beforeEach(() => {
    resetStoryboardProjectState();
  });

  it('validates, resolves, stales, and preserves refinement lineage inputs', () => {
    const decision = createStoryboardDecisionRecord(prompt, { createdAt: 10 });
    const valid = validateStoryboardDecisionSelection(decision, {
      decisionId: decision.id,
      optionIds: ['dynamic', 'dynamic'],
    });
    expect(valid).toEqual({
      ok: true,
      selection: {
        decisionId: decision.id,
        optionIds: ['dynamic'],
      },
    });

    const stale = validateStoryboardDecisionSelection(
      decision,
      { decisionId: decision.id, optionIds: ['balanced'] },
      {
        schemaVersion: 1,
        algorithm: 'sha-256',
        value: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    );
    expect(stale).toMatchObject({ ok: false, stale: true });

    const refinement = validateStoryboardDecisionSelection(decision, {
      decisionId: decision.id,
      optionIds: ['dynamic'],
      freeform: 'Create more options like Dynamic.',
      refinement: 'more-like',
    });
    expect(refinement).toMatchObject({
      ok: true,
      selection: { refinement: 'more-like' },
    });

    const resolved = resolveStoryboardDecisionRecord(
      decision,
      { decisionId: decision.id, optionIds: ['dynamic'] },
      20,
    );
    expect(resolved).toMatchObject({
      state: 'resolved',
      selectedOptionIds: ['dynamic'],
      resolvedAt: 20,
    });
    expect(markStoryboardDecisionStale(decision).state).toBe('stale');
    expect(buildStoryboardDecisionContinuationPrompt(
      decision,
      { decisionId: decision.id, optionIds: ['dynamic'] },
    )).toContain('Do not replay stored tool calls.');
  });

  it('survives storyboard store snapshot/reload and chat-message serialization', () => {
    const decision = createStoryboardDecisionRecord(prompt, { createdAt: 10 });
    useStoryboardStore.getState().putDecision(decision);

    const saved = cloneStoryboardProjectState(getStoryboardProjectSnapshot());
    resetStoryboardProjectState();
    expect(useStoryboardStore.getState().decisions).toEqual({});
    hydrateStoryboardProjectState(saved);
    expect(useStoryboardStore.getState().decisions[decision.id]).toEqual(decision);

    const serialized = serializeFlashBoardChatMessage({
      id: 'assistant-decision',
      role: 'assistant',
      text: 'Choose a rhythm.',
      decisionId: decision.id,
      createdAt: 10,
    });
    expect(normalizeFlashBoardChatMessage(serialized)).toMatchObject({
      id: 'assistant-decision',
      decisionId: decision.id,
    });

    const empty = createEmptyStoryboardStoreProjectState();
    expect(empty.decisions).toEqual({});
  });
});
