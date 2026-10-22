import { Profiler } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InspectorSelect } from '../../src/components/inspector/InspectorSelect';
import { handoffPointerFocus } from '../../src/services/shortcutFocusPolicy';

const OPTIONS = [
  { label: 'Normal', value: 'normal' },
  { label: 'Multiply', value: 'multiply' },
  { label: 'Screen', value: 'screen' },
] as const;

afterEach(() => {
  document.removeEventListener('pointerdown', handoffPointerFocus, true);
});

describe('InspectorSelect pointer interaction', () => {
  it('opens and selects with Space without triggering parent playback shortcuts', () => {
    const onChange = vi.fn();
    const playbackShortcut = vi.fn();
    render(<div onKeyDown={playbackShortcut}><InspectorSelect ariaLabel="Lens profile"
      onChange={onChange} options={[...OPTIONS]} value="normal" /></div>);
    const trigger = screen.getByRole('combobox', { name: 'Lens profile' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: ' ' });
    expect(onChange).toHaveBeenCalledWith('multiply');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(playbackShortcut).not.toHaveBeenCalled();
  });
  it('keeps the menu open through pointer focus handoff and selects by mouse click', () => {
    const onChange = vi.fn();
    document.addEventListener('pointerdown', handoffPointerFocus, true);
    render(
      <InspectorSelect
        ariaLabel="Composite Mode"
        onChange={onChange}
        options={[...OPTIONS]}
        value="normal"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Composite Mode' });
    fireEvent.click(trigger);
    const multiply = screen.getByRole('option', { name: 'Multiply' });

    fireEvent.pointerDown(multiply, { button: 0, isPrimary: true, pointerType: 'mouse' });
    fireEvent.mouseDown(multiply, { button: 0 });
    fireEvent.mouseUp(multiply, { button: 0 });
    fireEvent.click(multiply, { button: 0, detail: 1 });

    expect(onChange).toHaveBeenCalledWith('multiply');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('closes a menu opened by pointer with Escape, although its trigger lost focus, without reaching timeline shortcuts', () => {
    const timelineShortcut = vi.fn();
    window.addEventListener('keydown', timelineShortcut);
    try {
      render(<InspectorSelect ariaLabel="Font" onChange={vi.fn()} options={[...OPTIONS]} value="normal" />);
      const trigger = screen.getByRole('combobox', { name: 'Font' });
      fireEvent.click(trigger);
      trigger.blur();
      expect(screen.getByRole('listbox')).toBeInTheDocument();
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(timelineShortcut).not.toHaveBeenCalled();
      // Closed, Escape is the timeline's again.
      fireEvent.keyDown(document.body, { key: 'Escape' });
      expect(timelineShortcut).toHaveBeenCalledTimes(1);
    } finally { window.removeEventListener('keydown', timelineShortcut); }
  });

  it('opens upward when the menu would run past the bottom of its scrolling panel', () => {
    const rect = (top: number, height: number) => ({ top, bottom: top + height, height, left: 0, right: 200, width: 200, x: 0, y: top, toJSON: () => ({}) });
    const panelRect = vi.fn(() => rect(100, 200));
    const selectRect = vi.fn(() => rect(270, 24));
    render(<div data-testid="panel" style={{ overflowY: 'auto' }}><InspectorSelect ariaLabel="Audio curve"
      onChange={vi.fn()} options={[...OPTIONS]} value="normal" /></div>);
    screen.getByTestId('panel').getBoundingClientRect = panelRect as unknown as () => DOMRect;
    const trigger = screen.getByRole('combobox', { name: 'Audio curve' });
    (trigger.parentElement as HTMLElement).getBoundingClientRect = selectRect as unknown as () => DOMRect;
    const offsetHeight = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(80);
    try {
      fireEvent.click(trigger);
      // 6 px left below the select inside the panel, 170 px above it.
      expect(screen.getByRole('listbox')).toHaveAttribute('data-placement', 'above');
      fireEvent.click(trigger);
      selectRect.mockImplementation(() => rect(110, 24));
      fireEvent.click(trigger);
      expect(screen.getByRole('listbox')).toHaveAttribute('data-placement', 'below');
    } finally {
      offsetHeight.mockRestore();
    }
  });

  it('cycles the selected value with the mouse wheel while closed', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <InspectorSelect
        ariaLabel="Composite Mode"
        onChange={onChange}
        options={[...OPTIONS]}
        value="normal"
        wheelSelection
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Composite Mode' });
    expect(fireEvent.wheel(trigger, { deltaX: 0, deltaY: 100 })).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith('multiply');

    rerender(
      <InspectorSelect
        ariaLabel="Composite Mode"
        onChange={onChange}
        options={[...OPTIONS]}
        value="multiply"
        wheelSelection
      />,
    );
    fireEvent.wheel(trigger, { deltaX: 0, deltaY: -100 });
    expect(onChange).toHaveBeenLastCalledWith('normal');
  });

  it('selects the centered option while the touch picker scrolls', () => {
    const onChange = vi.fn();
    document.addEventListener('pointerdown', handoffPointerFocus, true);
    render(
      <InspectorSelect
        ariaLabel="Composite Mode"
        onChange={onChange}
        options={[...OPTIONS]}
        touchScrollSelection
        value="normal"
      />,
    );

    const trigger = screen.getByRole('combobox', { name: 'Composite Mode' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 41,
      height: 24,
      left: 260,
      right: 380,
      top: 17,
      width: 120,
      x: 260,
      y: 17,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(trigger, { button: 0, isPrimary: true, pointerType: 'touch' });
    fireEvent.click(trigger);
    trigger.focus();

    const menu = screen.getByRole('listbox');
    const [normal, multiply, screenOption] = screen.getAllByRole('option');
    vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
      bottom: 240,
      height: 240,
      left: 0,
      right: 180,
      top: 0,
      width: 180,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(normal, 'getBoundingClientRect').mockReturnValue({
      bottom: 74,
      height: 44,
      left: 0,
      right: 180,
      top: 30,
      width: 180,
      x: 0,
      y: 30,
      toJSON: () => ({}),
    });
    vi.spyOn(multiply, 'getBoundingClientRect').mockReturnValue({
      bottom: 142,
      height: 44,
      left: 0,
      right: 180,
      top: 98,
      width: 180,
      x: 0,
      y: 98,
      toJSON: () => ({}),
    });
    vi.spyOn(screenOption, 'getBoundingClientRect').mockReturnValue({
      bottom: 206,
      height: 44,
      left: 0,
      right: 180,
      top: 162,
      width: 180,
      x: 0,
      y: 162,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(multiply, { button: 0, isPrimary: true, pointerType: 'touch' });
    expect(trigger).toHaveFocus();
    fireEvent.scroll(menu);

    expect(menu.closest('.inspector-select-touch-layer')).toBeInTheDocument();
    expect(menu.closest('.inspector-select')).toBeNull();
    const glass = menu.closest('.ms-liquid-glass');
    expect(glass).toBeInTheDocument();
    expect(glass).toHaveAttribute('data-placement', 'below');
    expect(glass).toHaveStyle({ left: '260px', top: '46px', width: '190px' });
    expect(onChange).toHaveBeenLastCalledWith('multiply');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });
});


it('keeps pointer hover out of React renders and preserves keyboard selection', () => {
  const onChange = vi.fn(), onRender = vi.fn();
  render(<Profiler id="select" onRender={onRender}><InspectorSelect ariaLabel="Blend test"
    options={[...OPTIONS]} value="normal" onChange={onChange} wheelSelection /></Profiler>);
  const trigger = screen.getByRole('combobox', { name: 'Blend test' });
  fireEvent.click(trigger);
  onRender.mockClear();
  fireEvent.mouseEnter(screen.getByRole('option', { name: 'Screen' }));
  expect(onRender).not.toHaveBeenCalled();
  fireEvent.wheel(screen.getByRole('listbox'), { deltaY: 100 });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('multiply');
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
