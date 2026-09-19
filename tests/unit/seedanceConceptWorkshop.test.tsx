import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SeedanceConceptWorkshop } from '../../src/marketing/SeedanceConceptWorkshop';
import { SeedanceOrchestrationActivity } from '../../src/marketing/SeedanceOrchestrationActivity';
import type { SeedancePreproductionRun } from '../../src/services/seedancePreproduction/contracts';
import {
  DEFAULT_SEEDANCE_STORY_PREFERENCES,
  type FinalVisualStoryConcept,
  type VisualStoryConcept,
} from '../../src/services/seedancePreproduction/orchestrationContracts';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function concept(index: number): VisualStoryConcept {
  return {
    schemaVersion: 1,
    id: `draft-${index}`,
    title: `Draft ${index}`,
    deliverableFormat: 'One long-form visual explainer.',
    visualSummary: Array.from({ length: 3 }, (_, sentence) => `Visual summary ${index}.${sentence + 1}.`),
    visualDramaturgy: Array.from({ length: 10 }, (_, sentence) => `Visual dramaturgy ${index}.${sentence + 1}.`),
    premise: `Premise ${index}`,
    summary: `Story summary ${index}`,
    visualCohesion: `Visual thread ${index}`,
    productionApproach: `Production approach ${index}`,
    strongestOpportunity: `Opportunity ${index}`,
    largestRisk: `Risk ${index}`,
    targetDurationSeconds: 660,
  };
}

function finalConcept(index: number): FinalVisualStoryConcept {
  return {
    ...concept(index),
    id: `final-${index}`,
    title: `Final direction ${index}`,
    rank: index,
    lineage: {
      originalConceptId: `draft-${index}`,
      reviewId: `review-${index}`,
      source: 'orchestrator-revision',
    },
    changeSummary: `The root revision for direction ${index}.`,
  };
}

function run(finalConcepts: FinalVisualStoryConcept[]): SeedancePreproductionRun {
  const drafts = Array.from({ length: 5 }, (_, index) => concept(index + 1));
  return {
    schemaVersion: 1,
    id: 'run-1',
    createdAt: 1,
    updatedAt: 2,
    prompt: 'Build five directions.',
    preferences: DEFAULT_SEEDANCE_STORY_PREFERENCES,
    phase: 'choosing-idea',
    ideas: [],
    orchestrationCursor: 1,
    orchestrationEvents: [],
    scenePlans: [],
    orchestration: {
      schemaVersion: 1,
      kind: 'seedance-orchestration-run',
      runId: 'orchestration-1',
      prompt: 'Build five directions.',
      sourceBundleId: 'source-bundle-1',
      snapshotFingerprint: 'fingerprint',
      phase: finalConcepts.length > 0 ? 'awaiting-selection' : 'ideating',
      createdAt: 1,
      updatedAt: 2,
      nextSequence: 1,
      drafts,
      reviews: [],
      finalConcepts,
      scenePlanCount: 0,
      agents: [{
        schemaVersion: 1,
        id: 'root-orchestrator',
        role: 'orchestrator',
        status: 'running',
      }],
    },
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
  };
}

describe('Seedance concept workshop', () => {
  it('replaces the live drafts with the revised final reading view', () => {
    const { container } = render(
      <SeedanceConceptWorkshop
        chooseIdea={vi.fn().mockResolvedValue(undefined)}
        resume={vi.fn()}
        run={run(Array.from({ length: 5 }, (_, index) => finalConcept(index + 1)))}
      />,
    );

    expect(screen.queryByRole('region', { name: 'Original concepts and reviews' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose the visual direction' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Final concept options' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Choose direction' })).toHaveLength(5);
    expect(container.querySelectorAll('.seedance-workshop-final-visual')).toHaveLength(5);
    expect(screen.getAllByText('One long-form visual explainer.')).toHaveLength(5);
    expect(container.querySelectorAll('details.seedance-workshop-final-more:not([open])')).toHaveLength(5);
    expect(container.querySelectorAll('.seedance-workshop-final-details > .is-production')).toHaveLength(5);
  });

  it('keeps the live workshop visible until final directions exist', () => {
    render(<SeedanceConceptWorkshop chooseIdea={vi.fn().mockResolvedValue(undefined)} resume={vi.fn()} run={run([])} />);

    expect(screen.getByRole('region', { name: 'Original concepts and reviews' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Final concept options' })).not.toBeInTheDocument();
  });

  it('does not present a runtime when the user did not request one', () => {
    const concepts = Array.from({ length: 5 }, (_, index) => {
      const { targetDurationSeconds: _duration, ...value } = finalConcept(index + 1);
      return value;
    });
    render(<SeedanceConceptWorkshop
      chooseIdea={vi.fn().mockResolvedValue(undefined)}
      resume={vi.fn()}
      run={run(concepts)}
    />);

    expect(screen.getAllByText('Final option')).toHaveLength(5);
    expect(screen.queryByText(/660s/u)).not.toBeInTheDocument();
  });

  it('surfaces the latest failure and retains every observed orchestration update', () => {
    const failed = run(Array.from({ length: 5 }, (_, index) => finalConcept(index + 1)));
    failed.phase = 'failed';
    failed.orchestration!.phase = 'failed';
    failed.orchestration!.error = 'The story worker returned an invalid request.';
    failed.orchestrationEvents = [{
      schemaVersion: 1,
      eventId: 'orchestration-1:2',
      runId: 'orchestration-1',
      sequence: 2,
      createdAt: 2,
      kind: 'run.phase',
      payload: { phase: 'writing-story' },
    }, {
      schemaVersion: 1,
      eventId: 'orchestration-1:3',
      runId: 'orchestration-1',
      sequence: 3,
      createdAt: 3,
      kind: 'run.failed',
      payload: { error: 'The story worker returned an invalid request.' },
    }];

    render(<SeedanceOrchestrationActivity run={failed} />);

    expect(screen.getByRole('region', { name: 'Story live activity' })).toHaveClass('is-error');
    expect(screen.getByRole('status')).toHaveTextContent('Story workflow failed');
    expect(screen.getByRole('status')).toHaveTextContent('The story worker returned an invalid request.');
    expect(screen.getByText('2 observed updates')).toBeInTheDocument();
  });

  it('shows a newer resumed snapshot ahead of an older failure event', () => {
    const resumed = run(Array.from({ length: 5 }, (_, index) => finalConcept(index + 1)));
    resumed.phase = 'writing-story';
    resumed.orchestration!.phase = 'writing-story';
    resumed.orchestration!.updatedAt = 10;
    resumed.orchestrationEvents = [{
      schemaVersion: 1,
      eventId: 'orchestration-1:3',
      runId: 'orchestration-1',
      sequence: 3,
      createdAt: 3,
      kind: 'run.failed',
      payload: { error: 'An earlier attempt failed.' },
    }];

    render(<SeedanceOrchestrationActivity run={resumed} />);

    expect(screen.getByRole('status')).toHaveTextContent('Writing the selected story');
    expect(screen.getByText('1 observed updates')).toBeInTheDocument();
  });

  it('shows live overall and current-step time plus durations for observed updates', () => {
    vi.useFakeTimers();
    vi.setSystemTime(61_000);
    const active = run(Array.from({ length: 5 }, (_, index) => finalConcept(index + 1)));
    active.orchestration!.phase = 'planning-scenes';
    active.orchestration!.createdAt = 1_000;
    active.orchestration!.updatedAt = 41_000;
    active.orchestrationEvents = [{
      schemaVersion: 1,
      eventId: 'orchestration-1:1',
      runId: 'orchestration-1',
      sequence: 1,
      createdAt: 1_000,
      kind: 'run.started',
      payload: { phase: 'initializing' },
    }, {
      schemaVersion: 1,
      eventId: 'orchestration-1:2',
      runId: 'orchestration-1',
      sequence: 2,
      createdAt: 11_000,
      kind: 'run.phase',
      payload: { phase: 'awaiting-selection' },
    }, {
      schemaVersion: 1,
      eventId: 'orchestration-1:3',
      runId: 'orchestration-1',
      sequence: 3,
      createdAt: 41_000,
      kind: 'run.phase',
      payload: { phase: 'planning-scenes' },
    }];

    render(<SeedanceOrchestrationActivity run={active} />);

    expect(screen.getByRole('status')).toHaveTextContent(/Overall work0:30/u);
    expect(screen.getByRole('status')).toHaveTextContent(/Current step0:20/u);
    expect(screen.getByText('3 observed updates')).toBeInTheDocument();
  });

  it('offers an explicit resume action while failed concepts remain visible', async () => {
    const resume = vi.fn();
    const failed = run(Array.from({ length: 5 }, (_, index) => finalConcept(index + 1)));
    failed.orchestration!.phase = 'failed';

    render(<SeedanceConceptWorkshop chooseIdea={vi.fn().mockResolvedValue(undefined)} resume={resume} run={failed} />);

    screen.getByRole('button', { name: 'Resume run' }).click();
    expect(resume).toHaveBeenCalledOnce();
  });
});
