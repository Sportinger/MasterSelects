import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ timeline: {} as Record<string, unknown> }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: () => mock.timeline }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: (select: (state: { activeCompositionId: string }) => unknown) => select({ activeCompositionId: 'comp' }) }));
import { RotoPreviewOverlay } from '../../src/components/preview/RotoPreviewOverlay';
import { rotoPreview } from '../../src/services/roto/rotoPreview';
import { RotoSession } from '../../src/services/roto/RotoSession';

const owner = {}, onPoint = vi.fn();
const props = { displayedCompId: 'comp', width: 400, height: 400, resolution: { width: 400, height: 400 } };
beforeEach(() => {
  onPoint.mockClear();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: vi.fn(), drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const transform = { position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } };
  mock.timeline = {
    clips: [{ id: 'clip', startTime: 0, duration: 10, inPoint: 2, outPoint: 12, trackId: 'track', source: { type: 'video' } }],
    selectedClipIds: new Set(['clip']), layers: [{ sourceClipId: 'clip', visible: true, source: { intrinsicWidth: 400, intrinsicHeight: 400 } }],
    playheadPosition: 1, isPlaying: false, isExporting: false, tracks: [{ id: 'track', locked: false }],
    getClipKeyframes: () => [], getInterpolatedTransform: () => transform,
  };
  rotoPreview.show(owner, { clipId: 'clip', compositionId: 'comp', session: new RotoSession('', undefined, 2, 12),
    busy: false, label: 1, points: [], edges: { offset: 0, softness: 0 }, onPoint });
});
afterEach(() => { cleanup(); rotoPreview.clear(owner); vi.restoreAllMocks(); });
function input() {
  const element = screen.getByRole('img', { name: 'Roto selection in Preview' });
  vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({ x: 100, y: 50, left: 100, top: 50, right: 500, bottom: 450, width: 400, height: 400, toJSON: () => ({}) });
  return element;
}
function point(element: HTMLElement, extras = {}) {
  fireEvent.pointerDown(element, { pointerId: 1, clientX: 300, clientY: 250, ...extras });
  fireEvent.pointerUp(element, { pointerId: 1, clientX: 300, clientY: 250, ...extras });
}
describe('Main Preview Roto interaction', () => {
  it('selects the actual preview source time without needing a loaded detail frame', () => {
    render(<RotoPreviewOverlay {...props} />); point(input());
    expect(onPoint).toHaveBeenCalledWith({ x: .5, y: .5, label: 1 }, 3);
  });
  it('supports background points and ignores a drag gesture', () => {
    render(<RotoPreviewOverlay {...props} />); const element = input(); point(element, { button: 2 });
    expect(onPoint).toHaveBeenLastCalledWith({ x: .5, y: .5, label: 0 }, 3);
    fireEvent.pointerDown(element, { pointerId: 2, clientX: 300, clientY: 250 });
    fireEvent.pointerUp(element, { pointerId: 2, clientX: 330, clientY: 250 });
    expect(onPoint).toHaveBeenCalledTimes(1);
  });
  it('blocks selection during playback and on locked tracks', () => {
    mock.timeline.isPlaying = true;
    const view = render(<RotoPreviewOverlay {...props} />); point(input());
    expect(onPoint).not.toHaveBeenCalled();
    mock.timeline.isPlaying = false; mock.timeline.tracks = [{ id: 'track', locked: true }];
    view.rerender(<RotoPreviewOverlay {...props} />); point(input());
    expect(onPoint).not.toHaveBeenCalled();
  });
  it('keeps keyboard selection local to the Preview overlay', () => {
    render(<RotoPreviewOverlay {...props} />); const element = input();
    fireEvent.keyDown(element, { key: 'ArrowRight' });
    fireEvent.keyDown(element, { key: 'Enter', ctrlKey: true });
    expect(onPoint).toHaveBeenCalledWith({ x: .501, y: .5, label: 0 }, 3);
  });
  it('does not show another composition or a frame outside the selected clip', () => {
    const view = render(<RotoPreviewOverlay {...props} displayedCompId="other" />);
    expect(screen.queryByRole('img', { name: 'Roto selection in Preview' })).toBeNull();
    mock.timeline.playheadPosition = 12;
    view.rerender(<RotoPreviewOverlay {...props} />);
    expect(screen.queryByRole('img', { name: 'Roto selection in Preview' })).toBeNull();
  });
  it('removes the overlay when its inspector owner closes', () => {
    render(<RotoPreviewOverlay {...props} />);
    act(() => rotoPreview.clear(owner));
    expect(screen.queryByRole('img', { name: 'Roto selection in Preview' })).toBeNull();
  });
});
