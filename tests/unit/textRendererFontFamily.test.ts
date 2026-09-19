import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { TextClipProperties } from '../../src/types/text';
import { getCanvasContentBounds } from '../../src/services/canvasContentBounds';

vi.unmock('../../src/services/textRenderer');

const fontMocks = vi.hoisted(() => ({
  isFontLoaded: vi.fn(() => false),
  loadFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/services/googleFontsService', () => ({
  googleFontsService: fontMocks,
}));

const context = {
  clearRect: vi.fn(),
  fillText: vi.fn(),
  strokeText: vi.fn(),
  measureText: vi.fn(() => ({
    width: 100,
    actualBoundingBoxLeft: 0,
    actualBoundingBoxRight: 100,
    actualBoundingBoxAscent: 32,
    actualBoundingBoxDescent: 8,
  })),
  save: vi.fn(),
  restore: vi.fn(),
  font: '',
  textAlign: 'left',
  textBaseline: 'alphabetic',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  lineJoin: 'miter',
  lineCap: 'butt',
  shadowColor: 'transparent',
  shadowBlur: 0,
  shadowOffsetX: 0,
  shadowOffsetY: 0,
} as unknown as CanvasRenderingContext2D;

let textRenderer: typeof import('../../src/services/textRenderer')['textRenderer'];

beforeAll(async () => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  ({ textRenderer } = await import('../../src/services/textRenderer'));
});

function properties(fontFamily: string): TextClipProperties {
  return {
    text: 'ANALYSING TERRAIN',
    fontFamily,
    fontSize: 42,
    fontWeight: 700,
    fontStyle: 'normal',
    color: '#d9f5ff',
    textAlign: 'left',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    boxEnabled: false,
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
  };
}

describe('text renderer font family CSS', () => {
  it('keeps CSS generic families unquoted and does not request a web font', () => {
    textRenderer.render(properties('monospace'));

    expect(context.font).toBe('normal 700 42px monospace');
    expect(fontMocks.isFontLoaded).not.toHaveBeenCalled();
    expect(fontMocks.loadFont).not.toHaveBeenCalled();
  });

  it('quotes named families and retains web-font loading', () => {
    textRenderer.render(properties('Roboto Mono'));

    expect(context.font).toBe('normal 700 42px "Roboto Mono"');
    expect(fontMocks.isFontLoaded).toHaveBeenCalledWith('Roboto Mono', 700);
    expect(fontMocks.loadFont).toHaveBeenCalledWith('Roboto Mono', 700);
  });

  it('records tight runtime bounds for transparent text canvases', () => {
    const canvas = textRenderer.createCanvas(1000, 500);
    textRenderer.render(properties('monospace'), canvas);

    const bounds = getCanvasContentBounds(canvas);
    expect(bounds).toBeDefined();
    expect(bounds?.x).toBeCloseTo(0.048, 3);
    expect(bounds?.width).toBeCloseTo(0.104, 3);
    expect(bounds?.height).toBeCloseTo(0.088, 3);
  });
});
