import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExportActionFooter } from '../../src/components/export/panel/ExportActionFooter';
import {
  FACTORY_MOBILE_LAYOUT_ID,
  useDockStore,
} from '../../src/stores/dockStore';

afterEach(() => {
  cleanup();
  useDockStore.setState({ activeSavedLayoutId: null });
});

describe('ExportActionFooter', () => {
  it('keeps the desktop export action clickable', () => {
    const onExport = vi.fn();
    render(
      <ExportActionFooter
        disabled={false}
        estimatedSizeLabel="~12 MB"
        label="Export"
        onExport={onExport}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export' }), { detail: 1 });
    expect(onExport).toHaveBeenCalledOnce();
  });

  it('requires a completed swipe in the mobile layout', () => {
    useDockStore.setState({ activeSavedLayoutId: FACTORY_MOBILE_LAYOUT_ID });
    const onExport = vi.fn();
    const { container } = render(
      <ExportActionFooter
        disabled={false}
        estimatedSizeLabel="~12 MB"
        label="Export"
        onExport={onExport}
      />,
    );
    const track = screen.getByRole('button', { name: 'Swipe to Export' });
    expect(track).toHaveAttribute('data-dock-tab-swipe-ignore', 'true');
    const thumb = container.querySelector<HTMLElement>('.export-swipe-thumb');
    expect(thumb).not.toBeNull();
    Object.assign(track, {
      getBoundingClientRect: () => ({
        bottom: 36,
        height: 36,
        left: 0,
        right: 260,
        top: 0,
        width: 260,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
      setPointerCapture: vi.fn(),
    });

    fireEvent.click(track, { detail: 1 });
    expect(onExport).not.toHaveBeenCalled();

    fireEvent.pointerDown(thumb!, {
      button: 0,
      clientX: 18,
      pointerId: 7,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(track, { clientX: 235, pointerId: 7, pointerType: 'touch' });
    fireEvent.pointerUp(track, { button: 0, clientX: 235, pointerId: 7, pointerType: 'touch' });

    expect(onExport).toHaveBeenCalledOnce();
  });
});
