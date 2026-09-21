import { describe, expect, it } from 'vitest';
import {
  transitionFrameHistory,
  type FrameHistoryState,
  type FrameHistoryTransitionInput,
} from '../../src/effects/frameHistoryTransition';

const input = (timelineTimeSeconds: number, overrides: Partial<FrameHistoryTransitionInput> = {}): FrameHistoryTransitionInput => ({
  timelineTimeSeconds, ownerRevision: 'owner-a', resetRequested: false, ...overrides,
});

describe('frame-history transition contract', () => {
  it('starts empty and distinguishes same-frame holds from forward advances', () => {
    const initial = transitionFrameHistory(null, input(1));
    expect(initial).toMatchObject({ action: 'reset', reason: 'initial' });
    expect(transitionFrameHistory(initial.state, input(1))).toMatchObject({ action: 'hold', reason: 'same-frame' });
    expect(transitionFrameHistory(initial.state, input(1.04))).toMatchObject({ action: 'advance', reason: 'advance' });
  });

  it.each(['seek', 'export-start'] as const)('resets for an explicit %s boundary', discontinuity => {
    const previous = transitionFrameHistory(null, input(1)).state;
    expect(transitionFrameHistory(previous, input(2, { discontinuity }))).toMatchObject({ action: 'reset', reason: discontinuity });
  });

  it('resets backwards frames and owner revisions', () => {
    const previous = transitionFrameHistory(null, input(2)).state;
    expect(transitionFrameHistory(previous, input(1.5))).toMatchObject({ action: 'reset', reason: 'backwards' });
    expect(transitionFrameHistory(previous, input(2.1, { ownerRevision: 'owner-b' }))).toMatchObject({ action: 'reset', reason: 'owner-revision' });
  });

  it('applies reset and continuous loop policies explicitly', () => {
    const previous = transitionFrameHistory(null, input(4)).state;
    expect(transitionFrameHistory(previous, input(0, { discontinuity: 'loop', loopPolicy: 'reset' })))
      .toMatchObject({ action: 'reset', reason: 'loop' });
    expect(transitionFrameHistory(previous, input(0, { discontinuity: 'loop', loopPolicy: 'continuous' })))
      .toMatchObject({ action: 'advance', reason: 'advance' });
  });

  it('triggers explicit reset only on its rising edge', () => {
    const previous = transitionFrameHistory(null, input(1)).state;
    const reset = transitionFrameHistory(previous, input(1.1, { resetRequested: true }));
    expect(reset).toMatchObject({ action: 'reset', reason: 'explicit-reset' });
    expect(transitionFrameHistory(reset.state, input(1.2, { resetRequested: true })))
      .toMatchObject({ action: 'advance', reason: 'advance' });
    const released: FrameHistoryState = transitionFrameHistory(reset.state, input(1.3)).state;
    expect(transitionFrameHistory(released, input(1.4, { resetRequested: true })))
      .toMatchObject({ action: 'reset', reason: 'explicit-reset' });
  });
});
