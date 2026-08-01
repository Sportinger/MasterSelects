import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GuidedStepHud } from '../../src/components/guidedActions/GuidedStepHud';
import type {
  GuidedScheduledAction,
  GuidedSessionSnapshot,
} from '../../src/services/guidedActions';

describe('GuidedStepHud', () => {
  it('shows tutorial-step progress instead of internal action progress', () => {
    const currentStep = {
      action: { type: 'delay', ms: 100, label: 'Internal runtime delay' },
      compressed: false,
      compressedDurationMs: 100,
      family: 'feedback',
      index: 7,
      naturalDurationMs: 100,
      plannedDurationMs: 100,
      startsAtMs: 100,
    } satisfies GuidedScheduledAction;
    const session = {
      label: 'Tutorial: Workspace Basics',
      metadata: {
        tutorialSteps: [
          { id: 'media', title: 'Media', startActionIndex: 0, endActionIndex: 4 },
          { id: 'preview', title: 'Preview', startActionIndex: 5, endActionIndex: 9 },
          { id: 'timeline', title: 'Timeline', startActionIndex: 10, endActionIndex: 14 },
        ],
      },
      plan: { actions: [], diagnostics: {} },
    } as unknown as GuidedSessionSnapshot;

    render(<GuidedStepHud currentStep={currentStep} session={session} />);

    expect(screen.getByText('Workspace Basics')).toBeInTheDocument();
    expect(screen.getByText('Preview')).toBeInTheDocument();
    expect(screen.getByText('Step 2 / 3')).toBeInTheDocument();
    expect(screen.queryByText('Internal runtime delay')).not.toBeInTheDocument();
  });

  it('uses explicit progress for one-session-per-step tutorials', () => {
    const currentStep = {
      action: { type: 'waitForTutorialNavigation', label: 'Internal navigation wait' },
      compressed: false,
      compressedDurationMs: 0,
      family: 'validation',
      index: 4,
      naturalDurationMs: 0,
      plannedDurationMs: 0,
      startsAtMs: 900,
    } satisfies GuidedScheduledAction;
    const session = {
      label: 'Tutorial: Workspace Basics',
      metadata: {
        tutorialProgress: { current: 3, stepTitle: 'Timeline', total: 3 },
        tutorialSteps: [
          { id: 'timeline', title: 'Timeline', startActionIndex: 0, endActionIndex: 4 },
        ],
      },
      plan: { actions: [], diagnostics: {} },
    } as unknown as GuidedSessionSnapshot;

    render(<GuidedStepHud currentStep={currentStep} session={session} />);

    expect(screen.getByText('Workspace Basics')).toBeInTheDocument();
    expect(screen.getByText('Timeline')).toBeInTheDocument();
    expect(screen.getByText('Step 3 / 3')).toBeInTheDocument();
    expect(screen.queryByText('Internal navigation wait')).not.toBeInTheDocument();
  });
});
