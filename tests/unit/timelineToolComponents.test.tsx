import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TimelineToolButton } from '../../src/components/timeline/tools/TimelineToolButton';
import { TimelineToolFlyout } from '../../src/components/timeline/tools/TimelineToolFlyout';
import { TIMELINE_TOOL_DEFINITION_BY_ID } from '../../src/components/timeline/tools/registry';
import type { TimelineToolIcon } from '../../src/components/timeline/tools/toolIcons';

const TestIcon: TimelineToolIcon = ({ size = 16, ...props }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" {...props}>
    <path d="M2 2h12v12H2z" />
  </svg>
);

function createRect(overrides: Partial<DOMRect> = {}): DOMRect {
  return {
    x: 20,
    y: 30,
    width: 28,
    height: 28,
    top: 30,
    right: 48,
    bottom: 58,
    left: 20,
    toJSON: () => ({}),
    ...overrides,
  } as DOMRect;
}

describe('timeline tool components', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('activates the root tool button on a normal click', () => {
    const onActivate = vi.fn();
    const onOpen = vi.fn();

    render(
      <TimelineToolButton
        groupId="selection"
        label="Selection"
        title="Selection tools"
        active={false}
        open={false}
        icon={TestIcon}
        onActivate={onActivate}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: 'Selection' });
    fireEvent.pointerDown(button, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(button, { button: 0, clientX: 10, clientY: 10 });

    expect(onActivate).toHaveBeenCalledWith('selection');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the flyout on long press or right-click, and activates on release back on the button', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const onOpen = vi.fn();

    render(
      <TimelineToolButton
        groupId="cut"
        label="Cut"
        title="Cut tools"
        active={false}
        open={false}
        icon={TestIcon}
        onActivate={onActivate}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: 'Cut' });

    // Holding past the threshold opens the flyout armed for press-drag.
    fireEvent.pointerDown(button, { button: 0, clientX: 12, clientY: 40 });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenLastCalledWith('cut', button, { armPressDrag: true });

    // Releasing back on the root button activates the current tool, so a
    // hold-and-release without choosing never swallows the click. (Releases over
    // a flyout item / empty space happen off the button and are resolved there.)
    fireEvent.pointerUp(button, { button: 0, clientX: 12, clientY: 40 });
    expect(onActivate).toHaveBeenCalledWith('cut');

    // Right-click opens a sticky (non-armed) flyout without activating.
    onActivate.mockClear();
    fireEvent.contextMenu(button);
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith('cut', button, { armPressDrag: false });
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('shows active flyout state, shortcut labels, and blocks disabled commands', () => {
    const onSelect = vi.fn();

    render(
      <TimelineToolFlyout
        anchorRect={createRect()}
        activeToolId="select"
        tools={[
          TIMELINE_TOOL_DEFINITION_BY_ID.select,
          TIMELINE_TOOL_DEFINITION_BY_ID.insert,
        ]}
        isExporting={false}
        onSelect={onSelect}
        onClose={vi.fn()}
      />,
    );

    const selectItem = screen.getByRole('menuitem', { name: /Select \/ Move/i });
    const insertItem = screen.getByRole('menuitem', { name: /Insert/i });

    expect(selectItem).toHaveClass('active');
    expect(screen.getByText('V')).toBeInTheDocument();
    expect(insertItem).toBeDisabled();

    fireEvent.click(insertItem);
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(selectItem);
    expect(onSelect).toHaveBeenCalledWith(TIMELINE_TOOL_DEFINITION_BY_ID.select);
  });

  it('closes the flyout with Escape and blocks mutating commands while exporting', () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();

    render(
      <TimelineToolFlyout
        anchorRect={createRect({ top: 500, bottom: 528 })}
        activeToolId="blade"
        tools={[
          TIMELINE_TOOL_DEFINITION_BY_ID.blade,
          TIMELINE_TOOL_DEFINITION_BY_ID['split-at-playhead'],
        ]}
        isExporting
        onSelect={onSelect}
        onClose={onClose}
      />,
    );

    const menu = screen.getByRole('menu');
    const splitCommand = screen.getByRole('menuitem', { name: /Split at Playhead/i });

    expect(splitCommand).toBeDisabled();
    expect(splitCommand).toHaveAttribute('title', 'Timeline edits are locked during export.');

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
