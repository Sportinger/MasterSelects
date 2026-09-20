import type { CanvasMessage, CanvasScene, CanvasTheme, CanvasTransport, CanvasView } from './nodeCanvasTypes';
import { paintBase, paintOverlay, type DrawContext, type CurveActivity } from './paintNodeCanvas';
import { NodeFlowClock } from './NodeFlowClock';
import { NodePreviewPainter } from '../../previews/NodePreviewPainter';

/** Shared worker/software renderer. Two viewport layers keep all static content cached. */
export class NodeCanvasPainter {
  private scene: CanvasScene | undefined;
  private view: CanvasView | undefined;
  private theme: CanvasTheme | undefined;
  private transport: CanvasTransport = { playhead: 0, playing: false, active: false, visible: true, reducedMotion: false, sourceTimes: {} };
  private baseDirty = true;
  private overlayDirty = true;
  private renderedViewRevision: number | undefined;
  private curveActivity = new Map<string, CurveActivity>();
  private flowClock = new NodeFlowClock();
  private base: DrawContext;
  private overlay: DrawContext;
  private previews?: NodePreviewPainter;
  private previewContext?: DrawContext;
  constructor(base: DrawContext, overlay: DrawContext, previews?: DrawContext, atlas?: () => DrawContext | null) {
    this.base = base; this.overlay = overlay; this.previewContext = previews;
    if (previews && atlas) this.previews = new NodePreviewPainter(previews, atlas);
  }
  update(message: Exclude<CanvasMessage, { type: 'init' }>) {
    if (message.type === 'previews') { this.previews?.receive(message.frames); return; }
    if (message.type === 'scene') {
      this.scene = message.scene; this.baseDirty = true;
      this.previews?.retain(new Set(this.scene.nodes.flatMap(node => node.preview ? [node.preview.key] : [])));
      const ids = new Set(this.scene.nodes.map(node => node.id));
      for (const id of this.curveActivity.keys()) if (!ids.has(id)) this.curveActivity.delete(id);
    }
    if (message.type === 'view') {
      this.view = message.view; this.theme = message.theme; this.baseDirty = true;
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
  get animated() { return this.transport.visible && this.transport.active && !this.transport.reducedMotion; }
  get viewRevision() { return this.renderedViewRevision; }
  get previewCount() { return this.previews?.size ?? 0; }
  draw(now: number): boolean {
    if (!this.scene || !this.view || !this.theme) return false;
    if (this.baseDirty) { paintBase(this.base, this.scene, this.view, this.theme); this.baseDirty = false; }
    if (this.overlayDirty || this.animated) { paintOverlay(this.overlay, this.scene, this.view, this.theme, this.transport, now, this.curveActivity, this.flowClock.advance(now)); this.overlayDirty = false; }
    this.previews?.draw(this.scene, this.view);
    return true;
  }
  dispose() { this.previews?.dispose(); }
}
