import { expect, it, vi } from 'vitest';
import { fitCanvasLabel, PORT_LABEL_WIDTH, portTextRoom, wrapCanvasLabel } from '../../src/components/panels/nodes/canvas/rendering/canvasTextLayout';

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
it('wraps overview titles at separators and rejects words or line counts that do not fit', () => {
  const ctx = context();
  expect(wrapCanvasLabel(ctx, 'pixel-particle-disintegrate', 65, 3)).toEqual(['pixel-', 'particle-', 'disintegrate']);
  expect(wrapCanvasLabel(ctx, 'kinetic trace', 70, 2)).toEqual(['kinetic trace']);
  expect(wrapCanvasLabel(ctx, 'kinetic trace', 40, 2)).toEqual(['kinetic', 'trace']);
  expect(wrapCanvasLabel(ctx, 'kinetic trace', 40, 1)).toBeUndefined();
  expect(wrapCanvasLabel(ctx, 'temperature', 40, 3)).toBeUndefined();
});
it('gives a long port label the room a short or missing opposite label leaves, and two long ones half a card each', () => {
  const ctx = context(), font = '500 9px system-ui', port = (label: string, input: boolean, y = 40) => ({ label, input, y, type: 'Number' });
  // 15 characters at 5 px = 75 px: more than the default half card.
  const long = port('Brightness Only', true);
  expect(portTextRoom(ctx, font, 184, [long], long, 'label')).toBe(184 - 28);
  const short = port('Step Input', false);
  expect(portTextRoom(ctx, font, 184, [long, short], long, 'label')).toBe(184 - 28 - 50);
  expect(portTextRoom(ctx, font, 184, [long, short], short, 'label')).toBe(PORT_LABEL_WIDTH);
  const otherLong = port('Posterized Colour', false);
  expect(portTextRoom(ctx, font, 184, [long, otherLong], long, 'label')).toBe(PORT_LABEL_WIDTH);
  // A port on another row does not count.
  expect(portTextRoom(ctx, font, 184, [long, port('Posterized Colour', false, 64)], long, 'label')).toBe(184 - 28);
  expect(fitCanvasLabel(ctx, long.label, portTextRoom(ctx, font, 184, [long, short], long, 'label'))).toBe('Brightness Only');
});
