import { readNodeCanvasProfile } from '../../../../../components/panels/nodes/canvas/rendering/nodeCanvasProfile';
import { measureJsCpuProfile } from './jsCpuProfile';

/** Bounded dev-only pan probe, or passive observation with pan:false for folds. */
export async function measureNodeGraphInteraction(args: Record<string, unknown>) {
  const canvas = [...document.querySelectorAll<HTMLElement>('.node-workspace-canvas')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
  if (!canvas) return { success: false, error: 'No visible node graph.' };
  if (document.hidden) return { success: false, error: 'The node graph tab is hidden; foreground it before measuring.' };
  const hideEdgeDom = args.hideEdgeDom === true;
  const hideNodeDom = args.hideNodeDom === true;
  if ((hideEdgeDom || hideNodeDom || args.hideInteractionDom || args.hideGroupBackgrounds || args.hideCanvasSurface)
    && !canvas.classList.contains('canvas-rendered')) return { success: false, error: 'DOM isolation requires the canvas renderer.' };
  const duration = Math.max(500, Math.min(10000, Number(args.durationMs) || 5000));
  const pan = args.pan !== false;
  const rect = canvas.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const inner = canvas.querySelector<HTMLElement>('.node-workspace-canvas-inner');
  const before = inner?.style.transform;
  const counts = { nodes: canvas.querySelectorAll('.node-workspace-node').length,
    edges: canvas.querySelectorAll('.node-workspace-edge-hit').length,
    plugs: canvas.querySelectorAll('.node-workspace-plug').length,
    edgeDomElements: canvas.querySelectorAll('.node-workspace-edges *, .node-workspace-plugs *').length };
  const selectors = [hideEdgeDom ? '.node-workspace-edges, .node-workspace-plugs' : '', hideNodeDom ? '.node-workspace-node' : '',
    args.hideGroupBackgrounds === true ? '.node-graph-group-backgrounds' : '',
    args.hideInteractionDom === true ? '.node-workspace-canvas-inner' : '',
    args.hideCanvasSurface === true ? '.node-graph-canvas-surface' : '',
    args.hideGrid === true ? '.node-workspace-grid' : ''].filter(Boolean).join(', ');
  const edgeLayers = selectors ? [...canvas.querySelectorAll<HTMLElement | SVGElement>(selectors)]
    .map(element => ({ element, display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') })) : [];
  for (const { element } of edgeLayers) element.style.setProperty('display', 'none', 'important');
  const setCapture = canvas.setPointerCapture, releaseCapture = canvas.releasePointerCapture;
  // Synthetic pointers do not exist in the native capture table. Events are
  // dispatched to the same captured target instead, without global overrides.
  if (pan) { canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {}; }
  const event = (type: string, dx: number, dy: number) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 9183, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y + dy,
  }));
  const gaps: number[] = [], worker: Array<Record<string, string | undefined>> = [];
  const hitTestMs: number[] = [];
  let moved = false, last = 0, sampled = 0;
  const start = performance.now();
  const reactBefore = readNodeCanvasProfile(canvas);
  const cpuProfile = args.profileCpu === true ? measureJsCpuProfile({ durationMs: duration }) : undefined;
  try {
    if (pan) event('pointerdown', 0, 0);
    await new Promise<void>(resolve => {
      const step = (now: number) => {
        if (last) gaps.push(now - last); last = now;
        const elapsed = now - start, phase = Math.min(1, elapsed / duration) * Math.PI * 8;
        if (pan) event('pointermove', Math.sin(phase) * 90, (Math.cos(phase) - 1) * 60);
        moved ||= inner?.style.transform !== before;
        if (args.measureHitTesting === true) {
          // Synthetic dispatch bypasses native hit testing. Measure it explicitly
          // when isolating SVG costs, including any required style/layout flush.
          const hitStart = performance.now();
          document.elementFromPoint(x + Math.sin(phase) * 90, y + (Math.cos(phase) - 1) * 60);
          hitTestMs.push(performance.now() - hitStart);
        }
        if (elapsed - sampled >= 1000) {
          const surface = canvas.querySelector<HTMLElement>('.node-graph-canvas-surface');
          if (surface) worker.push({ ...surface.dataset }); sampled = elapsed;
        }
        if (elapsed < duration) requestAnimationFrame(step); else resolve();
      };
      requestAnimationFrame(step);
    });
  } finally {
    if (pan) {
      event('pointermove', 0, 0); event('pointerup', 0, 0);
      canvas.setPointerCapture = setCapture; canvas.releasePointerCapture = releaseCapture;
    }
    for (const { element, display, priority } of edgeLayers) {
      if (display) element.style.setProperty('display', display, priority);
      else element.style.removeProperty('display');
    }
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const sorted = gaps.toSorted((a, b) => a - b);
  const reactAfter = readNodeCanvasProfile(canvas);
  return { success: true, data: { pan, moved, restored: inner?.style.transform === before, frames: gaps.length, counts, hideEdgeDom, hideNodeDom,
    hideGroupBackgrounds: args.hideGroupBackgrounds === true, hideInteractionDom: args.hideInteractionDom === true,
    hideCanvasSurface: args.hideCanvasSurface === true, hideGrid: args.hideGrid === true,
    view: { width: rect.width, height: rect.height, transform: before },
    react: { commits: reactAfter.commits - reactBefore.commits, renderMs: reactAfter.renderMs - reactBefore.renderMs },
    hitTesting: hitTestMs.length ? { samples: hitTestMs.length, meanMs: hitTestMs.reduce((sum, value) => sum + value, 0) / hitTestMs.length,
      maxMs: Math.max(...hitTestMs) } : null,
    fps: Number((gaps.length * 1000 / gaps.reduce((sum, n) => sum + n, 0)).toFixed(1)),
    p95GapMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)), maxGapMs: Math.max(0, ...gaps), worker,
    ...(cpuProfile ? { cpuProfile: await cpuProfile } : {}) } };
}
