import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FacePersonSummary, FrameAnalysisData } from '../../src/types/clipMetadata';
import { FacePeopleSummary } from '../../src/components/panels/properties/FacePeopleSummary';

vi.mock('../../src/components/panels/properties/FaceCropThumbnail', () => ({
  FaceCropThumbnail: ({ alt, size }: { alt: string; size: number }) => (
    <span aria-label={alt} role="img" style={{ height: size, width: size }} />
  ),
}));

const person: FacePersonSummary = {
  id: 'person-1',
  label: 'Person 1',
  firstSeen: 2,
  lastSeen: 4,
  sampleCount: 2,
  averageConfidence: 0.91,
  maxConfidence: 0.95,
  appearances: [{ start: 2, end: 4 }],
};

const frames: FrameAnalysisData[] = [{
  timestamp: 2,
  motion: 0,
  globalMotion: 0,
  localMotion: 0,
  focus: 1,
  brightness: 0.5,
  faceCount: 1,
  faces: [{
    id: 'face-1',
    personId: person.id,
    label: person.label,
    confidence: 0.91,
    box: { x: 0.2, y: 0.2, width: 0.25, height: 0.25 },
    landmarks: [],
  }],
}];

function renderSummary() {
  render(
    <FacePeopleSummary
      people={[person]}
      frames={frames}
      onSelectSourceTime={vi.fn()}
      onMergePeople={vi.fn()}
      onMoveAppearance={vi.fn()}
      onAssignReviewFaces={vi.fn()}
    />,
  );
}

describe('FacePeopleSummary', () => {
  it('uses the compact person thumbnail to toggle appearances', () => {
    renderSummary();

    const thumbnail = screen.getByRole('button', { name: 'View Person 1 appearances' });
    expect(thumbnail).toHaveClass('FacePeopleSummary__personButton');
    expect(screen.queryByText('View appearances')).not.toBeInTheDocument();
    expect(screen.queryByText('Person 1 appearances')).not.toBeInTheDocument();

    fireEvent.click(thumbnail);

    expect(screen.getByText('Person 1 appearances')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide Person 1 appearances' })).toBe(thumbnail);

    fireEvent.click(thumbnail);

    expect(screen.queryByText('Person 1 appearances')).not.toBeInTheDocument();
  });
});
