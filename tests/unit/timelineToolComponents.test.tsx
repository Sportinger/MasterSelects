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
        icon={TestIcon}
        onActivate={onActivate}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: 'Selection' });
    Object.defineProperty(button, 'getBoundingClientRect', {
      configurable: true,
      value: () => createRect({ left: 0, right: 32, width: 32 }),
    });
    fireEvent.pointerDown(button, { button: 0, clientX: 10 });
    fireEvent.pointerUp(button, { button: 0, clientX: 10 });

    expect(onActivate).toHaveBeenCalledWith('selection');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens the tool flyout from long press, chevron, or right-click without activating the root', () => {
    vi.useFakeTimers();
    const onActivate = vi.fn();
    const onOpen = vi.fn();

    render(
      <TimelineToolButton
        groupId="cut"
        label="Cut"
        title="Cut tools"
        active={false}
        icon={TestIcon}
        onActivate={onActivate}
        onOpen={onOpen}
      />,
    );

    const button = screen.getByRole('button', { name: 'Cut' });
    Object.defineProperty(button, 'getBoundingClientRect', {
      configurable: true,
      value: () => createRect({ left: 0, right: 32, width: 32 }),
    });

    fireEvent.pointerDown(button, { button: 0, clientX: 12 });
    act(() => {
      vi.advanceTimersByTime(350);
    });
    fireEvent.pointerUp(button, { button: 0, clientX: 12 });

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();

    fireEvent.pointerDown(button, { button: 0, clientX: 30 });
    expect(onOpen).toHaveBeenCalledTimes(2);

    fireEvent.contextMenu(button);
    expect(onOpen).toHaveBeenCalledTimes(3);
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
