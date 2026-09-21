import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { measureNodeGraphInteraction } from '../../src/services/aiTools/devBridge/browser/debugActions/nodeGraphInteraction';

describe('node graph edge DOM performance isolation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    document.body.innerHTML = `<div class="node-workspace-canvas canvas-rendered">
      <div class="node-workspace-canvas-inner"></div>
      <svg class="node-workspace-edges" style="display:block!important"><path class="node-workspace-edge-hit"/></svg>
      <svg class="node-workspace-plugs"><g class="node-workspace-plug"/></svg>
      <div class="node-graph-canvas-surface" data-renderer="worker"><canvas></canvas></div>
    </div>`;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  });
  afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('hides only interaction SVGs during the probe and restores original inline styles', async () => {
    const edges = document.querySelector<SVGElement>('.node-workspace-edges')!;
    const plugs = document.querySelector<SVGElement>('.node-workspace-plugs')!;
    const pending = measureNodeGraphInteraction({ durationMs: 500, hideEdgeDom: true });
    expect(edges.style.display).toBe('none'); expect(plugs.style.display).toBe('none');
    expect(document.querySelector('canvas')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(600);
    const result = await pending;
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ restored: true, hideEdgeDom: true, counts: { edges: 1, plugs: 1, edgeDomElements: 2 } });
    expect(edges.style.display).toBe('block'); expect(edges.style.getPropertyPriority('display')).toBe('important');
    expect(plugs.style.getPropertyValue('display')).toBe('');
  });

  it('refuses edge isolation when SVG is the visible fallback renderer', async () => {
    document.querySelector('.node-workspace-canvas')!.classList.remove('canvas-rendered');
    expect(await measureNodeGraphInteraction({ hideEdgeDom: true })).toMatchObject({ success: false });
    expect(document.querySelector<SVGElement>('.node-workspace-edges')!.style.display).toBe('block');
  });
});
