import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/components/timeline/TimelineControls', () => ({
  TimelineControls: ({ variant }: { variant: string }) => (
    <div data-testid={`timeline-controls-${variant}`}>{variant}</div>
  ),
}));

vi.mock('../../src/components/timeline/hooks/useLegacyTransitionCompositionUpgrade', () => ({
  useLegacyTransitionCompositionUpgrade: () => null,
}));

import { TimelineToolbarChrome } from '../../src/components/timeline/components/TimelineToolbarChrome';

function renderToolbar(onToggleTimelineCurveMode = vi.fn()) {
  render(
    <TimelineToolbarChrome
      duration={90}
      formatTime={(seconds) => String(seconds)}
      hasInOutDisplayRange={false}
      inOutDisplayDuration={0}
      isEditingTimelineDuration={false}
      onTimelineDurationClick={() => undefined}
      onTimelineDurationInputChange={() => undefined}
      onTimelineDurationKeyDown={() => undefined}
      onTimelineDurationSubmit={() => undefined}
      onTimelineTimeDoubleClick={() => undefined}
      onToggleTimelineCurveMode={onToggleTimelineCurveMode}
      slotGridProgress={0}
      timelineControlsProps={{} as never}
      timelineCurrentFrame={0}
      timelineCurveMode="timeline"
      timelineDurationInputRef={{ current: null }}
      timelineDurationInputValue="90"
      timelineFpsValue="30"
      timelineRulerCurrentTime={0}
      timelineTimeDisplayMode="time"
      timelineTotalFrames={2700}
    />,
  );
}

describe('timeline toolbar overflow', () => {
  it('places the controls after transport inside the More popover', () => {
    const onToggleTimelineCurveMode = vi.fn();
    renderToolbar(onToggleTimelineCurveMode);

    expect(screen.queryByRole('dialog', { name: 'More timeline controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More timeline controls' }));

    const dialog = screen.getByRole('dialog', { name: 'More timeline controls' });
    expect(within(dialog).getByTestId('timeline-controls-utility')).toBeTruthy();
    expect(within(dialog).getByTestId('timeline-controls-zoom')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Toggle Timeline and Graph view' }));
    expect(onToggleTimelineCurveMode).toHaveBeenCalledOnce();
  });

  it('switches at the timeline container width and for coarse portrait input', () => {
    const css = readFileSync(resolve('src/components/timeline/Timeline.css'), 'utf8');

    expect(css).toContain('container-name: timeline-toolbar');
    expect(css).toContain('@container timeline-toolbar (max-width: 980px)');
    expect(css).toContain('@media (orientation: portrait) and (pointer: coarse)');
    expect(css).toContain('.timeline-timebar > .timeline-toolbar-overflow');
  });
});
