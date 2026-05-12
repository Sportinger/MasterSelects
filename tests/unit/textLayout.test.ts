import { describe, expect, it } from 'vitest';
import {
  createTextLayoutSnapshot,
  createTextBoundsFromRect,
  resolveTextBoxRect,
  wrapTextToShapeLines,
  wrapTextToLines,
} from '../../src/services/textLayout';

const mockMeasureContext = {
  measureText: (text: string) => ({ width: text.length * 10 }),
} as CanvasRenderingContext2D;

describe('textLayout', () => {
  it('resolves default area text boxes centered in the canvas', () => {
    const box = resolveTextBoxRect({}, 1000, 500);

    expect(box.width).toBeCloseTo(620);
    expect(box.height).toBeCloseTo(140);
    expect(box.x).toBeCloseTo(190);
    expect(box.y).toBeCloseTo(180);
  });

  it('clamps explicit area text boxes to the canvas', () => {
    const box = resolveTextBoxRect({
      boxX: 980,
      boxY: 490,
      boxWidth: 500,
      boxHeight: 500,
    }, 1000, 500);

    expect(box.x).toBe(976);
    expect(box.y).toBe(476);
    expect(box.width).toBe(24);
    expect(box.height).toBe(24);
  });

  it('wraps paragraph text while preserving hard line breaks', () => {
    const lines = wrapTextToLines(mockMeasureContext, 'one two three\nfour', 70, 0);

    expect(lines).toEqual(['one two', 'three', 'four']);
  });

  it('breaks long words that exceed the box width', () => {
    const lines = wrapTextToLines(mockMeasureContext, 'abcdefghij', 35, 0);

    expect(lines).toEqual(['abc', 'def', 'ghi', 'j']);
  });

  it('wraps lines against the available width inside slanted text bounds', () => {
    const bounds = createTextBoundsFromRect({ x: 0, y: 0, width: 100, height: 120 }, 100, 120);
    bounds.vertices[0].x = 0.4;
    bounds.vertices[3].x = 0;

    const lines = wrapTextToShapeLines(
      mockMeasureContext,
      'aaaa bb cc',
      bounds,
      { x: 0, y: 0, width: 100, height: 120 },
      100,
      120,
      20,
      1,
      0,
      20,
    );

    expect(lines.map(line => line.text)).toEqual(['aaaa', 'bb cc']);
    expect(lines[0].width).toBeLessThan(lines[1].width);
  });

  it('creates a text layout snapshot with line bounds and source character ranges', () => {
    const snapshot = createTextLayoutSnapshot(
      mockMeasureContext,
      {
        text: 'one two three\nfour',
        fontFamily: 'Inter',
        fontSize: 20,
        fontWeight: 400,
        fontStyle: 'normal',
        color: '#ffffff',
        textAlign: 'left',
        verticalAlign: 'top',
        lineHeight: 1.2,
        letterSpacing: 0,
        strokeEnabled: false,
        strokeColor: '#000000',
        strokeWidth: 0,
        shadowEnabled: false,
        shadowColor: '#000000',
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowBlur: 0,
        pathEnabled: false,
        pathPoints: [],
      },
      400,
      200,
    );

    expect(snapshot.lineHeightPx).toBeCloseTo(24);
    expect(snapshot.contentBounds).toEqual({ x: 50, y: 0, width: 130, height: 48 });
    expect(snapshot.lines.map((line) => [line.text, line.start, line.end, line.left])).toEqual([
      ['one two three', 0, 13, 50],
      ['four', 14, 18, 50],
    ]);
    expect(snapshot.characters).toHaveLength(17);
    expect(snapshot.characters[0]).toMatchObject({
      index: 0,
      lineIndex: 0,
      char: 'o',
      left: 50,
      right: 60,
      top: 0,
      rect: [50, 0, 10, 24],
    });
    expect(snapshot.characters[13]).toMatchObject({
      index: 14,
      lineIndex: 1,
      char: 'f',
      left: 50,
      right: 60,
      top: 24,
    });
  });
});
