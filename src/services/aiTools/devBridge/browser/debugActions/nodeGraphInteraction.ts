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
  // hoverSweep: buttonless pointer moves along the same path (cable hover probing).
  const hoverSweep = args.hoverSweep === true;
  const pan = args.pan !== false && !hoverSweep;
  const radius = Math.max(10, Math.min(1000, Number(args.radiusPx) || 90));
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
    button: 0, buttons: type === 'pointerup' || hoverSweep ? 0 : 1, clientX: x + dx, clientY: y + dy,
  }));
  const gaps: number[] = [], foldGaps: number[] = [], worker: Array<Record<string, string | undefined>> = [];
  const hitTestMs: number[] = [];
  // Visible graph frames: bitmaps the worker presented, sampled every tick.
  const surfaceHost = canvas.querySelector<HTMLElement>('.node-graph-canvas-surface');
  const presentedCount = () => Number(surfaceHost?.dataset.presentedFrames ?? 0);
  const presents: number[] = [];
  let lastPresented = presentedCount();
  let moved = false, last = 0, sampled = 0, wasFolding = false;
  const start = performance.now();
  const reactBefore = readNodeCanvasProfile(canvas);
  const timingsRef = () => (window as unknown as { __nodeCanvasTimings?: Record<string, { n: number; ms: number; max: number }> }).__nodeCanvasTimings ?? {};
  const timingsBefore = JSON.parse(JSON.stringify(timingsRef())) as Record<string, { n: number; ms: number; max: number }>;
  const cpuProfile = args.profileCpu === true ? measureJsCpuProfile({ durationMs: duration }) : undefined;
  try {
    if (pan) event('pointerdown', 0, 0);
    await new Promise<void>(resolve => {
      const step = (now: number) => {
        const folding = canvas.dataset.layoutAnimating === 'true';
        if (last) { gaps.push(now - last); if (folding || wasFolding) foldGaps.push(now - last); }
        wasFolding = folding; last = now;
        const presented = presentedCount();
        if (presented !== lastPresented) { presents.push(now); lastPresented = presented; }
        const elapsed = now - start, phase = Math.min(1, elapsed / duration) * Math.PI * 8;
        if (pan || hoverSweep) event('pointermove', Math.sin(phase) * radius, (Math.cos(phase) - 1) * radius * 2 / 3);
        moved ||= inner?.style.transform !== before;
        if (args.measureHitTesting === true) {
          // Synthetic dispatch bypasses native hit testing. Measure it explicitly
          // when isolating SVG costs, including any required style/layout flush.
          const hitStart = performance.now();
          document.elementFromPoint(x + Math.sin(phase) * radius, y + (Math.cos(phase) - 1) * radius * 2 / 3);
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
  const presentGaps = presents.slice(1).map((time, index) => time - presents[index]);
  const visible = { frames: presents.length, firstAtMs: presents.length ? Number((presents[0] - start).toFixed(0)) : null,
    activeFps: presents.length > 1 ? Number(((presents.length - 1) * 1000 / (presents.at(-1)! - presents[0])).toFixed(1)) : 0,
    maxGapMs: Number(Math.max(0, ...presentGaps).toFixed(0)),
    gapsMs: presentGaps.map(gap => Math.round(gap)).slice(0, 60) };
  const phaseTimings = Object.fromEntries(Object.entries(timingsRef()).map(([name, value]) => [name, {
    n: value.n - (timingsBefore[name]?.n ?? 0), ms: Number((value.ms - (timingsBefore[name]?.ms ?? 0)).toFixed(1)), max: Number(value.max.toFixed(1)) }]));
  return { success: true, data: { phaseTimings, visible, canvasConnected: canvas.isConnected, surfaceConnected: !!surfaceHost?.isConnected, canvasCount: document.querySelectorAll(".node-workspace-canvas").length, pan, moved, restored: inner?.style.transform === before, frames: gaps.length, counts, hideEdgeDom, hideNodeDom,
    hideGroupBackgrounds: args.hideGroupBackgrounds === true, hideInteractionDom: args.hideInteractionDom === true,
    hideCanvasSurface: args.hideCanvasSurface === true, hideGrid: args.hideGrid === true,
    view: { width: rect.width, height: rect.height, transform: before },
    react: { commits: reactAfter.commits - reactBefore.commits, renderMs: reactAfter.renderMs - reactBefore.renderMs },
    hitTesting: hitTestMs.length ? { samples: hitTestMs.length, meanMs: hitTestMs.reduce((sum, value) => sum + value, 0) / hitTestMs.length,
      maxMs: Math.max(...hitTestMs) } : null,
    fps: Number((gaps.length * 1000 / gaps.reduce((sum, n) => sum + n, 0)).toFixed(1)),
    p95GapMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)), maxGapMs: Math.max(0, ...gaps), worker,
    folding: foldGaps.length ? { frames: foldGaps.length, elapsedMs: foldGaps.reduce((sum, gap) => sum + gap, 0),
      fps: foldGaps.length * 1000 / foldGaps.reduce((sum, gap) => sum + gap, 0),
      p95GapMs: foldGaps.toSorted((a, b) => a - b)[Math.floor(foldGaps.length * .95)], maxGapMs: Math.max(...foldGaps) } : null,
    ...(cpuProfile ? { cpuProfile: await cpuProfile } : {}) } };
}
