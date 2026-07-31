import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  advanceVariantComparisonPlayback,
  createVariantComparisonPlaybackState,
  seekVariantComparisonPlayback,
  setVariantComparisonPlaying,
} from '../../src/services/storyboard/variants';
import { StoryboardVariantComparisonTray } from '../../src/components/storyboard/variants';
import type {
  StoryboardCandidate,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../src/services/storyboard/contracts';

const fingerprint = {
  schemaVersion: 1 as const,
  algorithm: 'sha-256' as const,
  value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
};

function emptyFragment() {
  return {
    schemaVersion: 1 as const,
    durationSeconds: 10,
    tracks: [],
    clips: [],
    links: [],
    keyframes: [],
    effects: [],
    masks: [],
    transitions: [],
    markers: [],
    annotations: [],
    sceneIds: [],
    candidateIds: [],
    warnings: [],
  };
}

const variantSet: TimelineVariantSet = {
  schemaVersion: 1,
  id: 'set-ui',
  title: 'Range alternatives',
  baseCompositionId: 'base',
  sceneIds: [],
  scope: {
    startTime: 10,
    endTime: 20,
    trackIds: ['video-1'],
    includeLinked: true,
  },
  baseFingerprint: fingerprint,
  boundaryFingerprint: fingerprint,
  status: 'review',
  optionIds: ['a', 'b', 'c'],
  createdAt: 1,
};

const options: TimelineVariantOption[] = [
  {
    schemaVersion: 1,
    id: 'a',
    variantSetId: variantSet.id,
    title: 'Balanced',
    rationale: 'Clear and faithful.',
    state: 'ready',
    fragment: emptyFragment(),
    materializedCompositionId: 'comp-a',
    candidateIds: [],
  },
  {
    schemaVersion: 1,
    id: 'b',
    variantSetId: variantSet.id,
    title: 'Dynamic',
    rationale: 'Faster and sharper.',
    state: 'building',
    fragment: emptyFragment(),
    materializedCompositionId: 'comp-b',
    candidateIds: ['candidate-b'],
  },
  {
    schemaVersion: 1,
    id: 'c',
    variantSetId: variantSet.id,
    title: 'Alternative',
    rationale: 'A different structure.',
    state: 'failed',
    fragment: emptyFragment(),
    candidateIds: ['candidate-c'],
  },
];

const candidateBase: Omit<StoryboardCandidate, 'id' | 'state'> = {
  schemaVersion: 1,
  sceneId: 'scene-1',
  kind: 'generated-video',
  sourceMomentHandles: [],
  createdAt: 1,
};

describe('variant synchronized comparison playback', () => {
  it('clamps seeks, loops inside the range, and stops at the end when loop is off', () => {
    let state = createVariantComparisonPlaybackState(variantSet.scope);
    state = seekVariantComparisonPlayback(state, 100);
    expect(state.playhead).toBe(20);
    state = setVariantComparisonPlaying(state, true);
    expect(state.playhead).toBe(10);
    state = advanceVariantComparisonPlayback(state, 12);
    expect(state.playhead).toBe(12);
    state = { ...state, loop: false, playing: true, playhead: 19 };
    state = advanceVariantComparisonPlayback(state, 2);
    expect(state).toMatchObject({ playhead: 20, playing: false });
  });
});
describe('StoryboardVariantComparisonTray', () => {
  it('renders partial/failed state honestly and exposes accessible option controls', async () => {
    const user = userEvent.setup();
    const onOptionSelect = vi.fn();
    const onAccept = vi.fn();
    const candidates: Record<string, StoryboardCandidate> = {
      'candidate-b': {
        ...candidateBase,
        id: 'candidate-b',
        state: 'processing',
        estimatedCredits: 12,
      },
      'candidate-c': {
        ...candidateBase,
        id: 'candidate-c',
        state: 'failed',
        estimatedCredits: 12,
      },
    };
    render(
      <StoryboardVariantComparisonTray
        activeOptionId="a"
        candidates={candidates}
        isPlaying={false}
        loop
        onAccept={onAccept}
        onOptionSelect={onOptionSelect}
        onPlayPause={vi.fn()}
        onRefine={vi.fn()}
        onReject={vi.fn()}
        onSeek={vi.fn()}
        onToggleLoop={vi.fn()}
        options={options}
        playhead={10}
        variantSet={variantSet}
      />,
    );

    expect(screen.getByRole('tablist', { name: /Variant options/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /Dynamic.*Partially playable/i }))
      .not.toBeDisabled();
    expect(screen.getByRole('tab', { name: /Alternative.*Failed/i }))
      .toBeDisabled();
    await user.click(screen.getByRole('tab', { name: /Dynamic/i }));
    expect(onOptionSelect).toHaveBeenCalledWith('b');
    await user.click(screen.getByRole('button', { name: /Select for commit/i }));
    expect(onAccept).toHaveBeenCalledWith('a');
    expect(screen.getByText(/10\.0–00:20\.0/)).toBeTruthy();
  });
});
