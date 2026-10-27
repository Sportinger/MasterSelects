import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../../src/stores/settingsStore');

vi.mock('../../src/components/timeline/TimelineControls', () => ({
  TimelineControls: ({ variant }: { variant: string }) => (
    <button data-testid={`timeline-controls-${variant}`}>{variant}</button>
  ),
}));
vi.mock('../../src/components/timeline/hooks/useLegacyTransitionCompositionUpgrade', () => ({
  useLegacyTransitionCompositionUpgrade: () => null,
}));
import { DockTabStrip } from '../../src/components/dock/tabPane/DockTabStrip';
import { TimelineSidebar } from '../../src/components/timeline/components/TimelineSidebar';
import { useSettingsStore } from '../../src/stores/settingsStore';
beforeEach(() => {
  useSettingsStore.setState({ compactTimelineToolbar: true, compactTimelineSidebarOpen: false });
});
afterEach(cleanup);

function renderToolbar(onToggleTimelineCurveMode = vi.fn()) {
  // The handle belongs to the composition tab strip; render both real owners
  // so these tests cover their shared open state and Escape focus handoff.
  const tabProps = {
    group: { id: 'timeline-group', panels: [] },
    tabBarRef: { current: null },
    hasTimelinePanel: true,
    timelinePanel: { id: 'timeline', type: 'timeline' },
    openCompositions: [{ id: 'comp-1', name: 'Main Comp' }],
    activeCompositionId: 'comp-1',
    slotGridProgress: 0,
    compositionTabHandlers: {},
  } as ComponentProps<typeof DockTabStrip>;
  return render(<>
    <DockTabStrip {...tabProps} />
    <TimelineSidebar
      onToggleTimelineCurveMode={onToggleTimelineCurveMode}
      timelineControlsProps={{} as never} timelineCurveMode="timeline" />
  </>);
}

describe('timeline ruler sidebar', () => {
  it('restores and persists the classic toolbar preference', () => {
    useSettingsStore.getState().setCompactTimelineToolbar(true);
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Use classic toolbar' }));
    expect(useSettingsStore.getState().compactTimelineToolbar).toBe(false);
    expect(JSON.parse(localStorage.getItem('masterselects-settings')!).state.compactTimelineToolbar).toBe(false);
  });
  it('reveals view, zoom, graph and recording controls on demand', () => {
    const toggle = vi.fn();
    renderToolbar(toggle);
    const handle = screen.getByRole('button', { name: 'Timeline settings' });
    expect(handle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('timeline-controls-utility')).toBeNull();
    fireEvent.click(handle);
    const panel = screen.getByRole('dialog', { name: 'Timeline settings' });
    expect(handle).toHaveAttribute('aria-expanded', 'true');
    for (const variant of ['utility', 'zoom', 'recording']) {
      expect(within(panel).getByTestId(`timeline-controls-${variant}`)).toBeTruthy();
    }
    fireEvent.click(within(panel).getByRole('button', { name: 'Toggle Timeline and Graph view' }));
    expect(toggle).toHaveBeenCalledOnce();
  });

  it('closes with Escape and returns keyboard focus to its handle', () => {
    renderToolbar();
    const handle = screen.getByRole('button', { name: 'Timeline settings' });
    fireEvent.click(handle);
    screen.getByTestId('timeline-controls-utility').focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(handle).toHaveFocus();
  });

  it('keeps inside interactions open and dismisses on an outside pointer', () => {
    renderToolbar();
    fireEvent.click(screen.getByRole('button', { name: 'Timeline settings' }));
    fireEvent.pointerDown(screen.getByTestId('timeline-controls-zoom'));
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
