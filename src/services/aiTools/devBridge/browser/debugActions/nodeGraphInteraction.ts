/** Bounded dev-only pan probe. Restores the viewport; never edits nodes/project data. */
export async function measureNodeGraphInteraction(args: Record<string, unknown>) {
  const canvas = [...document.querySelectorAll<HTMLElement>('.node-workspace-canvas')].find(el => el.clientWidth > 0 && el.clientHeight > 0);
  if (!canvas) return { success: false, error: 'No visible node graph.' };
  if (document.hidden) return { success: false, error: 'The node graph tab is hidden; foreground it before measuring.' };
  const hideEdgeDom = args.hideEdgeDom === true;
  if (hideEdgeDom && !canvas.classList.contains('canvas-rendered')) return { success: false, error: 'Edge DOM isolation requires the canvas renderer.' };
  const duration = Math.max(500, Math.min(10000, Number(args.durationMs) || 5000));
  const rect = canvas.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  const inner = canvas.querySelector<HTMLElement>('.node-workspace-canvas-inner');
  const before = inner?.style.transform;
  const counts = { nodes: canvas.querySelectorAll('.node-workspace-node').length,
    edges: canvas.querySelectorAll('.node-workspace-edge-hit').length,
    plugs: canvas.querySelectorAll('.node-workspace-plug').length,
    edgeDomElements: canvas.querySelectorAll('.node-workspace-edges *, .node-workspace-plugs *').length };
  const edgeLayers = hideEdgeDom ? [...canvas.querySelectorAll<SVGElement>('.node-workspace-edges, .node-workspace-plugs')]
    .map(element => ({ element, display: element.style.getPropertyValue('display'), priority: element.style.getPropertyPriority('display') })) : [];
  for (const { element } of edgeLayers) element.style.setProperty('display', 'none', 'important');
  const setCapture = canvas.setPointerCapture, releaseCapture = canvas.releasePointerCapture;
  // Synthetic pointers do not exist in the native capture table. Events are
  // dispatched to the same captured target instead, without global overrides.
  canvas.setPointerCapture = () => {}; canvas.releasePointerCapture = () => {};
  const event = (type: string, dx: number, dy: number) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, pointerId: 9183, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: x + dx, clientY: y + dy,
  }));
  const gaps: number[] = [], worker: Array<Record<string, string | undefined>> = [];
  const hitTestMs: number[] = [];
  let moved = false, last = 0, sampled = 0;
  const start = performance.now();
  try {
    event('pointerdown', 0, 0);
    await new Promise<void>(resolve => {
      const step = (now: number) => {
        if (last) gaps.push(now - last); last = now;
        const elapsed = now - start, phase = Math.min(1, elapsed / duration) * Math.PI * 8;
        event('pointermove', Math.sin(phase) * 90, (Math.cos(phase) - 1) * 60);
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
    event('pointermove', 0, 0); event('pointerup', 0, 0);
    canvas.setPointerCapture = setCapture; canvas.releasePointerCapture = releaseCapture;
    for (const { element, display, priority } of edgeLayers) {
      if (display) element.style.setProperty('display', display, priority);
      else element.style.removeProperty('display');
    }
  }
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const sorted = gaps.toSorted((a, b) => a - b);
  return { success: true, data: { moved, restored: inner?.style.transform === before, frames: gaps.length, counts, hideEdgeDom,
    hitTesting: hitTestMs.length ? { samples: hitTestMs.length, meanMs: hitTestMs.reduce((sum, value) => sum + value, 0) / hitTestMs.length,
      maxMs: Math.max(...hitTestMs) } : null,
    fps: Number((gaps.length * 1000 / gaps.reduce((sum, n) => sum + n, 0)).toFixed(1)),
    p95GapMs: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1)), maxGapMs: Math.max(0, ...gaps), worker } };
}
