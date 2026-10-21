import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create } from 'zustand';

const { updatePanelData } = vi.hoisted(() => ({ updatePanelData: vi.fn() }));

vi.mock('../../src/stores/dockStore', () => ({
  useDockStore: (selector: (state: { updatePanelData: typeof updatePanelData }) => unknown) => (
    selector({ updatePanelData })
  ),
}));

vi.mock('../../src/components/timeline/Timeline', () => ({
  Timeline: ({ onShowSlotGrid }: { onShowSlotGrid: () => void }) => (
    <button type="button" onClick={onShowSlotGrid}>Timeline view</button>
  ),
}));

vi.mock('../../src/components/panels/slot-grid/SlotGridPanel', () => ({
  SlotGridPanel: ({ onShowTimeline }: { onShowTimeline: () => void }) => (
    <button type="button" onClick={onShowTimeline}>Slot Grid view</button>
  ),
}));

import { TimelineSlotPanelHost } from '../../src/components/panels/slot-grid/TimelineSlotPanelHost';
import { useSlotGridPanelStore } from '../../src/stores/slotGridPanelStore';
import { MULTI_INSTANCE_PANEL_TYPES } from '../../src/types/dock';

beforeEach(() => {
  act(() => useSlotGridPanelStore.setState({ modes: {}, hostCounts: {} }));
  updatePanelData.mockReset();
});

afterEach(cleanup);

describe('TimelineSlotPanelHost', () => {
  it('registers Slot Grid as a multi-instance panel', () => {
    expect(MULTI_INSTANCE_PANEL_TYPES).toContain('slot-grid');
  });

  it('keeps multiple Slot Grids while moving the single Timeline view between hosts', () => {
    render(
      <>
        <TimelineSlotPanelHost panelId="timeline-main" initialMode="timeline" />
        <TimelineSlotPanelHost panelId="slot-a" initialMode="slot-grid" />
        <TimelineSlotPanelHost panelId="slot-b" initialMode="slot-grid" />
      </>,
    );

    expect(screen.getAllByRole('button', { name: 'Timeline view' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Slot Grid view' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Slot Grid view' })[0]);

    expect(screen.getAllByRole('button', { name: 'Timeline view' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Slot Grid view' })).toHaveLength(2);
    expect(useSlotGridPanelStore.getState().modes).toEqual({
      'timeline-main': 'slot-grid',
      'slot-a': 'timeline',
      'slot-b': 'slot-grid',
    });
  });

  it('switches one host between Timeline and Slot Grid without replacing its dock panel', () => {
    render(<TimelineSlotPanelHost panelId="timeline-main" initialMode="timeline" />);

    fireEvent.click(screen.getByRole('button', { name: 'Timeline view' }));
    expect(screen.getByRole('button', { name: 'Slot Grid view' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Slot Grid view' }));
    expect(screen.getByRole('button', { name: 'Timeline view' })).toBeInTheDocument();
    expect(updatePanelData).toHaveBeenCalledWith('timeline-main', {
      timelineSurfaceMode: 'timeline',
    });
  });

  it('does not loop when panel data written by the host feeds back into duplicated panel ids', () => {
    type Mode = 'timeline' | 'slot-grid';
    type Entry = { id: string; fallback: Mode; surface?: Mode };
    const panels = create<{ entries: Entry[] }>(() => ({ entries: [
      { id: 'a', fallback: 'timeline' },
      { id: 'b', fallback: 'timeline', surface: 'timeline' },
      { id: 'c', fallback: 'timeline' },
      { id: 'a', fallback: 'slot-grid' },
    ] }));
    updatePanelData.mockImplementation((id: string, data: { timelineSurfaceMode: Mode }) => {
      panels.setState(state => ({
        entries: state.entries.map(entry => (
          entry.id === id ? { ...entry, surface: data.timelineSurfaceMode } : entry
        )),
      }));
    });
    function Dock() {
      const entries = panels(state => state.entries);
      return entries.map((entry, index) => (
        <TimelineSlotPanelHost
          key={`${entry.id}:${index}`}
          panelId={entry.id}
          initialMode={entry.surface ?? entry.fallback}
        />
      ));
    }

    expect(() => render(<Dock />)).not.toThrow();
    expect(screen.getAllByRole('button', { name: 'Timeline view' })).toHaveLength(2);
    expect(useSlotGridPanelStore.getState().hostCounts).toEqual({ a: 2, b: 1, c: 1 });

    act(() => panels.setState(state => ({ entries: state.entries.slice(0, 3) })));
    expect(useSlotGridPanelStore.getState().modes).toEqual({
      a: 'timeline',
      b: 'slot-grid',
      c: 'slot-grid',
    });
    expect(screen.getAllByRole('button', { name: 'Timeline view' })).toHaveLength(1);
  });
});
