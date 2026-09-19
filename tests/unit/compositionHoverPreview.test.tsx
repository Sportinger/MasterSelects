import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CompositionHoverPreview,
  getCompositionHoverPreviewSources,
} from '../../src/components/panels/media/CompositionHoverPreview';
import { thumbnailRenderer } from '../../src/services/thumbnailRenderer';
import type { Composition, MediaFile } from '../../src/stores/mediaStore';
import type { TimelineClip } from '../../src/types/timeline';

const composition: Composition = {
  id: 'comp-hover',
  name: 'Portrait Comp',
  type: 'composition',
  parentId: null,
  createdAt: 1,
  width: 1080,
  height: 1920,
  frameRate: 30,
  duration: 10,
  backgroundColor: '#000000',
};

const mediaFile: MediaFile = {
  id: 'media-video',
  name: 'source.mp4',
  type: 'video',
  parentId: null,
  createdAt: 1,
  url: 'blob:source-video',
  duration: 20,
};

const timelineClip = {
  id: 'clip-video',
  trackId: 'video-track',
  name: 'Source clip',
  mediaFileId: mediaFile.id,
  startTime: 2,
  duration: 5,
  inPoint: 3,
  outPoint: 8,
  source: { type: 'video', mediaFileId: mediaFile.id },
} as TimelineClip;

describe('CompositionHoverPreview', () => {
  beforeEach(() => {
    vi.mocked(thumbnailRenderer.generateCompositionThumbnails).mockReset().mockResolvedValue([]);
  });

  it('renders cached composition frames for an inactive portrait comp', async () => {
    vi.mocked(thumbnailRenderer.generateCompositionThumbnails).mockResolvedValue([
      'data:image/jpeg;base64,Zmlyc3Q=',
      'data:image/jpeg;base64,c2Vjb25k',
    ]);
    const { container, unmount } = render(
      <CompositionHoverPreview
        activeCompositionId="another-comp"
        composition={composition}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('img')).toHaveAttribute('src', 'data:image/jpeg;base64,Zmlyc3Q=');
    });
    expect(thumbnailRenderer.generateCompositionThumbnails).toHaveBeenCalledWith(
      composition.id,
      composition.duration,
      { count: 6, width: 90, height: 160 },
    );
    unmount();
  });

  it('uses a separate media element for the active comp without rendering shared timeline sources', () => {
    const sources = getCompositionHoverPreviewSources(
      composition,
      composition.id,
      [timelineClip],
      [mediaFile],
    );
    expect(sources).toEqual([{
      clipId: timelineClip.id,
      inPoint: 3,
      kind: 'video',
      url: 'blob:source-video',
    }]);

    const { container } = render(
      <CompositionHoverPreview
        activeCompositionId={composition.id}
        activeTimelineClips={[timelineClip]}
        composition={composition}
        mediaFiles={[mediaFile]}
      />,
    );
    expect(container.querySelector('video')).toHaveAttribute('src', 'blob:source-video');
    expect(thumbnailRenderer.generateCompositionThumbnails).not.toHaveBeenCalled();
  });
});
