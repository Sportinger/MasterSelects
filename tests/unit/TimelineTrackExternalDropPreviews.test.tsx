import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TimelineTrackExternalDropPreviews } from '../../src/components/timeline/components/TimelineTrackExternalDropPreviews';
import type { ExternalDragState } from '../../src/components/timeline/types';

const getTrackRangeShellRect = () => ({
  x: 10,
  y: 0,
  width: 100,
  height: 40,
});

function preview(overrides: Partial<ExternalDragState>): ExternalDragState {
  return {
    trackId: 'video-1',
    startTime: 0,
    x: 0,
    y: 0,
    isVideo: true,
    isAudio: false,
    ...overrides,
  };
}

describe('TimelineTrackExternalDropPreviews', () => {
  it('renders a normal video-lane drop only as a blue video ghost', () => {
    const drag = preview({
      trackId: 'video-1',
      hasAudio: true,
      audioTrackId: 'audio-1',
    });
    const { container, rerender } = render(
      <TimelineTrackExternalDropPreviews
        externalDrag={drag}
        getTrackRangeShellRect={getTrackRangeShellRect}
        trackId="video-1"
      />,
    );

    expect(container.querySelector('.timeline-clip-preview.video')).not.toBeNull();
    expect(container.querySelector('.timeline-clip-preview.audio')).toBeNull();

    rerender(
      <TimelineTrackExternalDropPreviews
        externalDrag={drag}
        getTrackRangeShellRect={getTrackRangeShellRect}
        trackId="audio-1"
      />,
    );
    expect(container.querySelector('.timeline-clip-preview')).toBeNull();
  });

  it('renders audio-target placement as green audio plus blue linked video', () => {
    const drag = preview({
      trackId: 'audio-1',
      videoTrackId: 'video-1',
      hasAudio: true,
    });
    const { container, rerender } = render(
      <TimelineTrackExternalDropPreviews
        externalDrag={drag}
        getTrackRangeShellRect={getTrackRangeShellRect}
        trackId="audio-1"
      />,
    );

    expect(container.querySelector('.timeline-clip-preview.audio')).not.toBeNull();

    rerender(
      <TimelineTrackExternalDropPreviews
        externalDrag={drag}
        getTrackRangeShellRect={getTrackRangeShellRect}
        trackId="video-1"
      />,
    );
    expect(container.querySelector('.timeline-clip-preview.video')).not.toBeNull();
  });
});
