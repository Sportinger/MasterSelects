import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const stop = vi.hoisted(() => vi.fn());

vi.mock('../../src/marketing/useSeedancePreproductionController', () => ({
  useSeedancePreproductionController: () => ({
    chooseIdea: vi.fn(),
    chooseMaster: vi.fn(),
    continueFromMedia: vi.fn(),
    moreIdeas: vi.fn(),
    readyKeyframeCount: 0,
    regenerateMasters: vi.fn(),
    regenerateSelected: vi.fn(),
    replanAssets: vi.fn(),
    retrySourceResearch: vi.fn(),
    reset: vi.fn(),
    run: {
      schemaVersion: 1,
      id: 'run-1',
      createdAt: 1,
      updatedAt: 1,
      prompt: 'Build a video',
      preferences: {
        directionCount: 'auto',
        aiGeneration: 'auto',
        commons: 'auto',
        scenePlanning: 'auto',
      },
      phase: 'generating-ideas',
      ideas: [],
      storyExpanded: false,
      sourceAssets: [],
      researchDiagnostics: [],
      masterGenerationRound: 0,
      masterLooks: [],
      keyframeBriefs: [],
      keyframeVersions: [],
      acceptedVersionByBriefId: {},
      selectedKeyframeIds: [],
      segments: [],
    },
    setStoryExpanded: vi.fn(),
    start: vi.fn(),
    stop,
    toggleKeyframe: vi.fn(),
    toggleSourceAsset: vi.fn(),
  }),
}));

import { LandingPage } from '../../src/marketing/LandingPage';

afterEach(() => {
  cleanup();
  stop.mockReset();
});

describe('Seedance preproduction stop control', () => {
  it('keeps the busy action enabled and stops the active preproduction run', () => {
    render(<LandingPage selectedProjectId="project-1" />);

    const button = screen.getByRole('button', { name: 'Stop Story workflow' });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute('data-stoppable', 'true');

    fireEvent.click(button);

    expect(stop).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('Story workflow stopped.')).toHaveLength(2);
  });
});
