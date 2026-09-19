import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceFitDialogHost } from '../../src/components/common/SourceFitDialog';
import { requestSourceFitDecision } from '../../src/components/common/sourceFitDialog/sourceFitDialogController';

const request = {
  mediaName: 'portrait-shot.mp4',
  sourceWidth: 956,
  sourceHeight: 718,
  compositionWidth: 1920,
  compositionHeight: 1080,
};

afterEach(() => cleanup());

function openDialog(): Promise<'fit' | 'stretch' | 'original'> {
  let decisionPromise!: Promise<'fit' | 'stretch' | 'original'>;
  act(() => {
    decisionPromise = requestSourceFitDecision(request);
  });
  return decisionPromise;
}

describe('SourceFitDialogHost', () => {
  it('shows the import and timeline resolutions above the three choices', () => {
    render(<SourceFitDialogHost />);
    void openDialog();

    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stretch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep, default' })).toHaveFocus();
    expect(screen.getByRole('dialog'))
      .toHaveTextContent('Import 956 × 718 into Timeline 1920 × 1080');
    expect(screen.queryByText(request.mediaName)).not.toBeInTheDocument();
  });

  it('resolves the stretch choice', async () => {
    render(<SourceFitDialogHost />);
    const decisionPromise = openDialog();

    fireEvent.click(screen.getByRole('button', { name: 'Stretch' }));
    await expect(decisionPromise).resolves.toBe('stretch');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the original pixel size on Escape', async () => {
    render(<SourceFitDialogHost />);
    const decisionPromise = openDialog();

    fireEvent.keyDown(window, { key: 'Escape' });
    await expect(decisionPromise).resolves.toBe('original');
  });

  it('moves within the viewport from its glass handle', () => {
    render(<SourceFitDialogHost />);
    void openDialog();

    const dialog = screen.getByRole('dialog');
    const handle = dialog.querySelector('.source-fit-dialog-drag-handle');
    expect(handle).not.toBeNull();

    Object.defineProperty(dialog, 'offsetWidth', { configurable: true, value: 330 });
    Object.defineProperty(dialog, 'offsetHeight', { configurable: true, value: 92 });
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
      bottom: 192,
      height: 92,
      left: 200,
      right: 530,
      top: 100,
      width: 330,
      x: 200,
      y: 100,
      toJSON: () => ({}),
    });

    fireEvent.mouseDown(handle!, { clientX: 220, clientY: 112 });
    expect(dialog).toHaveClass('is-dragging');
    fireEvent.mouseMove(document, { clientX: 320, clientY: 212 });
    fireEvent.mouseUp(document);

    expect(dialog).toHaveStyle({ left: '300px', top: '200px' });
    expect(dialog).not.toHaveClass('is-dragging');
  });
});
