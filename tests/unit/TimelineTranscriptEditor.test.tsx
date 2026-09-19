import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineTranscriptEditor } from '../../src/components/panels/properties/TimelineTranscriptEditor';
import type { CaptionTimelineWordEvent } from '../../src/services/captions/captionTimelineTranscript';
import type { TranscriptReviewOmission } from '../../src/services/captions/transcriptReviewEdits';

const word: CaptionTimelineWordEvent = {
  kind: 'word',
  key: 'word:clip-1:kept',
  sourceClipId: 'clip-1',
  sourceEnd: 0.4,
  sourceStart: 0,
  text: 'Kept',
  timelineEnd: 0.4,
  timelineStart: 0,
  wordId: 'kept',
};

const omission: TranscriptReviewOmission = {
  duration: 0.3,
  eventKey: 'word:clip-1:removed',
  id: 'omission-1',
  kind: 'word',
  restoreClipIds: ['clip-1'],
  restoreSegments: [],
  text: 'Removed',
  timelineEnd: 0.8,
  timelineStart: 0.5,
};

afterEach(cleanup);

describe('TimelineTranscriptEditor transcript views', () => {
  it('uses one global eye for manual removals and reserves a disabled eye for the source transcript', () => {
    const restore = vi.fn(() => ({ ok: true }));
    render(
      <TimelineTranscriptEditor
        events={[word]}
        omissions={[omission]}
        onCorrectWord={() => ({ ok: true })}
        onDeleteRange={() => ({ ok: true })}
        onRestoreOmission={restore}
        playheadPosition={10}
        setPlayheadPosition={() => undefined}
      />,
    );

    expect(screen.queryByText('Removed')).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Transcript view options' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show the complete source transcript (coming later)' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Delete Kept' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 1 removed word or pause' }));

    const restoreButton = screen.getByRole('button', { name: 'Restore Removed' });
    expect(restoreButton).toHaveTextContent('Removed');
    fireEvent.click(restoreButton);
    expect(restore).toHaveBeenCalledWith('omission-1');
  });
});
