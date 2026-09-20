import type { CanvasMessage, CanvasScene, CanvasTheme, CanvasTransport, CanvasView } from './nodeCanvasTypes';
import { paintBase, paintOverlay, type DrawContext, type CurveActivity } from './paintNodeCanvas';
import { NodeFlowClock } from './NodeFlowClock';

/** Shared worker/software renderer. Two viewport layers keep all static content cached. */
export class NodeCanvasPainter {
  private scene: CanvasScene | undefined;
  private view: CanvasView | undefined;
  private theme: CanvasTheme | undefined;
  private transport: CanvasTransport = { playhead: 0, playing: false, active: false, visible: true, reducedMotion: false, sourceTimes: {} };
  private baseDirty = true;
  private overlayDirty = true;
  private curveActivity = new Map<string, CurveActivity>();
  private flowClock = new NodeFlowClock();
  private base: DrawContext;
  private overlay: DrawContext;
  constructor(base: DrawContext, overlay: DrawContext) { this.base = base; this.overlay = overlay; }
  update(message: Exclude<CanvasMessage, { type: 'init' }>) {
    if (message.type === 'scene') {
      this.scene = message.scene; this.baseDirty = true;
      const ids = new Set(this.scene.nodes.map(node => node.id));
      for (const id of this.curveActivity.keys()) if (!ids.has(id)) this.curveActivity.delete(id);
    }
    if (message.type === 'view') {
      this.view = message.view; this.theme = message.theme; this.baseDirty = true;
      const width = Math.max(1, Math.round(message.view.width * message.view.ratio)), height = Math.max(1, Math.round(message.view.height * message.view.ratio));
      for (const ctx of [this.base, this.overlay]) {
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
  get animated() { return this.transport.visible && this.transport.active && !this.transport.reducedMotion; }
  draw(now: number): boolean {
    if (!this.scene || !this.view || !this.theme) return false;
    if (this.baseDirty) { paintBase(this.base, this.scene, this.view, this.theme); this.baseDirty = false; }
    if (this.overlayDirty || this.animated) { paintOverlay(this.overlay, this.scene, this.view, this.theme, this.transport, now, this.curveActivity, this.flowClock.advance(now)); this.overlayDirty = false; }
    return true;
  }
}
