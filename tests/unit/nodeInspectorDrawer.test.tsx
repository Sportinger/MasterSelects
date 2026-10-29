import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeInspectorDrawer } from '../../src/components/panels/nodes/workspace/NodeInspectorDrawer';
import { setNodeInspectorOpen, useNodeInspectorOpen, useNodeInspectorVisibility } from '../../src/components/panels/nodes/workspace/nodeInspectorVisibility';
import { NODE_INSPECTOR_SLIDING, slideNodeInspector } from '../../src/components/panels/nodes/workspace/nodeInspectorSlide';

const inspector = (label: string) => <aside className="node-workspace-inspector" aria-label="Inspector">{label}</aside>;
const view = (label: string, panelId = 'nodes') => <div className="node-workspace-panel">
  <div className="node-workspace-main" /><NodeInspectorDrawer panelId={panelId}>{inspector(label)}</NodeInspectorDrawer>
</div>;
const handle = () => screen.getByRole('button', { name: /node inspector/ });

/** The sidebar state as a mounted view sees it (per panel and skin, with the skin's default). */
const isNodeInspectorOpen = (panelId: string) => renderHook(() => useNodeInspectorOpen(panelId)).result.current;

beforeEach(() => {
  localStorage.clear();
  useNodeInspectorVisibility.setState({ open: {} });
});
afterEach(() => {
  cleanup();
  document.body.classList.remove('mobile-skin');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('node inspector sidebar visibility', () => {
  it('toggles only from its handle and starts open on the desktop', () => {
    render(view('Transform'));
    expect(handle().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Inspector').textContent).toBe('Transform');
    fireEvent.click(handle());
    expect(handle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Inspector')).toBeNull();
    fireEvent.click(handle());
    expect(screen.getByLabelText('Inspector').textContent).toBe('Transform');
  });

  it('stays closed when the selection changes and shows the current pick once opened', () => {
    const { rerender } = render(view('Transform'));
    fireEvent.click(handle());
    rerender(view('Blur'));
    rerender(view('Color'));
    expect(screen.queryByLabelText('Inspector')).toBeNull();
    expect(isNodeInspectorOpen('nodes')).toBe(false);
    fireEvent.click(handle());
    expect(screen.getByLabelText('Inspector').textContent).toBe('Color');
  });

  it('keeps its state when another view of the same panel mounts (composition vs. clip graph, remounts)', () => {
    const first = render(view('Composition'));
    fireEvent.click(handle());
    first.unmount();
    render(view('Clip graph'));
    expect(handle().getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByLabelText('Inspector')).toBeNull();
  });

  it('is kept per panel and survives a reload through local storage', () => {
    setNodeInspectorOpen('nodes', false);
    expect(isNodeInspectorOpen('nodes')).toBe(false);
    expect(isNodeInspectorOpen('nodes-2')).toBe(true);
    expect(localStorage.getItem('masterselects.nodeWorkspace.inspectorOpen')).toContain('"desktop:nodes":false');
  });

  it('starts closed on the phone skin, separately from the desktop value', () => {
    setNodeInspectorOpen('nodes', true);
    document.body.classList.add('mobile-skin');
    expect(isNodeInspectorOpen('nodes')).toBe(false);
    render(view('Transform'));
    expect(screen.queryByLabelText('Inspector')).toBeNull();
  });

  it('drops focus after a pointer click and keeps it for keyboard activation', () => {
    render(view('Transform'));
    handle().focus();
    fireEvent.click(handle(), { detail: 1 });
    expect(document.activeElement).not.toBe(handle());
    handle().focus();
    fireEvent.click(handle(), { detail: 0 });
    expect(document.activeElement).toBe(handle());
  });
});

describe('node inspector slide', () => {
  type FakeAnimation = { keyframes: Keyframe[]; options: KeyframeAnimationOptions; cancel: () => void; onfinish: (() => void) | null; cancelled: boolean };
  let animations: FakeAnimation[];
  let transform = 'none';
  beforeEach(() => {
    animations = [];
    transform = 'none';
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    HTMLElement.prototype.animate = function animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      const animation: FakeAnimation = { keyframes, options, onfinish: null, cancelled: false, cancel: () => { animation.cancelled = true; } };
      animations.push(animation);
      return animation as unknown as Animation;
    } as typeof HTMLElement.prototype.animate;
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation(element => {
      const style = computed(element);
      return element.classList.contains('node-workspace-inspector') ? { ...style, transform, position: style.position } as CSSStyleDeclaration : style;
    });
    vi.stubGlobal('DOMMatrixReadOnly', class { m41: number; constructor(value: string) { this.m41 = Number(/matrix\([^,]+,[^,]+,[^,]+,[^,]+,([^,]+),/.exec(value)?.[1]); } });
  });
  afterEach(() => { delete (HTMLElement.prototype as Partial<HTMLElement>).animate; });

  const mount = () => {
    render(view('Transform'));
    const aside = screen.getByLabelText('Inspector'), panel = aside.parentElement!;
    vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ right: 1000 } as DOMRect);
    vi.spyOn(aside, 'getBoundingClientRect').mockReturnValue({ left: 700 } as DOMRect);
    return { aside, panel, button: handle() };
  };

  it('slides over the canvas with transforms only and returns to the flex row when settled', () => {
    const { aside, panel, button } = mount();
    const settled = vi.fn();
    slideNodeInspector(button, true, settled);
    expect(aside.hasAttribute(NODE_INSPECTOR_SLIDING)).toBe(true);
    expect(panel.hasAttribute(NODE_INSPECTOR_SLIDING)).toBe(true);
    expect(animations.map(animation => animation.keyframes.map(frame => frame.transform)))
      .toEqual([['translateX(300px)', 'translateX(0px)'], ['translateX(0px)', 'translateX(-300px)']]);
    expect(animations[0].options).toMatchObject({ duration: 200, fill: 'forwards' });
    animations[0].onfinish?.();
    expect(settled).toHaveBeenCalledOnce();
    expect(aside.hasAttribute(NODE_INSPECTOR_SLIDING)).toBe(false);
    expect(panel.hasAttribute(NODE_INSPECTOR_SLIDING)).toBe(false);
    expect(animations.every(animation => animation.cancelled)).toBe(true);
  });

  it('continues a reversed slide from where the sidebar is, in the remaining time', () => {
    const { button } = mount();
    const firstSettled = vi.fn();
    slideNodeInspector(button, true, firstSettled);
    transform = 'matrix(1, 0, 0, 1, 120, 0)';
    slideNodeInspector(button, false, vi.fn());
    expect(animations.slice(0, 2).every(animation => animation.cancelled)).toBe(true);
    expect(animations[2].keyframes.map(frame => frame.transform)).toEqual(['translateX(120px)', 'translateX(300px)']);
    expect(animations[2].options.duration).toBeCloseTo(200 * 180 / 300);
    animations[0].onfinish?.();
    expect(firstSettled).not.toHaveBeenCalled();
  });

  it('only slides the floating phone drawer and leaves its handle in place', () => {
    const { aside, button } = mount();
    aside.style.position = 'absolute';
    slideNodeInspector(button, false, vi.fn());
    expect(aside.hasAttribute(NODE_INSPECTOR_SLIDING)).toBe(false);
    expect(animations).toHaveLength(1);
    expect(animations[0].keyframes.map(frame => frame.transform)).toEqual(['translateX(0px)', 'translateX(300px)']);
  });

  it('respects reduced motion: no animation, the sidebar switches at once', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { button } = mount();
    const settled = vi.fn();
    slideNodeInspector(button, false, settled);
    expect(animations).toHaveLength(0);
    await act(async () => {});
    expect(settled).toHaveBeenCalledOnce();
  });

  it('keeps the closing sidebar mounted until its slide has finished', () => {
    render(view('Transform'));
    fireEvent.click(handle());
    expect(screen.getByLabelText('Inspector')).toBeTruthy();
    act(() => animations[0].onfinish?.());
    expect(screen.queryByLabelText('Inspector')).toBeNull();
  });
});
