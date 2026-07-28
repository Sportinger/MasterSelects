import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { usePointerFocusHandoff } from '../../src/hooks/usePointerFocusHandoff';
import {
  claimShortcut,
  isTextEntryTarget,
} from '../../src/services/shortcutFocusPolicy';

function PointerFocusHarness() {
  usePointerFocusHandoff();

  return (
    <div>
      <button type="button">Focused control</button>
      <div data-testid="editor-surface" onPointerDown={(event) => event.preventDefault()}>
        Editor surface
      </div>
    </div>
  );
}

describe('shortcut focus policy', () => {
  it('defers Space to a deliberately focused button', () => {
    const onClick = vi.fn();
    const button = document.createElement('button');
    button.addEventListener('click', onClick);
    document.body.append(button);
    button.focus();

    let claimed = false;
    button.addEventListener('keydown', (event) => {
      claimed = claimShortcut(event, 'playback.playPause');
    });
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'Space',
      key: ' ',
    });

    const mayRunNativeDefault = button.dispatchEvent(event);
    if (mayRunNativeDefault) button.click();

    expect(claimed).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    button.remove();
  });

  it('leaves text entry and slider navigation with the focused control', () => {
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    const textEvent = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z' });

    expect(isTextEntryTarget(input)).toBe(true);
    expect(claimShortcut(textEvent, 'history.undo')).toBe(false);
    expect(textEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);

    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(slider);
    slider.focus();
    const arrowEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });

    expect(claimShortcut(arrowEvent, 'nav.frameForward')).toBe(false);
    expect(arrowEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(slider);

    input.remove();
    slider.remove();
  });

  it('leaves directional and activation keys with custom ARIA sliders', () => {
    const slider = document.createElement('div');
    slider.setAttribute('role', 'slider');
    slider.tabIndex = 0;
    document.body.append(slider);
    slider.focus();

    const arrowEvent = new KeyboardEvent('keydown', { cancelable: true, key: 'ArrowLeft' });
    expect(claimShortcut(arrowEvent, 'nav.frameBackward')).toBe(false);
    expect(document.activeElement).toBe(slider);

    const playbackEvent = new KeyboardEvent('keydown', {
      cancelable: true,
      code: 'Space',
      key: ' ',
    });
    expect(claimShortcut(playbackEvent, 'playback.playPause')).toBe(false);
    expect(playbackEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(slider);
    slider.remove();
  });

  it('uses the actual key for remapped shortcuts and preserves non-conflicting focus', () => {
    const slider = document.createElement('input');
    slider.type = 'range';
    document.body.append(slider);
    slider.focus();

    const remappedFrameEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'f',
    });
    expect(claimShortcut(remappedFrameEvent, 'nav.frameForward')).toBe(true);
    expect(remappedFrameEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(slider);

    const remappedHistoryEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'ArrowRight',
    });
    expect(claimShortcut(remappedHistoryEvent, 'history.undo')).toBe(false);
    expect(remappedHistoryEvent.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(slider);
    slider.remove();
  });

  it('respects a target handler that already consumed the event', () => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'v',
    });
    event.preventDefault();

    expect(claimShortcut(event, 'tool.select')).toBe(false);
  });

  it('allows only one global handler to claim a keyboard event', () => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Delete',
    });

    expect(claimShortcut(event, 'edit.delete')).toBe(true);
    expect(claimShortcut(event, 'edit.delete')).toBe(false);
  });

  it('uses the event target document for detached text-entry controls', () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    const detachedWindow = frame.contentWindow;
    const detachedDocument = frame.contentDocument;
    expect(detachedWindow).not.toBeNull();
    expect(detachedDocument).not.toBeNull();

    const input = detachedDocument!.createElement('input');
    detachedDocument!.body.append(input);
    input.focus();
    let claimed = false;
    input.addEventListener('keydown', (event) => {
      claimed = claimShortcut(event, 'history.undo');
    });
    const event = new detachedWindow!.KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: 'z',
    });

    input.dispatchEvent(event);

    expect(claimed).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(detachedDocument!.activeElement).toBe(input);
    frame.remove();
  });

  it('releases an old control when primary pointer input moves elsewhere', () => {
    const { getByRole, getByTestId } = render(<PointerFocusHarness />);
    const button = getByRole('button', { name: 'Focused control' });
    button.focus();

    fireEvent.pointerDown(getByTestId('editor-surface'), {
      button: 0,
      isPrimary: true,
      pointerId: 1,
    });

    expect(document.activeElement).not.toBe(button);
  });

  it('keeps focus for pointer input inside the active control', () => {
    const { getByRole } = render(<PointerFocusHarness />);
    const button = getByRole('button', { name: 'Focused control' });
    button.focus();

    fireEvent.pointerDown(button, {
      button: 0,
      isPrimary: true,
      pointerId: 1,
    });

    expect(document.activeElement).toBe(button);
  });
});
