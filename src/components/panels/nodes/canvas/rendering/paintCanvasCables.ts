import { traceCableRoute } from '../cableRoute';
import { coveredCableOpacity } from '../edgeGroupOcclusion';
import { canvasCableRoute } from './cableGeometry';
import { coveredCanvasCableRoutes, type CoveredRoute } from './canvasCableCoverage';
import { queryCanvasCableCovers } from './cableOcclusion';
import { recordPaintPhase } from './nodePaintProfile';
import type { CanvasCable, CanvasView, Rect } from './nodeCanvasTypes';
import type { DrawContext } from './paintNodeCanvas';

const coverage = new WeakMap<CanvasCable, { key: string; pieces: CoveredRoute[] }>();
/** Batch visible curve pieces by appearance. No rectangle-plane clip or repeated
 * whole-graph path is sent to the rasterizer for each group-depth pass. */
export function paintCanvasCables(ctx: DrawContext, cables: readonly CanvasCable[], view: CanvasView) {
  const start = import.meta.env.DEV ? performance.now() : 0;
  const margin = 12 / view.zoom;
  const viewport: Rect = { x: -view.panX / view.zoom - margin, y: -view.panY / view.zoom - margin,
    width: view.width / view.zoom + 2 * margin, height: view.height / view.zoom + 2 * margin };
  const key = `${viewport.x}|${viewport.y}|${viewport.width}|${viewport.height}`;
  const batches = new Map<string, { path: Path2D; color: string; alpha: number; width: number; dash: number[] }>();
  const thin = Math.min(1, 0.4 + view.zoom * 1.2) / view.zoom;
  let coverMs = 0, pieceCount = 0, cableCount = 0;
  const batch = (cable: CanvasCable, depth: number, arrow = false) => {
    const fade = cable.disappearing ? cable.appearance ?? 1 : 1;
    const alpha = (depth ? coveredCableOpacity(depth) : cable.highlighted ? 1 : 0.55) * fade;
    const width = (arrow ? 1.3 : cable.highlighted ? 2 : 1.25) * thin;
    const dash = !arrow && (cable.draft || cable.baked) ? [cable.draft ? 5 / view.zoom : 4 / view.zoom, 4 / view.zoom] : [];
    const id = `${cable.color}|${alpha}|${width}|${dash.join(',')}`;
    let value = batches.get(id);
    if (!value) { value = { path: new Path2D(), color: cable.color, alpha, width, dash }; batches.set(id, value); }
    return value.path;
  };
  for (const cable of cables) {
    const bounds = canvasCableRoute(cable).bounds;
    if (bounds.x > viewport.x + viewport.width || bounds.y > viewport.y + viewport.height
      || bounds.x + bounds.width < viewport.x || bounds.y + bounds.height < viewport.y) continue;
    const before = import.meta.env.DEV ? performance.now() : 0;
    let cached = coverage.get(cable);
    if (cached?.key !== key) { cached = { key, pieces: coveredCanvasCableRoutes(cable, viewport) }; coverage.set(cable, cached); }
    if (import.meta.env.DEV) coverMs += performance.now() - before;
    if (!cached.pieces.length) continue;
    cableCount++;
    for (const { route, depth } of cached.pieces) { traceCableRoute(batch(cable, depth), route); pieceCount++; }
    if (!cable.disappearing && (cable.appearance ?? 1) < 1) continue;
    const { middle: { point, angle } } = canvasCableRoute(cable);
    if (point.x < viewport.x || point.x > viewport.x + viewport.width || point.y < viewport.y || point.y > viewport.y + viewport.height) continue;
    const depth = queryCanvasCableCovers(cable, { ...point, width: 0, height: 0 }).length;
    const arrow = batch(cable, depth, true), cos = Math.cos(angle), sin = Math.sin(angle), size = 3 / view.zoom;
    arrow.moveTo(point.x - size * cos + size * sin, point.y - size * sin - size * cos);
    arrow.lineTo(point.x, point.y);
    arrow.lineTo(point.x - size * cos - size * sin, point.y - size * sin + size * cos);
  }
  for (const { path, color, alpha, width, dash } of batches.values()) {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(path);
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (import.meta.env.DEV) {
    recordPaintPhase('paint-covers', coverMs, pieceCount);
    recordPaintPhase('paint-edges', performance.now() - start, cableCount);
  }
}
