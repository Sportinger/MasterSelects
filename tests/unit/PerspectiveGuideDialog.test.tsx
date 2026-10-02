import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveGuideDialog } from '../../src/components/panels/properties/perspectiveGuides/PerspectiveGuideDialog';

vi.mock('../../src/services/rawImage/guidedPhotoPreview', () => ({
  createGuidedPhotoPreview: vi.fn(async () => ({ blob: new Blob(['photo'], { type: 'image/png' }), aspect: 2 / 3, sourceWidth: 4000, sourceHeight: 6000 })),
}));
beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number; pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse';
    }
  });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(800);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function prepare(onApply = vi.fn(), onCancel = vi.fn(), controlsTarget?: HTMLElement) {
  const file = new File(['raw'], 'photo.CR2');
  const result = render(<PerspectiveGuideDialog file={file} controlsTarget={controlsTarget} effects={[]}
    initialGuides={[]} onApply={onApply} onCancel={onCancel} />);
  await screen.findByLabelText('Photo for perspective guides');
  const svg = screen.getByLabelText('Draw perspective guides');
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, width: 400, height: 600,
    right: 400, bottom: 600, toJSON() {} });
  Object.assign(svg, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  const stage = result.container.querySelector('.perspective-guide-stage')!;
  Object.assign(stage, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn(), hasPointerCapture: () => true });
  const draw = (x1: number, y1: number, x2: number, y2: number) => {
    fireEvent.pointerDown(svg, { button: 0, clientX: x1, clientY: y1 });
    fireEvent.pointerMove(svg, { clientX: x2, clientY: y2 });
    fireEvent.pointerUp(svg);
  };
  return { ...result, draw, svg, stage, file, onApply, onCancel };
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
    await waitFor(() => expect(Number(endpoint.getAttribute('cx')) / 4000).toBeCloseTo(.301));
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
  it('edits inline and right-click removes only the targeted line or endpoint', async () => {
    const { draw, container, onApply } = await prepare();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Guided Perspective guides' })).toBeInTheDocument();
    draw(120, 60, 80, 540); draw(280, 60, 320, 540); draw(180, 60, 160, 540);
    fireEvent.contextMenu(container.querySelector('.perspective-guide-hit[data-guide-index="1"]')!);
    expect(screen.getByRole('button', { name: 'Vertical (2/8)' })).toBeInTheDocument();
    expect(Number(screen.getByLabelText('vertical guide 2 start').getAttribute('cx')) / 4000).toBeCloseTo(.45);
    fireEvent.contextMenu(screen.getByLabelText('vertical guide 1 end'));
    expect(screen.getByRole('button', { name: 'Vertical (1/8)' })).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('moves a whole guide without changing its direction and clamps it to the photo', async () => {
    const { draw, svg, container, onApply } = await prepare();
    draw(120, 60, 80, 540); draw(280, 60, 320, 540);
    fireEvent.pointerDown(container.querySelector('.perspective-guide-hit')!, { button: 0, clientX: 100, clientY: 300 });
    fireEvent.pointerMove(svg, { clientX: -100, clientY: 300 });
    fireEvent.pointerUp(svg);
    fireEvent.click(screen.getByRole('button', { name: 'Apply correction' }));
    const first = onApply.mock.calls[0][0][0];
    expect(first.x1).toBeCloseTo(.1); expect(first.x2).toBeCloseTo(0);
    expect(first.y1).toBeCloseTo(.1); expect(first.y2).toBeCloseTo(.9);
  });
  it('retains normalized guides while the existing Preview zoom changes', async () => {
    const {draw,rerender,file,onApply,onCancel}=await prepare();
    draw(120,60,80,540); draw(280,60,320,540);
    const endpoint=screen.getByLabelText('vertical guide 1 start');
    const before=Number(endpoint.getAttribute('r'));
    rerender(<PerspectiveGuideDialog file={file} effects={[]} initialGuides={[]} onApply={onApply} onCancel={onCancel} viewZoom={2}/>);
    expect(Number(endpoint.getAttribute('r'))).toBeCloseTo(before/2);
    fireEvent.click(screen.getByRole('button',{name:'Apply correction'}));
    expect(onApply.mock.calls[0][0][0]).toEqual({axis:'vertical',x1:.3,y1:.1,x2:.2,y2:.9});
  });
  it('keeps pointer focus inside the editor and reserves Space for view panning', async () => {
    const {svg,stage}=await prepare();
    const region=screen.getByRole('region',{name:'Guided Perspective guides'});
    const horizontal=screen.getByRole('button',{name:'Horizontal (0/8)'});
    horizontal.focus(); fireEvent.pointerUp(horizontal); fireEvent.click(horizontal);
    expect(region).toHaveFocus();
    fireEvent.keyDown(region,{key:' ',code:'Space'});
    expect(stage).toHaveAttribute('data-guide-pan','true');
    fireEvent.pointerDown(svg,{button:0,clientX:100,clientY:100});
    fireEvent.pointerMove(svg,{clientX:130,clientY:140}); fireEvent.pointerUp(svg);
    expect(screen.getByRole('button',{name:'Horizontal (0/8)'})).toBeInTheDocument();
    fireEvent.keyUp(region,{key:' ',code:'Space'});
    expect(stage).not.toHaveAttribute('data-guide-pan');
  });
  it('puts only the five requested controls into the existing transport slot', async () => {
    const slot=document.createElement('div'); document.body.appendChild(slot);
    const {container,unmount}=await prepare(vi.fn(),vi.fn(),slot);
    expect(container.querySelector('.perspective-guide-tools')).toBeNull();
    expect([...slot.querySelectorAll('button')].map(button=>button.textContent)).toEqual(['Vertical','Horizontal','Apply','Cancel','Clear guides']);
    expect(container.querySelector('header')).toBeNull();
    expect(container.querySelector('footer')).toBeNull();
    unmount(); slot.remove();
  });
});
