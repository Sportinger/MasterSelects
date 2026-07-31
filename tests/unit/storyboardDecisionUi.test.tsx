import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StoryboardDecisionCard } from '../../src/components/panels/flashboard/storyboard';
import { createStoryboardDecisionRecord } from '../../src/services/storyboard/decisions';
import {
  getStoryboardProjectSnapshot,
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../src/stores/storyboardStore';

function putDecision() {
  const decision = createStoryboardDecisionRecord({
    id: 'decision-ui',
    kind: 'story',
    question: 'Which opening?',
    baseFingerprint: {
      schemaVersion: 1,
      algorithm: 'sha-256',
      value: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
    },
    options: [
      {
        id: 'quiet',
        title: 'Quiet opening',
        summary: 'Begin with atmosphere.',
        tradeoffs: ['Slower'],
      },
      {
        id: 'direct',
        title: 'Direct opening',
        summary: 'Begin with the key claim.',
        tradeoffs: ['Less mystery'],
      },
    ],
    allowMultiple: false,
    allowFreeform: true,
  }, { createdAt: 10 });
  useStoryboardStore.getState().putDecision(decision);
  return decision;
}

describe('StoryboardDecisionCard', () => {
  beforeEach(() => {
    resetStoryboardProjectState();
  });

  it('renders without mutation and supports keyboard selection', async () => {
    const user = userEvent.setup();
    const decision = putDecision();
    const before = getStoryboardProjectSnapshot();
    const onSubmit = vi.fn();

    render(<StoryboardDecisionCard decisionId={decision.id} onSubmit={onSubmit} />);
    expect(getStoryboardProjectSnapshot()).toEqual(before);

    const direct = screen.getByRole('radio', { name: /Direct opening/i });
    direct.focus();
    await user.keyboard('[Space]');
    await user.click(screen.getByRole('button', { name: /Continue with selection/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      decisionId: decision.id,
      optionIds: ['direct'],
    });
    expect(useStoryboardStore.getState().decisions[decision.id]?.state).toBe('pending');
  });

  it('emits a more-like refinement without mutating the durable record', async () => {
    const user = userEvent.setup();
    const decision = putDecision();
    const onSubmit = vi.fn();
    render(<StoryboardDecisionCard decisionId={decision.id} onSubmit={onSubmit} />);

    const refineButtons = screen.getAllByRole('button', { name: /More like this/i });
    await user.click(refineButtons[1]!);
    expect(onSubmit).toHaveBeenCalledWith({
      decisionId: decision.id,
      optionIds: ['direct'],
      freeform: 'Create more options like Direct opening.',
      refinement: 'more-like',
    });
    expect(useStoryboardStore.getState().decisions[decision.id]?.state).toBe('pending');
  });
});
