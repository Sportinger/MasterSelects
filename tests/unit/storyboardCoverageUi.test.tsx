import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  StoryboardCoverageSummary,
  StoryboardDurationBadge,
  StoryboardEvidenceChips,
} from '../../src/components/properties/storyboard/coverage';
import type {
  StoryboardDurationAssessment,
  StoryboardEvidenceResolution,
} from '../../src/services/storyboard/coverage';
import type { StoryboardCoverage } from '../../src/services/storyboard/contracts';

afterEach(cleanup);

const repairableEvidence: StoryboardEvidenceResolution = {
  ref: {
    schemaVersion: 1,
    id: 'evidence-1',
    sceneId: 'scene-1',
    kind: 'transcript-moment',
    handle: '$m-old',
    indexVersion: 'v1',
    createdAt: 1,
  },
  status: 'repairable',
  label: 'A useful quote',
  detail: 'Stale transcript handle from v1; repair to $m-new in v2.',
  suggestedRef: {
    schemaVersion: 1,
    id: 'evidence-1',
    sceneId: 'scene-1',
    kind: 'transcript-moment',
    handle: '$m-new',
    indexVersion: 'v2',
    createdAt: 1,
  },
};

const coverage: StoryboardCoverage = {
  schemaVersion: 1,
  sceneId: 'scene-1',
  level: 'yellow',
  sourceScore: 0.62,
  generationReadinessScore: 0.8,
  reasons: [
    'Source: one transcript moment is current.',
    'Readiness gap: candidate awaits approval.',
  ],
  evaluatedAgainstFingerprint: {
    schemaVersion: 1,
    algorithm: 'sha-256',
    value: 'a'.repeat(64),
  },
  evaluatedAt: 1,
};

const duration: StoryboardDurationAssessment = {
  targetSeconds: 8,
  actualSeconds: 7.8,
  deltaSeconds: -0.2,
  deltaPercent: -2.5,
  toleranceSeconds: 0.4,
  tone: 'green',
  toneLabel: 'Within tolerance',
  badgeLabel: '8.0s target / 7.8s actual',
  accessibleLabel: '8.0s target / 7.8s actual; −0.2s; Within tolerance.',
  intervals: [],
  unionSegments: [{ startTime: 0, endTime: 7.8, clipIds: ['filled-1'] }],
};

describe('storyboard coverage UI accessibility', () => {
  it('keeps stale evidence visible and exposes an explicit repair action', () => {
    const onRepair = vi.fn();
    render(
      <StoryboardEvidenceChips
        evidence={[repairableEvidence]}
        onRepairEvidence={onRepair}
      />,
    );
    expect(screen.getByText('Stale, verified repair available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Repair evidence A useful quote' }));
    expect(onRepair).toHaveBeenCalledWith(repairableEvidence);
  });

  it('provides textual level, scores, reasons, and advisory meaning in addition to color', () => {
    render(<StoryboardCoverageSummary coverage={coverage} />);
    expect(screen.getByLabelText('Yellow coverage')).toHaveTextContent('Yellow coverage');
    expect(screen.getByRole('meter', { name: 'Existing source score: 62%' })).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Generation readiness score: 80%' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Coverage reasons' }))
      .toHaveTextContent('candidate awaits approval');
    expect(screen.getByText(/Coverage is advisory/)).toBeTruthy();
  });

  it('labels duration tone textually and explains the interval union on activation', () => {
    render(<StoryboardDurationBadge assessment={duration} />);
    const badge = screen.getByRole('button', { name: duration.accessibleLabel });
    expect(badge).toHaveAttribute('aria-expanded', 'false');
    expect(badge).toHaveTextContent('Within tolerance');
    fireEvent.click(badge);
    expect(badge).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: 'Actual duration union segments' }))
      .toHaveTextContent('0.00–7.80s');
  });
});
