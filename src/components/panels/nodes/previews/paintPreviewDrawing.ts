import type { PreviewDrawing } from '../../../../services/nodePreview/previewTypes';
import type { DrawContext } from '../canvas/rendering/paintNodeCanvas';

/** Bounded drawing data is rasterized once into the shared atlas, then reused during pan/zoom. */
export function paintPreviewDrawing(ctx: DrawContext, drawing: PreviewDrawing, width: number, height: number) {
  if (drawing.kind === 'text' || drawing.kind === 'number') return;
  ctx.strokeStyle = '#77c7e4'; ctx.fillStyle = '#a2d9e8'; ctx.lineWidth = 1;
  if (drawing.kind === 'material') {
    for (let y = 0; y < height; y += 12) for (let x = 0; x < width; x += 12) {
      ctx.fillStyle = (Math.floor(x / 12) + Math.floor(y / 12)) % 2 ? '#34383c' : '#1c2024'; ctx.fillRect(x, y, 12, 12);
    }
    ctx.globalAlpha = drawing.opacity;
    ctx.fillStyle = `rgb(${drawing.color.map(value => Math.round(Math.max(0, Math.min(1, value)) * 255)).join(' ')})`;
    ctx.beginPath(); ctx.arc(width / 2, height / 2, Math.min(width, height) * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    ctx.fillStyle = '#b6bfc5'; ctx.font = '10px system-ui'; ctx.fillText(drawing.textured ? 'Texture × tint' : 'Solid color', 6, height - 8);
  } else if (drawing.kind === 'plot') {
    const values = drawing.values.slice(0, 256);
    let min = 0, max = 1;
    if (drawing.bipolar) { min = Math.min(...values, -0.001); max = Math.max(...values, 0.001); }
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = index / Math.max(1, values.length - 1) * width;
      const y = height - 5 - (value - min) / Math.max(1e-6, max - min) * (height - 10);
      if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
    if (drawing.cursor !== undefined) {
      ctx.strokeStyle = '#e4c576'; ctx.beginPath(); ctx.moveTo(drawing.cursor * width, 0); ctx.lineTo(drawing.cursor * width, height); ctx.stroke();
    }
  } else if (drawing.kind === 'depth') {
    const { values, width: columns, height: rows } = drawing;
    if (columns * rows > 4096 || columns < 1 || rows < 1) return;
    let min = Infinity, max = -Infinity;
    for (const value of values) { min = Math.min(min, value); max = Math.max(max, value); }
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const value = Math.round(255 * (values[y * columns + x] - min) / Math.max(1e-6, max - min));
      ctx.fillStyle = `rgb(${value} ${value} ${value})`;
      ctx.fillRect(x * width / columns, y * height / rows, Math.ceil(width / columns), Math.ceil(height / rows));
    }
  } else {
    const points: Array<[number, number]> = [], dimension = drawing.dimensions;
    for (let i = 0; i < Math.min(drawing.points.length, 9000); i += dimension) {
      const x = drawing.points[i], y = drawing.points[i + 1], z = dimension === 3 ? drawing.points[i + 2] : 0;
      points.push(dimension === 3 ? [x * 0.92 + z * 0.38, -y * 0.94 + z * 0.25] : [x, y]);
    }
    let left = dimension === 2 ? 0 : Infinity, top = dimension === 2 ? 0 : Infinity;
    let right = dimension === 2 ? 1 : -Infinity, bottom = dimension === 2 ? 1 : -Infinity;
    for (const [x, y] of points) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    const scale = Math.min((width - 12) / Math.max(0.001, right - left), (height - 12) / Math.max(0.001, bottom - top));
    const screen = points.map(([x, y]) => dimension === 2 ? [x * width, y * height] : [width / 2 + (x - (left + right) / 2) * scale, height / 2 + (y - (top + bottom) / 2) * scale]);
    if (drawing.edges?.length) {
      ctx.beginPath();
      for (let i = 0; i < Math.min(12000, drawing.edges.length); i += 2) {
        const a = screen[drawing.edges[i]], b = screen[drawing.edges[i + 1]];
        if (a && b) { ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      }
      ctx.stroke();
    } else for (const [x, y] of screen) ctx.fillRect(x - 1, y - 1, 2, 2);
  }
}
