import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MotionShapeTab } from '../../src/components/panels/properties/MotionShapeTab';
import { handleSaveMotionTemplate } from '../../src/services/aiTools/handlers/motionDesign';
import { listMotionTemplates } from '../../src/services/motionDesign/motionTemplateLibrary';
import {
  initHistoryStoreRefs,
  setHistoryCallbacks,
  setHistoryDisabledForDebug,
} from '../../src/stores/historyStore';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const track = {
  id: 'video-1', name: 'Video 1', type: 'video' as const, height: 70,
  muted: false, visible: true, solo: false,
};

function initializeHistory(): void {
  setHistoryCallbacks({
    flushPendingCapture: () => undefined,
    suppressCaptures: () => undefined,
  });
  initHistoryStoreRefs({
    timeline: { getState: useTimelineStore.getState, setState: useTimelineStore.setState },
    media: { getState: useMediaStore.getState, setState: useMediaStore.setState },
    dock: { getState: () => ({ layout: null }), setState: () => undefined },
  });
}

describe('MD8 motion templates and expressions UI', () => {
  let clipId: string;

  beforeEach(() => {
    localStorage.clear();
    const mediaFixture = {
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    };
    vi.mocked(useMediaStore).mockImplementation((selector: never) => selector(mediaFixture as never));
    vi.mocked(useMediaStore.getState).mockReturnValue(mediaFixture as never);
    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [],
      tracks: [track],
      playheadPosition: 8,
      clipKeyframes: new Map(),
    });
    clipId = useTimelineStore.getState().addMotionShapeClip(
      track.id,
      0,
      { primitive: 'rectangle', duration: 5 },
    )!;
    setHistoryDisabledForDebug(false);
    initializeHistory();
  });

  afterEach(() => {
    localStorage.clear();
    act(() => useTimelineStore.setState(initialTimelineState));
    useMediaStore.setState(initialMediaState);
  });

  it('starts both sections collapsed and expands them from their header buttons', () => {
    render(<MotionShapeTab clipId={clipId} />);

    expect(screen.getByRole('button', { name: 'Templates' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expressions' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Motion template name')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Expression path')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Expressions' }));

    expect(screen.getByLabelText('Motion template name')).toBeInTheDocument();
    expect(screen.getByLabelText('Expression path')).toBeInTheDocument();
  });

  it('saves and applies a template at the current playhead time', async () => {
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));
    fireEvent.change(screen.getByLabelText('Motion template name'), { target: { value: 'UI template' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save motion template' })); });

    await waitFor(() => expect(listMotionTemplates().templates.map(template => template.name)).toContain('UI template'));
    const template = listMotionTemplates().templates[0]!;
    fireEvent.change(screen.getByLabelText('Motion template'), { target: { value: template.templateId } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Apply motion template' })); });

    await waitFor(() => expect(useTimelineStore.getState().clips).toHaveLength(2));
    expect(useTimelineStore.getState().clips.find(clip => clip.id !== clipId)?.startTime).toBe(8);
  });

  it('adds, validates, and removes an expression binding', async () => {
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Expressions' }));
    const path = 'replicator.offset.position.x';
    fireEvent.change(screen.getByLabelText('Expression path'), { target: { value: path } });
    fireEvent.change(screen.getByLabelText('New expression source'), { target: { value: '1 + 2' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Set new expression' })); });

    await waitFor(() => expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)
      ?.motion?.expressions?.bindings[0]?.source).toBe('1 + 2'));

    fireEvent.change(screen.getByLabelText(`Expression source for ${path}`), { target: { value: '1 +' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Set expression for ${path}` })); });

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid Motion expression at position');
    expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)
      ?.motion?.expressions?.bindings[0]?.source).toBe('1 + 2');

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: `Remove expression for ${path}` })); });
    await waitFor(() => expect(useTimelineStore.getState().clips.find(clip => clip.id === clipId)
      ?.motion?.expressions).toBeUndefined());
  });

  it('filters templates by category', async () => {
    await handleSaveMotionTemplate({ clipId, name: 'Lower third', category: 'lower-thirds' }, useTimelineStore.getState());
    await handleSaveMotionTemplate({ clipId, name: 'Title', category: 'titles' }, useTimelineStore.getState());
    render(<MotionShapeTab clipId={clipId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }));

    fireEvent.change(screen.getByLabelText('Motion template category filter'), { target: { value: 'lower-thirds' } });

    const options = Array.from((screen.getByLabelText('Motion template') as HTMLSelectElement).options)
      .map(option => option.text);
    expect(options).toContain('Lower third');
    expect(options).not.toContain('Title');
  });
});
