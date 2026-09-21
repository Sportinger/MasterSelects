import type { PreviewFrame, PreviewValueControl } from '../../../../services/nodePreview/previewTypes';
import type { CanvasNode, Rect } from '../canvas/rendering/nodeCanvasTypes';
import type { DrawContext } from '../canvas/rendering/paintNodeCanvas';

function valueText(value: number | boolean | string | undefined) {
  return typeof value === 'number' ? String(Number(value.toFixed(4))) : value === undefined ? '—' : String(value);
}
function controlText(control: PreviewValueControl) {
  return control.options?.find(option => option.value === control.value)?.label ?? valueText(control.value);
}
function text(ctx: DrawContext, value: string, x: number, y: number, width: number, size = 10, color = '#ddd', align: CanvasTextAlign = 'left') {
  ctx.font = `500 ${size}px system-ui`; ctx.textBaseline = 'top'; ctx.textAlign = align; ctx.fillStyle = color;
  ctx.fillText(value, x, y, width);
}

/** Native-resolution glyphs on the preview layer, never rasterized into image tiles. */
export function paintNodeValues(ctx: DrawContext, node: CanvasNode, frame: PreviewFrame, rect: Rect) {
  ctx.save();
  ctx.beginPath(); ctx.rect(node.x, node.y, node.width, node.height); ctx.clip();
  if (node.preview?.text) {
    const controls = frame.controls?.filter(control => control.portId) ?? [];
    const editable = new Set(controls.map(control => `${control.direction ?? 'input'}:${control.portId}`));
    const entries = [
      ...controls.map(control => ({ portId: control.portId!, direction: control.direction ?? 'input', value: controlText(control), label: control.label, editable: true })),
      ...(frame.values ?? []).filter(value => !editable.has(`${value.direction}:${value.portId}`))
        .map(value => ({ ...value, value: valueText(value.value), label: '', editable: false })),
    ];
    for (const entry of entries) {
      const port = node.ports.find(port => port.id === entry.portId && port.input === (entry.direction === 'input'));
      if (!port) continue;
      const beside = node.valueBesideOutput && entry.direction === 'output';
      const x = node.x + (beside ? port.x - 102 : entry.direction === 'output' ? 99 : 16), y = node.y + port.y + (beside ? -13 : 12);
      if (entry.editable) {
        ctx.strokeStyle = '#383838'; ctx.lineWidth = 1; ctx.strokeRect(x, y, 70, 26);
        if (!beside) text(ctx, entry.label, x + 70, y + 26, 70, 8, '#999', 'right');
      }
      text(ctx, entry.value, x + 67, y + 2, 64, 18, entry.editable ? '#a2d9e8' : '#ddd', 'right');
    }
    // Preserve the provenance of sampled values, including per-pixel samples.
    text(ctx, frame.label, rect.x + 4, rect.y + rect.height - 13, rect.width - 8, 8, '#999');
  } else {
    ctx.fillStyle = '#171717'; ctx.fillRect(rect.x, rect.y + 17, rect.width, rect.height - 17);
    const drawing = frame.drawing, controls = frame.controls ?? [], large = drawing?.kind === 'number';
    const x = rect.x + 4, width = rect.width - 8, top = rect.y + 21, bottom = rect.y + rect.height - 18;
    ctx.save(); ctx.beginPath(); ctx.rect(x, top, width, Math.max(0, bottom - top)); ctx.clip();
    if (large) {
      const entries = controls.length ? controls.map(control => ({ value: controlText(control), caption: control.label }))
        : [{ value: drawing.value, caption: drawing.caption }];
      let y = Math.max(top, (top + bottom - entries.length * 44 - (drawing.details?.length ?? 0) * 12) / 2);
      for (const entry of entries) {
        text(ctx, entry.value, x + width / 2, y, width, 28, controls.length ? '#a2d9e8' : '#ddd', 'center');
        text(ctx, entry.caption, x + width / 2, y + 32, width, 10, '#999', 'center'); y += 44;
      }
      for (const line of drawing.details ?? []) { text(ctx, line, x, y, width, 9); y += 12; }
    } else if (controls.length) {
      controls.forEach((control, index) => {
        text(ctx, control.label, x, top + index * 22 + 5, width * 0.52);
        text(ctx, controlText(control), x + width, top + index * 22 + 5, width * 0.46, 10, '#a2d9e8', 'right');
      });
    } else if (drawing?.kind === 'text') {
      drawing.lines.forEach((line, index) => text(ctx, line, x, top + index * 14, width));
    }
    ctx.restore();
    text(ctx, node.preview?.label ?? 'Values', x, rect.y + 3, width, 9, '#b6bfc5');
    text(ctx, frame.label, x, bottom + 4, width, 8, '#999');
  }
  ctx.restore();
}
