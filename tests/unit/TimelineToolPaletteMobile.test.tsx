import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimelineSnappingButton } from '../../src/components/timeline/components/TimelineSnappingButton';
import { TimelineToolPalette } from '../../src/components/timeline/tools/TimelineToolPalette';
import { TIMELINE_TOOL_GROUPS } from '../../src/components/timeline/tools/registry';
import {
  FACTORY_MOBILE_LAYOUT_ID,
  FACTORY_VIDEO_EDIT_LAYOUT_ID,
  useDockStore,
} from '../../src/stores/dockStore';
import { useTimelineStore } from '../../src/stores/timeline';

describe('mobile timeline tool palette', () => {
  beforeEach(() => {
    useDockStore.setState({ activeSavedLayoutId: FACTORY_MOBILE_LAYOUT_ID });
    useTimelineStore.getState().setActiveTimelineTool('select');
    useTimelineStore.getState().setOpenTimelineToolGroup(null);
  });

  afterEach(() => {
    cleanup();
    useDockStore.setState({ activeSavedLayoutId: FACTORY_VIDEO_EDIT_LAYOUT_ID });
    useTimelineStore.getState().setOpenTimelineToolGroup(null);
  });

  it('shows one tool menu beside the separate snapping button', () => {
    const onToggleSnapping = vi.fn();
    render(
      <div aria-label="Mobile edit tools" role="toolbar">
        <TimelineToolPalette />
        <TimelineSnappingButton snappingEnabled onToggleSnapping={onToggleSnapping} />
      </div>,
    );

    expect(within(screen.getByRole('toolbar', { name: 'Mobile edit tools' })).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'All timeline tools' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snapping' })).toBeInTheDocument();
  });

  it('opens every timeline tool in a glass bubble', () => {
    render(<TimelineToolPalette />);

    fireEvent.click(screen.getByRole('button', { name: 'All timeline tools' }));

    const menu = screen.getByRole('menu');
    const expectedToolCount = new Set(TIMELINE_TOOL_GROUPS.flatMap(group => group.tools)).size;
    expect(menu).toHaveClass('timeline-tool-flyout-glass-bubble');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(expectedToolCount);

    fireEvent.click(within(menu).getByRole('menuitem', { name: /^Hand\b/ }));
    expect(useTimelineStore.getState().activeTimelineToolId).toBe('hand');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
