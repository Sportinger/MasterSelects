import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TimelineEmptyContextMenu } from '../../src/components/timeline/TimelineEmptyContextMenu';

function renderEmptyMenu(onClose = vi.fn()) {
  render(
    <>
      <button type="button">outside</button>
      <TimelineEmptyContextMenu
        menu={{ x: 20, y: 30, time: 12.5, trackId: 'track-a' }}
        onClose={onClose}
        onEraseGap={vi.fn()}
        onEraseLayerGaps={vi.fn()}
        onEraseAllGaps={vi.fn()}
        onFitCompToWindow={vi.fn()}
      />
    </>,
  );

  return { onClose };
}

describe('TimelineEmptyContextMenu', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the menu open for capture-phase contextmenu events inside the menu', () => {
    const { onClose } = renderEmptyMenu();

    fireEvent.contextMenu(screen.getByText('Erase Space Between Clips'));

    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes for capture-phase contextmenu events outside the menu', () => {
    const { onClose } = renderEmptyMenu();

    fireEvent.contextMenu(screen.getByText('outside'));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
