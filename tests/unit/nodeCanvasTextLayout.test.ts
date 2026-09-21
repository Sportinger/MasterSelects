import { expect, it, vi } from 'vitest';
import { fitCanvasLabel } from '../../src/components/panels/nodes/canvas/rendering/canvasTextLayout';

function context() {
  return { font: '10px system-ui', measureText: vi.fn((text: string) => ({ width: text.length * 5 } as TextMetrics)) };
}
it('reuses identical clipping across pan frames while retaining exact labels and ellipsis', () => {
  const ctx = context();
  expect(fitCanvasLabel(ctx, 'Long description', 25)).toBe('Long…');
  const measured = ctx.measureText.mock.calls.length;
  for (let frame = 0; frame < 120; frame++) expect(fitCanvasLabel(ctx, 'Long description', 25)).toBe('Long…');
  expect(ctx.measureText).toHaveBeenCalledTimes(measured);
  expect(fitCanvasLabel(ctx, 'short', 25)).toBe('short');
  expect(fitCanvasLabel(ctx, '', 25)).toBe('');
  expect(fitCanvasLabel(ctx, 'Long description', 100)).toBe('Long description');
});
it('separates contexts and font metrics, and bounds retained dynamic labels', () => {
  const ctx = context();
  fitCanvasLabel(ctx, 'Label', 20);
  ctx.font = 'bold 20px system-ui';
  ctx.measureText.mockImplementation(text => ({ width: text.length * 10 } as TextMetrics));
  expect(fitCanvasLabel(ctx, 'Label', 20)).toBe('L…');
  expect(fitCanvasLabel(context(), 'Label', 20)).toBe('Lab…');
  for (let i = 0; i < 4100; i++) fitCanvasLabel(ctx, String(i), 100);
  ctx.measureText.mockClear();
  fitCanvasLabel(ctx, 'Label', 20);
  expect(ctx.measureText).toHaveBeenCalled();
});
