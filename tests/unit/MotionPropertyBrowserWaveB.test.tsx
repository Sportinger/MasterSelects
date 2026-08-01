import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MotionShapeTab } from '../../src/components/panels/properties/MotionShapeTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { readStoredMotionPropertyFavoritePaths } from '../../src/stores/timeline/viewPreferences';

const initialState = useTimelineStore.getState();

describe('Motion property browser Wave B UI', () => {
  let clipId: string;

  beforeEach(() => {
    localStorage.clear();
    useTimelineStore.setState({
      ...initialState,
      clips: [],
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
      clipKeyframes: new Map(),
    });
    clipId = useTimelineStore.getState().addMotionShapeClip(
      'video-1',
      0,
      { primitive: 'rectangle', duration: 5 },
    )!;
  });

  afterEach(() => {
    localStorage.clear();
    act(() => {
      useTimelineStore.setState(initialState);
    });
  });

  it('starts collapsed and expands via the section header', () => {
    render(<MotionShapeTab clipId={clipId} />);

    expect(screen.queryByRole('searchbox', { name: 'Search motion properties' }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Property Browser' }));
    expect(screen.getByRole('searchbox', { name: 'Search motion properties' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Property Browser' }));
    expect(screen.queryByRole('searchbox', { name: 'Search motion properties' }))
      .not.toBeInTheDocument();
  });

  it('searches only clip-valid registry descriptors without dirtying project state', () => {
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Property Browser' }));
    const beforeClip = useTimelineStore.getState().clips.find(clip => clip.id === clipId);
    const revisionBeforeSearch = useTimelineStore.getState().timelineRevision;

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search motion properties' }), {
      target: { value: 'position x' },
    });

    expect(screen.getByTitle('position.x')).toBeInTheDocument();
    expect(screen.queryByTitle('shape.size.w')).not.toBeInTheDocument();
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)).toBe(beforeClip);
    expect(useTimelineStore.getState().timelineRevision).toBe(revisionBeforeSearch);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search motion properties' }), {
      target: { value: 'gaussianBlur' },
    });
    expect(screen.getByText('No properties match this search.')).toBeInTheDocument();
  });

  it('pins exact dynamic paths on the clip and favorites them only in user preferences', () => {
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Property Browser' }));
    const clip = useTimelineStore.getState().clips.find(candidate => candidate.id === clipId)!;
    const fillId = clip.motion?.appearance?.items[0]?.id;
    const path = `appearance.${fillId}.opacity`;

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search motion properties' }), {
      target: { value: path },
    });
    expect(screen.getByTitle(path)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: `Pin ${path}` }));
    expect(useTimelineStore.getState().clips.find(
      candidate => candidate.id === clipId,
    )?.motion?.ui?.pinnedProperties).toEqual([path]);

    const motionAfterPin = structuredClone(useTimelineStore.getState().clips.find(
      candidate => candidate.id === clipId,
    )?.motion);
    const revisionAfterPin = useTimelineStore.getState().timelineRevision;
    fireEvent.click(screen.getByRole('button', { name: `Favorite ${path}` }));

    expect(readStoredMotionPropertyFavoritePaths([])).toEqual([path]);
    expect(useTimelineStore.getState().clips.find(
      candidate => candidate.id === clipId,
    )?.motion).toEqual(motionAfterPin);
    expect(useTimelineStore.getState().timelineRevision).toBe(revisionAfterPin);

    fireEvent.click(screen.getByRole('button', { name: `Unpin ${path}` }));
    expect(useTimelineStore.getState().clips.find(
      candidate => candidate.id === clipId,
    )?.motion?.ui?.pinnedProperties).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: `Unfavorite ${path}` }));
    expect(readStoredMotionPropertyFavoritePaths([])).toEqual([]);
  });
});
