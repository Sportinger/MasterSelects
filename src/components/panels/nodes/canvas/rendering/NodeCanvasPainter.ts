import type { CanvasMessage, CanvasScene, CanvasTheme, CanvasTransport, CanvasView } from './nodeCanvasTypes';
import { drawNodeCard, paintBase, paintOverlay, type DrawContext, type CurveActivity } from './paintNodeCanvas';
import { cardSignature, NodeCardSprites } from './nodeCardSprites';
import { NodeFlowClock } from './NodeFlowClock';
import { NodePreviewPainter } from '../../previews/NodePreviewPainter';
import { CanvasSceneVisibility } from './canvasSceneVisibility';
import { NodeSceneMotion } from './NodeSceneMotion';
import { applyNodeDrag, type CanvasNodeDrag } from './canvasNodeDrag';

/**
 * During build-up motion each group frame spans only its members that are
 * already visible, keeping the target padding, so frames grow and shrink with
 * their nodes instead of appearing at full size first.
 */
function growGroupFrames(target: CanvasScene, shown: CanvasScene): CanvasScene {
  if (!target.groups.length) return shown;
  const targetNodes = new Map(target.nodes.map(node => [node.id, node]));
  const shownNodes = new Map(shown.nodes.map(node => [node.id, node]));
  const groups: CanvasScene['groups'] = [];
  for (const group of target.groups) {
    if (!group.nodeIds?.length) { groups.push(group); continue; }
    let tl = Infinity, tt = Infinity, tr = -Infinity, tb = -Infinity;
    let sl = Infinity, st = Infinity, sr = -Infinity, sb = -Infinity;
    for (const id of group.nodeIds) {
      const goal = targetNodes.get(id), node = shownNodes.get(id);
      if (goal) { tl = Math.min(tl, goal.x); tt = Math.min(tt, goal.y); tr = Math.max(tr, goal.x + goal.width); tb = Math.max(tb, goal.y + goal.height); }
      if (node && (node.appearance ?? 1) > 0.02) {
        sl = Math.min(sl, node.x); st = Math.min(st, node.y); sr = Math.max(sr, node.x + node.width); sb = Math.max(sb, node.y + node.height);
      }
    }
    if (!Number.isFinite(sl)) continue;
    if (!Number.isFinite(tl)) { groups.push(group); continue; }
    const left = group.x - tl, top = group.y - tt, right = group.x + group.width - tr, bottom = group.y + group.height - tb;
    groups.push({ ...group, x: sl + left, y: st + top, width: sr - sl + right - left, height: sb - st + bottom - top });
  }
  return { ...shown, groups };
}

/** Shared worker/software renderer. Two viewport layers keep all static content cached. */
export class NodeCanvasPainter {
  private scene: CanvasScene | undefined;
  private visibleScene: CanvasScene | undefined;
  private visibility: CanvasSceneVisibility | undefined;
  private view: CanvasView | undefined;
  private theme: CanvasTheme | undefined;
  private transport: CanvasTransport = { playhead: 0, playing: false, active: false, visible: true, reducedMotion: false, sourceTimes: {} };
  private baseDirty = true;
  private overlayDirty = true;
  private renderedViewRevision: number | undefined;
  private curveActivity = new Map<string, CurveActivity>();
  private flowClock = new NodeFlowClock();
  private sceneMotion = new NodeSceneMotion();
  private base: DrawContext;
  private overlay: DrawContext;
  private previews?: NodePreviewPainter;
  private previewContext?: DrawContext;
  readonly timings = { baseMs: 0, overlayMs: 0, previewMs: 0 };
  private cards = new NodeCardSprites();
  private hoveredEdgeId: string | null = null;
  private drag: CanvasNodeDrag | undefined;
  private cardSignatures = new Map<string, string>();
  constructor(base: DrawContext, overlay: DrawContext, previews?: DrawContext, atlas?: () => DrawContext | null) {
    this.base = base; this.overlay = overlay; this.previewContext = previews;
    if (previews && atlas) this.previews = new NodePreviewPainter(previews, atlas);
  }
  update(message: Exclude<CanvasMessage, { type: 'init' | 'presented' }>) {
    if (message.type === 'previews') { this.previews?.receive(message.frames); return; }
    if (message.type === 'hover') { this.hoveredEdgeId = message.edgeId; this.overlayDirty = true; return; }
    if (message.type === 'drag') {
      this.drag = message.drag ?? undefined; this.visibleScene = undefined;
      this.baseDirty = true; this.overlayDirty = true; this.previews?.invalidate(); return;
    }
    if (message.type === 'scene') {
      this.sceneMotion.update(message.scene, performance.now());
      this.scene = message.scene; this.visibility = new CanvasSceneVisibility(message.scene); this.visibleScene = undefined; this.baseDirty = true;
      this.cardSignatures = new Map(message.scene.nodes.map(node => [node.id, cardSignature(node)]));
      this.cards.retain(new Set(this.cardSignatures.keys()));
      this.previews?.retain(new Set(this.scene.nodes.flatMap(node => node.preview ? [node.preview.key] : [])));
      const ids = new Set(this.scene.nodes.map(node => node.id));
      for (const id of this.curveActivity.keys()) if (!ids.has(id)) this.curveActivity.delete(id);
    }
    if (message.type === 'view') {
      this.view = message.view; this.theme = message.theme; this.visibleScene = undefined; this.baseDirty = true;
      this.renderedViewRevision = message.revision;
      this.previews?.resolution(message.view.zoom, message.view.ratio);
      this.previews?.invalidate();
      const width = Math.max(1, Math.round(message.view.width * message.view.ratio)), height = Math.max(1, Math.round(message.view.height * message.view.ratio));
      for (const ctx of [this.base, this.overlay, ...(this.previewContext ? [this.previewContext] : [])]) {
        if (ctx.canvas.width !== width) ctx.canvas.width = width;
        if (ctx.canvas.height !== height) ctx.canvas.height = height;
      }
    }
    if (message.type === 'transport') {
      this.transport = message.transport;
      this.flowClock.update(this.transport, performance.now());
    }
    this.overlayDirty = true;
  }
  get animated() { return this.transport.visible && !this.transport.reducedMotion && (this.transport.active || this.sceneMotion.active); }
  get viewRevision() { return this.renderedViewRevision; }
  get layoutMoving() { return this.sceneMotion.active; }
  get previewCount() { return this.previews?.size ?? 0; }
  takeEvictedPreviews() { return this.previews?.takeEvicted() ?? []; }
  get hasOverlay() { return !!this.hoveredEdgeId || (this.transport.visible && (this.animated || !!this.visibleScene?.nodes.some(node => node.curve))); }
  draw(now: number): boolean {
    if (!this.scene || !this.view || !this.theme) return false;
    const scene = this.visibleScene ??= this.withDrag(this.visibility?.visible(this.view) ?? this.scene);
    if (this.transport.reducedMotion) this.sceneMotion.clear();
    const moving = this.sceneMotion.active;
    const paintScene = moving ? growGroupFrames(scene, this.sceneMotion.frame(scene, now)) : scene;
    if (this.sceneMotion.active || paintScene !== scene) {
      this.baseDirty = true;
      this.previews?.invalidate();
    }
    const start = import.meta.env.DEV ? performance.now() : 0;
    if (this.baseDirty) {
      const view = this.view, theme = this.theme, pixelScale = view.zoom * view.ratio;
      paintBase(this.base, paintScene, view, theme, moving,
        node => this.cards.sprite(node, this.cardSignatures.get(node.id), pixelScale, theme, drawNodeCard),
        (key, bounds, paint) => this.cards.shape(key, bounds, pixelScale, paint));
      this.baseDirty = false;
    }
    const baseEnd = import.meta.env.DEV ? performance.now() : 0;
    if (this.overlayDirty || this.animated || (moving && this.hoveredEdgeId)) {
      paintOverlay(this.overlay, moving ? paintScene : scene, this.view, this.theme, this.transport, now, this.curveActivity, this.flowClock.advance(now), this.hoveredEdgeId);
      this.overlayDirty = false;
    }
    const overlayEnd = import.meta.env.DEV ? performance.now() : 0;
    this.previews?.draw(paintScene, this.view);
    if (import.meta.env.DEV) {
      this.timings.baseMs = baseEnd - start; this.timings.overlayMs = overlayEnd - baseEnd; this.timings.previewMs = performance.now() - overlayEnd;
    }
    return true;
  }
  private withDrag(visible: CanvasScene) { return this.drag && this.scene ? applyNodeDrag(visible, this.scene, this.drag) : visible; }
  dispose() { this.previews?.dispose(); this.cards.clear(); }
}
