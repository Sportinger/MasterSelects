import { interpolateKeyframes } from '../../../../../utils/keyframeInterpolation';
import { cableArcLengths, cablePoint, signalPosition } from './cableGeometry';
import { fitCanvasLabel } from './canvasTextLayout';
import type { CanvasCable, CanvasCurve, CanvasNode, CanvasScene, CanvasTheme, CanvasTransport, CanvasView, Rect } from './nodeCanvasTypes';
import { CARD_SPRITE_PAD } from './nodeCardSprites';
import { pointBehindGroup, subtractOccludedRects } from '../edgeGroupOcclusion';

export type DrawContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export function inView(rect: Rect, view: CanvasView, margin = 30): boolean {
  return (rect.x + rect.width) * view.zoom + view.panX >= -margin && rect.x * view.zoom + view.panX <= view.width + margin
    && (rect.y + rect.height) * view.zoom + view.panY >= -margin && rect.y * view.zoom + view.panY <= view.height + margin;
}
function cableVisible(cable: CanvasCable, view: CanvasView): boolean {
  const h = Math.max(72, Math.abs(cable.to.x - cable.from.x) * 0.42);
  const left = Math.min(cable.from.x, cable.to.x - h), right = Math.max(cable.from.x + h, cable.to.x);
  return inView({ x: left, y: Math.min(cable.from.y, cable.to.y), width: right - left, height: Math.abs(cable.to.y - cable.from.y) }, view);
}
function begin(ctx: DrawContext, view: CanvasView) {
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(view.ratio * view.zoom, 0, 0, view.ratio * view.zoom, view.ratio * view.panX, view.ratio * view.panY);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.textBaseline = 'alphabetic';
}
function box(ctx: DrawContext, x: number, y: number, width: number, height: number, radius = 4) {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
}
function text(ctx: DrawContext, value: string, x: number, y: number, max: number, color: string, size = 10, weight = 400, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.textAlign = align; ctx.fillStyle = color;
  ctx.fillText(fitCanvasLabel(ctx, value, max), x, y);
}
/** Cables keep their screen width near 100% zoom and thin out in far overviews. */
function cableScreenScale(zoom: number) { return Math.min(1, 0.4 + zoom * 1.2); }

function drawCable(ctx: DrawContext, cable: CanvasCable, zoom: number, opacity?: number) {
  const { from, to } = cable, h = Math.max(72, Math.abs(to.x - from.x) * 0.42);
  const appearance = cable.appearance ?? 1;
  ctx.strokeStyle = cable.color; ctx.globalAlpha = (opacity ?? (cable.highlighted ? 1 : 0.55)) * (cable.disappearing ? appearance : 1);
  ctx.lineWidth = (cable.highlighted ? 2 : 1.25) * cableScreenScale(zoom) / zoom;
  ctx.setLineDash(cable.draft ? [5 / zoom, 4 / zoom] : cable.baked ? [4 / zoom, 4 / zoom] : []);
  ctx.beginPath(); ctx.moveTo(from.x, from.y);
  if (!cable.disappearing && appearance < 1) {
    const steps = Math.max(2, Math.ceil(appearance * 36));
    for (let index = 1; index <= steps; index++) {
      const point = cablePoint(from, to, appearance * index / steps);
      ctx.lineTo(point.x, point.y);
    }
  } else ctx.bezierCurveTo(from.x + h, from.y, to.x - h, to.y, to.x, to.y);
  ctx.stroke(); ctx.setLineDash([]);
  if (appearance < 1 && !cable.disappearing) { ctx.globalAlpha = 1; return; }
  const middle = cablePoint(from, to, 0.5), angle = Math.atan2(to.y - from.y, to.x - from.x - h);
  ctx.save(); ctx.translate(middle.x, middle.y); ctx.rotate(angle); ctx.lineWidth = 1.3 * cableScreenScale(zoom) / zoom;
  ctx.beginPath(); ctx.moveTo(-3 / zoom, -3 / zoom); ctx.lineTo(0, 0); ctx.lineTo(-3 / zoom, 3 / zoom); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
}
/**
 * Settled cables that share colour, opacity, width and dash become one path and
 * one stroke, instead of one stroke per cable and per arrow head. Cables that
 * are still drawing in keep their individual progressive path.
 */
function drawCables(ctx: DrawContext, cables: readonly CanvasCable[], zoom: number, opacity?: number) {
  const batches = new Map<string, { path: Path2D; color: string; alpha: number; width: number; dash: number[] }>();
  const batch = (color: string, alpha: number, width: number, dash: number[]) => {
    const key = `${color}|${alpha}|${width}|${dash.join(',')}`;
    let entry = batches.get(key);
    if (!entry) { entry = { path: new Path2D(), color, alpha, width, dash }; batches.set(key, entry); }
    return entry.path;
  };
  for (const cable of cables) {
    const appearance = cable.appearance ?? 1;
    if (!cable.disappearing && appearance < 1) { drawCable(ctx, cable, zoom, opacity); continue; }
    const { from, to } = cable, h = Math.max(72, Math.abs(to.x - from.x) * 0.42);
    const alpha = (opacity ?? (cable.highlighted ? 1 : 0.55)) * (cable.disappearing ? appearance : 1);
    const dash = cable.draft ? [5 / zoom, 4 / zoom] : cable.baked ? [4 / zoom, 4 / zoom] : [];
    const thin = cableScreenScale(zoom);
    const curve = batch(cable.color, alpha, (cable.highlighted ? 2 : 1.25) * thin / zoom, dash);
    curve.moveTo(from.x, from.y); curve.bezierCurveTo(from.x + h, from.y, to.x - h, to.y, to.x, to.y);
    const middle = cablePoint(from, to, 0.5), angle = Math.atan2(to.y - from.y, to.x - from.x - h);
    const cos = Math.cos(angle), sin = Math.sin(angle), size = 3 / zoom;
    const arrow = batch(cable.color, alpha, 1.3 * thin / zoom, []);
    arrow.moveTo(middle.x + (-size * cos + size * sin), middle.y + (-size * sin - size * cos));
    arrow.lineTo(middle.x, middle.y);
    arrow.lineTo(middle.x + (-size * cos - size * sin), middle.y + (-size * sin + size * cos));
  }
  for (const { path, color, alpha, width, dash } of batches.values()) {
    ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.lineWidth = width; ctx.setLineDash(dash); ctx.stroke(path);
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}
function curveShape(curve: CanvasCurve) {
  return curve.compactBadge ? { x: curve.x + 5, y: curve.y + 23, width: 108, height: 22 }
    : { x: curve.x + 4, y: curve.y + 22, width: curve.width - 8, height: 36 };
}
function drawCurve(ctx: DrawContext, curve: CanvasCurve, theme: CanvasTheme) {
  if (curve.compactBadge) {
    ctx.fillStyle = theme.background; box(ctx, curve.x, curve.y, curve.width, curve.height); ctx.fill();
    text(ctx, '◇ Animation', curve.x + 5, curve.y + 13, 100, '#ac95e5', 9);
    text(ctx, `${curve.channels} curves`, curve.x + curve.width - 5, curve.y + 13, 60, theme.muted, 9, 400, 'right');
  } else text(ctx, `${curve.keys.length} keys · ${curve.sourceTime ? 'source' : 'clip'} time`, curve.x + curve.width, curve.y + 12, 110, theme.muted, 8, 400, 'right');
  const r = curveShape(curve);
  ctx.strokeStyle = theme.border; ctx.lineWidth = 0.5;
  for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(r.x, r.y + i * r.height / 2); ctx.lineTo(r.x + r.width, r.y + i * r.height / 2); ctx.stroke(); }
  ctx.beginPath(); curve.points.forEach((value, i) => { const x = r.x + i / (curve.points.length - 1) * r.width, y = r.y + (1 - value) * r.height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
  ctx.strokeStyle = '#b698ee'; ctx.lineWidth = 1.5; ctx.stroke();
}

/** Static painting occurs only after edits, hover, selection, pan or resize. */
/** Worker-drawn group frames while a build-up animation owns the layout. */
function paintGroupFrames(ctx: DrawContext, scene: CanvasScene, view: CanvasView, theme: CanvasTheme) {
  for (const group of scene.groups) {
    if (!inView(group, view)) continue;
    box(ctx, group.x, group.y, group.width, group.height, 10);
    ctx.globalAlpha = 1; ctx.fillStyle = theme.background; ctx.fill();
    ctx.globalAlpha = 0.1; ctx.fillStyle = group.color; ctx.fill();
    ctx.globalAlpha = 0.6; ctx.strokeStyle = group.color; ctx.lineWidth = 1 / view.zoom; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function paintBase(ctx: DrawContext, scene: CanvasScene, view: CanvasView, theme: CanvasTheme, drawGroups = false,
  cardSprite?: (node: CanvasNode) => CanvasImageSource | undefined,
  shapeSprite?: (key: string, bounds: Rect, paint: (ctx: OffscreenCanvasRenderingContext2D) => void) => { canvas: OffscreenCanvas; level: number } | undefined) {
  begin(ctx, view);
  if (drawGroups) paintGroupFrames(ctx, scene, view, theme);
  const viewport = { x: -view.panX / view.zoom - 20, y: -view.panY / view.zoom - 20,
    width: view.width / view.zoom + 40, height: view.height / view.zoom + 40 };
  const clips = new Map<Rect[], Rect[]>();
  // Group backgrounds and headers stay in the DOM: their complete vector
  // bounds follow the immediate viewport even while this bitmap catches up.
  // Cables that pass behind the same groups share one clip per pass. Clipping
  // each cable separately dominated raster time on large expanded graphs.
  const occluded = new Map<Rect[], CanvasCable[]>(), open: CanvasCable[] = [];
  for (const cable of scene.cables) if (cableVisible(cable, view)) {
    if (!cable.occlusions?.length) { open.push(cable); continue; }
    const batch = occluded.get(cable.occlusions);
    if (batch) batch.push(cable); else occluded.set(cable.occlusions, [cable]);
  }
  drawCables(ctx, open, view.zoom);
  for (const [occlusions, cables] of occluded) {
    let visible = clips.get(occlusions);
    if (!visible) { visible = subtractOccludedRects(viewport, occlusions); clips.set(occlusions, visible); }
    ctx.save(); ctx.beginPath();
    for (const rect of visible) ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip(); drawCables(ctx, cables, view.zoom); ctx.restore();
    ctx.save(); ctx.beginPath();
    for (const rect of occlusions) ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip(); drawCables(ctx, cables, view.zoom, .3); ctx.restore();
  }
  for (const node of scene.nodes) {
    if (!inView(node, view)) continue;
    ctx.save(); ctx.translate(node.x, node.y);
    const appearance = node.appearance ?? 1;
    if (appearance < 1) {
      const scale = node.disappearing ? 0.94 + appearance * 0.06 : 0.88 + appearance * 0.12;
      ctx.translate(node.width / 2, node.height / 2); ctx.scale(scale, scale); ctx.translate(-node.width / 2, -node.height / 2);
    }
    ctx.globalAlpha = (node.bypassed ? 0.72 : 1) * appearance;
    const sprite = cardSprite?.(node);
    if (sprite) {
      ctx.drawImage(sprite, -CARD_SPRITE_PAD, -CARD_SPRITE_PAD, node.width + CARD_SPRITE_PAD * 2, node.height + CARD_SPRITE_PAD * 2);
      ctx.restore(); continue;
    }
    drawNodeCard(ctx, node, theme);
    ctx.restore();
  }
  // Long fan-out stubs first, so their backing stroke cannot cover shorter grips.
  for (const plug of scene.plugs.toReversed()) {
    if (!inView({ x: Math.min(plug.tip.x, plug.center.x) - 8, y: plug.center.y - 8, width: Math.abs(plug.tip.x - plug.center.x) + 16, height: 16 }, view)) continue;
    ctx.save(); ctx.translate(plug.center.x, plug.center.y); ctx.scale(plug.input ? -1 : 1, 1); ctx.globalAlpha = plug.ghost ? 0.5 : 1;
    const offset = Math.abs(plug.tip.x - plug.center.x);
    // Plugs repeat a handful of variants hundreds of times; blit a shared sprite.
    const bounds = { x: -9, y: -9, width: offset + 18, height: 18 };
    const sprite = shapeSprite?.(`plug|${plug.color}|${offset}|${plug.highlighted ? 1 : 0}|${theme.background}`, bounds,
      sprite => drawPlug(sprite, offset, plug.color, plug.highlighted, theme));
    if (sprite) ctx.drawImage(sprite.canvas, bounds.x, bounds.y, sprite.canvas.width / sprite.level, sprite.canvas.height / sprite.level);
    else drawPlug(ctx, offset, plug.color, plug.highlighted, theme);
    ctx.restore();
  }
}

function paintHoveredEdge(ctx: DrawContext, scene: CanvasScene, edgeId: string, view: CanvasView, theme: CanvasTheme) {
  const cable = scene.cables.find(item => item.id === edgeId);
  if (cable) drawCable(ctx, { ...cable, highlighted: true, appearance: 1, disappearing: false }, view.zoom, 1);
  for (const plug of scene.plugs) if (plug.id === `${edgeId}:input` || plug.id === `${edgeId}:output`) {
    ctx.save(); ctx.translate(plug.center.x, plug.center.y); ctx.scale(plug.input ? -1 : 1, 1);
    drawPlug(ctx, Math.abs(plug.tip.x - plug.center.x), plug.color, true, theme); ctx.restore();
  }
}

function drawPlug(ctx: DrawContext, offset: number, color: string, highlighted: boolean, theme: CanvasTheme) {
  ctx.beginPath(); ctx.arc(0, 0, 6, -Math.PI / 2, Math.PI / 2); ctx.moveTo(6, 0); ctx.lineTo(offset, 0);
  ctx.strokeStyle = theme.background; ctx.lineWidth = 5; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
  box(ctx, offset - 5, -3, 10, 6, 2); ctx.fillStyle = highlighted ? color : theme.background; ctx.fill(); ctx.lineWidth = 1; ctx.stroke();
}

/** A complete card at the context's current origin; shared by direct paint and sprites. */
export function drawNodeCard(ctx: DrawContext, node: CanvasNode, theme: CanvasTheme) {
    box(ctx, 0, 0, node.width, node.height, 6); ctx.fillStyle = theme.card; ctx.fill(); ctx.strokeStyle = node.selected ? theme.accent : theme.border;
    ctx.lineWidth = node.selected ? 2 : 1; ctx.stroke(); ctx.clip();
    ctx.fillStyle = node.color; ctx.fillRect(0, 0, node.width, 3);
    ctx.strokeStyle = theme.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 27); ctx.lineTo(node.width, 27); ctx.stroke();
    text(ctx, node.kind.toUpperCase(), 8, 19, 95, theme.muted);
    text(ctx, node.runtime, node.width - 28, 19, 50, theme.muted, 9, 400, 'right');
    text(ctx, '◉', node.width - 9, 19, 14, node.viewerEnabled ? theme.accent : theme.muted, 12, 400, 'right');
    if (node.bypassable) text(ctx, 'Byp', node.width - 84, 19, 25, node.bypassed ? theme.accent : theme.muted, 9);
    text(ctx, node.label, node.expandable ? 30 : 10, 46, node.width - (node.expandable ? 40 : 20), theme.text, 13, 600);
    text(ctx, node.description, 10, 63, node.width - 20, theme.muted, 10);
    let badgeX = 10;
    for (const badge of node.badges) {
      const color = badge.tone === 'ready' ? '#75d6b0' : badge.tone === 'empty' ? '#e79687' : '#dbbe75';
      ctx.font = '9px system-ui'; const width = ctx.measureText(badge.label).width + 10;
      box(ctx, badgeX, 83, width, 16); ctx.strokeStyle = color; ctx.lineWidth = 0.6; ctx.stroke(); text(ctx, badge.label, badgeX + 5, 94, width - 8, color, 9); badgeX += width + 4;
    }
    if (node.curve) drawCurve(ctx, node.curve, theme);
    if (node.mathSymbol) text(ctx, node.mathSymbol.text, node.mathSymbol.x, node.mathSymbol.y, 64, theme.muted, 26, 500, 'center');
    for (const port of node.ports) {
      ctx.fillStyle = port.color; ctx.beginPath(); ctx.arc(port.x, port.y, 3.5, 0, Math.PI * 2); ctx.fill();
      if (port.highlighted) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(port.x, port.y, 5, 0, Math.PI * 2); ctx.stroke(); }
      const x = port.x + (port.input ? 9 : -9), align = port.input ? 'left' : 'right';
      text(ctx, port.label, x, port.y + 1, 65, theme.text, 9, 500, align);
      text(ctx, port.type, x, port.y + 12, 65, port.color, 8, 400, align);
    }
}

export interface CurveActivity { playhead: number; values: number[]; until: number }
export function paintOverlay(ctx: DrawContext, scene: CanvasScene, view: CanvasView, theme: CanvasTheme, transport: CanvasTransport, now: number, activity: Map<string, CurveActivity>, flowSeconds = 0,
  hoveredEdgeId: string | null = null) {
  begin(ctx, view);
  if (hoveredEdgeId) paintHoveredEdge(ctx, scene, hoveredEdgeId, view, theme);
  if (!transport.visible) return;
  if (transport.active && !transport.reducedMotion) scene.cables.forEach((cable, i) => {
    if (cable.draft || cable.baked || !cableVisible(cable, view)) return;
    const duration = Math.max(1300, Math.min(3600, cableArcLengths(cable).length * view.zoom / 140 * 1000));
    for (let point = 0; point < 2; point++) {
      const p = signalPosition(cable, (flowSeconds * 1000 / duration + i * 0.61803398875 + point / 2) % 1);
      ctx.globalAlpha = pointBehindGroup(p, cable.occlusions ?? []) ? .3 : 1;
      ctx.fillStyle = cable.color; ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 / view.zoom, 0, Math.PI * 2); ctx.fill();
    }
  });
  ctx.globalAlpha = 1;
  for (const node of scene.nodes) {
    const curve = node.curve;
    if (!curve || !inView(node, view)) continue;
    const local = Math.max(0, Math.min(curve.duration, transport.playhead - curve.start));
    const time = curve.sourceTime ? transport.sourceTimes[curve.clipId] ?? local : local;
    const value = interpolateKeyframes(curve.keys, curve.property, time, curve.value);
    const r = curveShape(curve), x = r.x + local / Math.max(0.001, curve.duration) * r.width;
    ctx.save(); ctx.translate(node.x, node.y); ctx.globalAlpha = node.bypassed ? 0.72 : 1;
    if (curve.compactBadge) {
      let previous = activity.get(node.id);
      if (!previous || previous.playhead !== transport.playhead) {
        const values = curve.activityKeys.map(channel => interpolateKeyframes(channel.keys, channel.property,
          channel.sourceTime ? transport.sourceTimes[curve.clipId] ?? local : local, 0));
        const changed = previous && values.some((v, i) => Math.abs(v - previous!.values[i]) > 1e-6);
        previous = { playhead: transport.playhead, values, until: changed ? now + 180 : previous?.until ?? 0 };
        activity.set(node.id, previous);
      }
      if (transport.active && now < previous.until) {
        box(ctx, curve.x, curve.y, curve.width, curve.height); ctx.strokeStyle = '#ae90dc'; ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    ctx.strokeStyle = theme.accent; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, r.y - 3); ctx.lineTo(x, r.y + r.height + 3); ctx.stroke();
    text(ctx, String(Number(value.toFixed(3))), curve.compactBadge ? curve.x + curve.width - 5 : curve.x, curve.y + (curve.compactBadge ? 39 : 13),
      curve.compactBadge ? 42 : 55, '#ac95e5', curve.compactBadge ? 11 : 15, 600, curve.compactBadge ? 'right' : 'left'); ctx.restore();
  }
}
