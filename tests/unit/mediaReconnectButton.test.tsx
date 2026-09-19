import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reloadFile: vi.fn<(id: string) => Promise<boolean>>(),
}));

vi.mock('../../src/stores/mediaStore', () => ({
  useMediaStore: (selector: (state: { reloadFile: typeof mocks.reloadFile }) => unknown) => (
    selector({ reloadFile: mocks.reloadFile })
  ),
}));

import { MediaReconnectButton } from '../../src/components/panels/media/MediaReconnectButton';

afterEach(() => {
  mocks.reloadFile.mockReset();
});

describe('MediaReconnectButton', () => {
  it('reconnects through the stored-handle reload path without opening a picker', async () => {
    mocks.reloadFile.mockResolvedValue(true);
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <MediaReconnectButton mediaFileId="media-1" />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect media file' }));

    await waitFor(() => expect(mocks.reloadFile).toHaveBeenCalledWith('media-1'));
    expect(parentClick).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Reconnected media file' })).toBeTruthy();
  });

  it('reports when the saved file handle is no longer available', async () => {
    mocks.reloadFile.mockResolvedValue(false);
    render(<MediaReconnectButton mediaFileId="media-2" />);

    fireEvent.click(screen.getByRole('button', { name: 'Reconnect media file' }));

    const button = await screen.findByRole('button', { name: 'Unavailable media file' });
    expect(button.getAttribute('title')).toContain('Use Relink');
  });
});
