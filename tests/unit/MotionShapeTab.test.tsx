import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MotionShapeTab } from '../../src/components/panels/properties/MotionShapeTab';
import { useTimelineStore } from '../../src/stores/timeline';

const initialState = useTimelineStore.getState();

describe('MotionShapeTab MD1 authoring', () => {
  let clipId: string;

  beforeEach(() => {
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
    act(() => {
      useTimelineStore.setState(initialState);
    });
  });

  it('switches to star and builds a gradient stack with stable ids', () => {
    render(<MotionShapeTab clipId={clipId} />);

    act(() => {
      fireEvent.change(screen.getByLabelText('Motion shape primitive'), {
        target: { value: 'star' },
      });
    });
    expect(useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.shape?.primitive).toBe('star');
    expect(screen.getByText('Outer')).toBeInTheDocument();
    expect(screen.getByText('Inner')).toBeInTheDocument();

    act(() => {
      fireEvent.change(screen.getByLabelText('Add appearance'), {
        target: { value: 'linear-gradient' },
      });
    });
    const afterAdd = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.appearance;
    const gradient = afterAdd?.items.find(
      (item) => item.kind === 'linear-gradient',
    );
    expect(gradient).toBeTruthy();
    expect(afterAdd?.selectedItemId).toBe(gradient?.id);
    expect(gradient?.kind === 'linear-gradient' ? gradient.stops : []).toHaveLength(2);

    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Add Stop' }));
    });
    const afterStop = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.appearance?.items.find((item) => item.id === gradient?.id);
    expect(
      afterStop?.kind === 'linear-gradient' ? afterStop.stops : [],
    ).toHaveLength(3);

    const gradientId = gradient!.id;
    act(() => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Duplicate' })[1]);
    });
    const afterDuplicate = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.appearance;
    const gradients = afterDuplicate?.items.filter(
      (item) => item.kind === 'linear-gradient',
    ) ?? [];
    expect(gradients).toHaveLength(2);
    expect(gradients[0].id).toBe(gradientId);
    expect(gradients[1].id).not.toBe(gradientId);
    if (
      gradients[0].kind === 'linear-gradient'
      && gradients[1].kind === 'linear-gradient'
    ) {
      expect(gradients[1].stops.map((stop) => stop.id))
        .not.toEqual(gradients[0].stops.map((stop) => stop.id));
    }
  });

  it('authors Grid, Linear, and Radial Replicator modes through semantic revisions', () => {
    render(<MotionShapeTab clipId={clipId} />);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Enable Replicator' }));
    let replicator = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.replicator;
    expect(replicator).toMatchObject({ enabled: true, revision: 1 });
    expect(screen.getByText('Columns')).toBeInTheDocument();
    expect(screen.getByText('Rows')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Replicator layout' }), {
      target: { value: 'linear' },
    });
    replicator = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.replicator;
    expect(replicator).toMatchObject({
      revision: 2,
      layout: { mode: 'linear', count: 3, step: { x: 120, y: 0 } },
    });
    expect(screen.getByText('Step X')).toBeInTheDocument();
    expect(screen.getByText('Step Y')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Replicator layout' }), {
      target: { value: 'radial' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Radial angle sampling' }), {
      target: { value: 'inclusive-end' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Radial auto orient' }));

    replicator = useTimelineStore.getState().clips.find(
      (clip) => clip.id === clipId,
    )?.motion?.replicator;
    expect(replicator).toMatchObject({
      revision: 5,
      layout: {
        mode: 'radial',
        count: 8,
        angleSampling: 'inclusive-end',
        autoOrient: true,
      },
    });
    expect(screen.getByText('Center X')).toBeInTheDocument();
    expect(screen.getAllByText('Radius').length).toBeGreaterThan(0);
  });
});
