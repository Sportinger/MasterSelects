import type { PreviewFrame } from '../../../../services/nodePreview/previewTypes';
import { releasePreviewFrame } from '../../../../services/nodePreview/previewTypes';
import type { CanvasScene, CanvasView, Rect } from '../canvas/rendering/nodeCanvasTypes';
import type { DrawContext } from '../canvas/rendering/paintNodeCanvas';
import { paintPreviewDrawing } from './paintPreviewDrawing';
import { previewAtlasTile } from './previewGeometry';
import { paintNodeValues } from './paintNodeValues';

const ATLAS_WIDTH = 2048, ATLAS_HEIGHT = 4096;
interface Slot { index: number; label: string; status: PreviewFrame['status']; revision: string; used: number; content: Rect }
export function previewInView(rect: Rect, view: CanvasView, margin = 24) {
  return (rect.x + rect.width) * view.zoom + view.panX >= -margin && rect.x * view.zoom + view.panX <= view.width + margin
    && (rect.y + rect.height) * view.zoom + view.panY >= -margin && rect.y * view.zoom + view.panY <= view.height + margin;
}

/** Fixed 32 MiB ceiling; smaller zoom levels pack up to 2048 thumbnails into the same atlas. */
export class NodePreviewPainter {
  private slots = new Map<string, Slot>();
  private dirty = new Set<string>();
  private allDirty = true;
  private atlas?: DrawContext;
  private sequence = 0;
  private tile = 256;
  private keys?: Set<string>;
  private values = new Map<string, PreviewFrame>();
  private get columns() { return ATLAS_WIDTH / this.tile; }
  private get capacity() { return ATLAS_WIDTH * ATLAS_HEIGHT / (this.tile * this.tile); }
  resolution(zoom: number, ratio: number) {
    const tile = previewAtlasTile(zoom, ratio);
    if (tile === this.tile) return;
    // Never downsample a populated cache on zoom-out: repeated zoom cycles
    // must not progressively blur the original pixels.
    if (this.atlas && tile < this.tile) return;
    // A zoom must not evict still-cached viewers just to enlarge their tiles.
    if (this.atlas && this.slots.size > ATLAS_WIDTH * ATLAS_HEIGHT / (tile * tile)) return;
    const previous = this.atlas, oldTile = this.tile, oldColumns = this.columns;
    // Repack cached pixels when the zoom tier changes; never blank every viewer
    // or trigger source/GPU readbacks just to resize thumbnails.
    const next = previous ? this.createAtlas() : null;
    if (previous && !next) return;
    this.tile = tile;
    if (previous && next) {
      next.canvas.width = ATLAS_WIDTH; next.canvas.height = ATLAS_HEIGHT;
      const retained = [...this.slots.entries()].toSorted((a, b) => b[1].used - a[1].used).slice(0, this.capacity);
      this.slots.clear();
      retained.forEach(([key, slot], index) => {
        next.drawImage(previous.canvas, slot.index % oldColumns * oldTile, Math.floor(slot.index / oldColumns) * oldTile, oldTile, oldTile,
          index % this.columns * tile, Math.floor(index / this.columns) * tile, tile, tile);
        const scale = tile / oldTile, content = slot.content;
        this.slots.set(key, { ...slot, index, content: { x: content.x * scale, y: content.y * scale, width: content.width * scale, height: content.height * scale } });
      });
      this.atlas = next; previous.canvas.width = 1; previous.canvas.height = 1;
    }
    this.invalidate();
  }
  private context: DrawContext;
  private createAtlas: () => DrawContext | null;
  constructor(context: DrawContext, createAtlas: () => DrawContext | null) { this.context = context; this.createAtlas = createAtlas; }

  receive(frames: PreviewFrame[]) {
    for (const frame of frames) {
      try {
        if (this.keys && !this.keys.has(frame.key)) continue;
        const { bitmap: _bitmap, ...plain } = frame;
        if (frame.values || frame.controls || frame.presentation === 'text' || frame.drawing?.kind === 'text' || frame.drawing?.kind === 'number') this.values.set(frame.key, plain);
        else this.values.delete(frame.key);
        if (frame.presentation === 'text' || frame.drawing?.kind === 'text' || frame.drawing?.kind === 'number') {
          this.slots.delete(frame.key); this.dirty.add(frame.key); continue;
        }
        if (!this.atlas) {
          this.atlas = this.createAtlas() ?? undefined;
          if (this.atlas) { this.atlas.canvas.width = ATLAS_WIDTH; this.atlas.canvas.height = ATLAS_HEIGHT; }
        }
        if (!this.atlas) continue;
        let slot = this.slots.get(frame.key);
        if (!slot) {
          const occupied = new Set([...this.slots.values()].map(value => value.index));
          let index = 0; while (occupied.has(index)) index++;
          if (index >= this.capacity) {
            const oldest = [...this.slots.entries()].toSorted((a, b) => a[1].used - b[1].used)[0];
            index = oldest[1].index; this.slots.delete(oldest[0]); this.dirty.add(oldest[0]);
          }
          slot = { index, label: '', status: 'missing', revision: '', used: 0, content: { x: 0, y: 0, width: this.tile, height: this.tile } }; this.slots.set(frame.key, slot);
        }
        if (!frame.bitmap && !frame.drawing && slot.status !== 'missing' && slot.status !== 'error') {
          slot.label = frame.label; slot.status = 'stale'; this.dirty.add(frame.key); continue;
        }
        const ctx = this.atlas, x = slot.index % this.columns * this.tile, y = Math.floor(slot.index / this.columns) * this.tile;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, x, y);
        ctx.beginPath(); ctx.rect(0, 0, this.tile, this.tile); ctx.clip();
        ctx.fillStyle = '#101214'; ctx.fillRect(0, 0, this.tile, this.tile);
        const ratio = frame.bitmap ? frame.bitmap.width / frame.bitmap.height : frame.aspectRatio ?? 16 / 9;
        const contentWidth = Math.min(this.tile, this.tile * ratio), contentHeight = contentWidth / ratio;
        slot.content = { x: (this.tile - contentWidth) / 2, y: (this.tile - contentHeight) / 2, width: contentWidth, height: contentHeight };
        if (frame.bitmap) {
          const scale = Math.min(this.tile / frame.bitmap.width, this.tile / frame.bitmap.height);
          const width = frame.bitmap.width * scale, height = frame.bitmap.height * scale;
          ctx.drawImage(frame.bitmap, (this.tile - width) / 2, (this.tile - height) / 2, width, height);
        }
        if (frame.drawing) { ctx.translate(slot.content.x, slot.content.y); paintPreviewDrawing(ctx, frame.drawing, slot.content.width, slot.content.height); }
        ctx.restore();
        Object.assign(slot, { label: frame.label, status: frame.status, revision: frame.revision, used: ++this.sequence });
        this.dirty.add(frame.key);
      } finally { releasePreviewFrame(frame); }
    }
  }

  invalidate() { this.allDirty = true; }
  retain(keys: Set<string>) {
    this.keys = keys;
    for (const key of this.slots.keys()) if (!keys.has(key)) this.slots.delete(key);
    for (const key of this.values.keys()) if (!keys.has(key)) this.values.delete(key);
    this.allDirty = true;
    if (!keys.size) this.disposeAtlas();
  }
  private disposeAtlas() {
    if (this.atlas) { this.atlas.canvas.width = 1; this.atlas.canvas.height = 1; this.atlas = undefined; }
    this.slots.clear();
  }
  dispose() { this.disposeAtlas(); this.dirty.clear(); this.values.clear(); }
  get size() { return this.slots.size; }

  draw(scene: CanvasScene, view: CanvasView) {
    if (!this.allDirty && !this.dirty.size) return;
    const ctx = this.context;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.allDirty) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.setTransform(view.ratio * view.zoom, 0, 0, view.ratio * view.zoom, view.ratio * view.panX, view.ratio * view.panY);
    for (const node of scene.nodes) {
      const preview = node.preview;
      if (!preview || node.disappearing) continue;
      const rect = { ...preview, x: node.x + preview.x, y: node.y + preview.y };
      const bounds = preview.text ? node : rect;
      if (!previewInView(bounds, view) || (!this.allDirty && !this.dirty.has(preview.key))) continue;
      const slot = this.slots.get(preview.key);
      const values = this.values.get(preview.key);
      ctx.clearRect(bounds.x - 1, bounds.y - 1, bounds.width + 2, bounds.height + 2);
      ctx.save(); ctx.globalAlpha = node.appearance ?? 1;
      if (preview.text || values?.presentation === 'text' || values?.drawing?.kind === 'text' || values?.drawing?.kind === 'number') {
        if (values) paintNodeValues(ctx, node, values, rect);
        ctx.restore();
        continue;
      }
      ctx.fillStyle = '#101214'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      if (slot && this.atlas) {
        const content = slot.content, scale = Math.min(rect.width / content.width, (rect.height - 32) / content.height);
        const width = content.width * scale, height = content.height * scale;
        ctx.drawImage(this.atlas.canvas, slot.index % this.columns * this.tile + content.x, Math.floor(slot.index / this.columns) * this.tile + content.y,
          content.width, content.height, rect.x + (rect.width - width) / 2, rect.y + 16 + (rect.height - 32 - height) / 2, width, height);
        slot.used = ++this.sequence;
      }
      ctx.font = '9px system-ui'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.fillStyle = '#b6bfc5'; ctx.fillText(preview.label, rect.x + 4, rect.y + 3, rect.width - 12);
      ctx.fillStyle = slot?.status === 'stale' || slot?.status === 'error' ? '#dbb270' : '#87939b';
      ctx.fillText(slot?.label ?? 'Waiting for preview', rect.x + 4, rect.y + rect.height - 13, rect.width - 8);
      ctx.restore();
    }
    this.allDirty = false; this.dirty.clear();
  }
}
