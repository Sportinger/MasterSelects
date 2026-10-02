import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveGuideDialog } from '../../src/components/panels/properties/perspectiveGuides/PerspectiveGuideDialog';

vi.mock('../../src/services/rawImage/guidedPhotoPreview', () => ({
  createGuidedPhotoPreview: vi.fn(async () => ({ blob: new Blob(['photo'], { type: 'image/png' }), aspect: 2 / 3 })),
}));
beforeEach(() => {
  vi.stubGlobal('PointerEvent', MouseEvent);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function prepare(onApply = vi.fn(), onCancel = vi.fn()) {
  const result = render(<PerspectiveGuideDialog file={new File(['raw'], 'photo.CR2')} effects={[]}
    initialGuides={[]} onApply={onApply} onCancel={onCancel} />);
  await screen.findByAltText('Photo for perspective guides');
  const svg = screen.getByLabelText('Draw perspective guides');
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 600,
    right: 400, bottom: 600, toJSON() {} });
  Object.assign(svg, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  const draw = (x1: number, y1: number, x2: number, y2: number) => {
    fireEvent.pointerDown(svg, { button: 0, clientX: x1, clientY: y1 });
    fireEvent.pointerMove(svg, { clientX: x2, clientY: y2 });
    fireEvent.pointerUp(svg);
  };
  return { ...result, draw, svg, onApply, onCancel };
}
describe('Perspective guide editor', () => {
  it('draws more than two vertical guides and horizontal guides, then commits one solved correction', async () => {
    const { draw, onApply, unmount } = await prepare();
    draw(120, 60, 80, 540); draw(280, 60, 320, 540);
    draw(180, 60, 160, 540); draw(220, 60, 240, 540);
    expect(screen.getByRole('button', { name: 'Vertical (4/8)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Horizontal (0/8)' }));
    draw(80, 180, 320, 210); draw(80, 420, 320, 390);
    expect(screen.getByRole('button', { name: 'Horizontal (2/8)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Apply correction' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));
    expect(onApply).toHaveBeenCalledOnce();
    expect(onApply.mock.calls[0][0]).toHaveLength(6);
    expect(onApply.mock.calls[0][1].every(Number.isFinite)).toBe(true);
    unmount();
  });
  it('supports endpoint keyboard adjustment and cancellation without applying drafts', async () => {
    const { draw, onApply, onCancel } = await prepare();
    draw(120, 60, 80, 540); draw(280, 60, 320, 540);
    const endpoint = screen.getByRole('button', { name: 'vertical guide 1 start' });
    fireEvent.keyDown(endpoint, { key: 'ArrowRight' });
    await waitFor(() => expect(Number(endpoint.getAttribute('cx'))).toBeCloseTo(301));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce(); expect(onApply).not.toHaveBeenCalled();
  });
  it('rejects incomplete direction groups and cancels an interrupted pointer gesture', async () => {
    const { draw, svg } = await prepare();
    draw(120, 60, 80, 540);
    expect(screen.getByRole('button', { name: 'Apply correction' })).toBeDisabled();
    fireEvent.pointerDown(svg, { button: 0, clientX: 280, clientY: 60 });
    fireEvent.pointerMove(svg, { clientX: 320, clientY: 540 });
    fireEvent.pointerCancel(svg);
    expect(screen.getByRole('button', { name: 'Vertical (1/8)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'vertical guide 2 start' })).not.toBeInTheDocument();
  });
});
