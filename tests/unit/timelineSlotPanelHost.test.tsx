import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  act(() => useSlotGridPanelStore.setState({ modes: {} }));
  updatePanelData.mockClear();
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
});
