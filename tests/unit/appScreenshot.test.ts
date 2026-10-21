import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleCaptureAppScreenshot,
  resolveAppScreenshotGeometry,
} from '../../src/services/aiTools/appScreenshot';
import { AI_TOOLS } from '../../src/services/aiTools/definitions';
import { getRegisteredToolHandlerNames } from '../../src/services/aiTools/handlers';
import { checkToolAccess, getToolPolicy } from '../../src/services/aiTools/policy';

const { domToPng, requestRender } = vi.hoisted(() => ({ domToPng: vi.fn(), requestRender: vi.fn() }));

vi.mock('modern-screenshot', () => ({ domToPng }));
vi.mock('../../src/services/render/renderHostPort', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/render/renderHostPort')>();
  return {
    ...actual,
    renderHostPort: new Proxy(actual.renderHostPort, {
      get: (target, key) => key === 'requestRender' ? requestRender : Reflect.get(target, key),
    }),
  };
});

function setDimension(target: object, property: string, value: number): void {
  Object.defineProperty(target, property, { configurable: true, value });
}

describe('captureAppScreenshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domToPng.mockResolvedValue('data:image/png;base64,AAAA');
    document.title = 'MasterSelects debug';
    setDimension(window, 'innerWidth', 1_440);
    setDimension(window, 'innerHeight', 900);
    setDimension(document.documentElement, 'clientWidth', 1_440);
    setDimension(document.documentElement, 'clientHeight', 900);
    setDimension(document.documentElement, 'scrollWidth', 1_440);
    setDimension(document.documentElement, 'scrollHeight', 900);
    setDimension(document.body, 'scrollWidth', 1_440);
    setDimension(document.body, 'scrollHeight', 900);
  });

  it('is registered as sensitive read-only dev tooling outside chat', () => {
    expect(AI_TOOLS.map((tool) => tool.function.name)).toContain('captureAppScreenshot');
    expect(getRegisteredToolHandlerNames()).toContain('captureAppScreenshot');
    expect(getToolPolicy('captureAppScreenshot')).toMatchObject({
      readOnly: true,
      sensitiveDataAccess: true,
    });
    expect(checkToolAccess('captureAppScreenshot', 'devBridge').allowed).toBe(true);
    expect(checkToolAccess('captureAppScreenshot', 'console').allowed).toBe(true);
    expect(checkToolAccess('captureAppScreenshot', 'chat').allowed).toBe(false);
    expect(checkToolAccess('captureAppScreenshot', 'kernel').allowed).toBe(false);
  });

  it('captures the current app viewport as a bridge-ready PNG', async () => {
    const result = await handleCaptureAppScreenshot({ settleMs: 0 });

    expect(result.success).toBe(true);
    expect(domToPng).toHaveBeenCalledWith(document.documentElement, expect.objectContaining({
      height: 900,
      scale: 1,
      type: 'image/png',
      width: 1_440,
    }));
    expect(result.data).toMatchObject({
      appliedScale: 1,
      constrained: false,
      dataUrl: 'data:image/png;base64,AAAA',
      fullPage: false,
      outputPixels: { height: 900, width: 1_440 },
      sourceCssPixels: { height: 900, width: 1_440 },
    });
  });

  it('re-presents the preview on several frames before reading its canvas', async () => {
    const order: string[] = [];
    requestRender.mockImplementation(() => { order.push('present'); });
    domToPng.mockImplementation(async () => { order.push('capture'); return 'data:image/png;base64,AAAA'; });
    await handleCaptureAppScreenshot({});
    expect(order).toEqual(['present', 'present', 'present', 'capture']);
  });

  it('captures full-page dimensions and safely reduces oversized output', () => {
    setDimension(document.documentElement, 'scrollWidth', 4_000);
    setDimension(document.documentElement, 'scrollHeight', 6_000);
    setDimension(document.body, 'scrollWidth', 4_000);
    setDimension(document.body, 'scrollHeight', 6_000);

    const geometry = resolveAppScreenshotGeometry(true, 2);

    expect(geometry.fullPage).toBe(true);
    expect(geometry.sourceWidth).toBe(4_000);
    expect(geometry.sourceHeight).toBe(6_000);
    expect(geometry.requestedScale).toBe(2);
    expect(geometry.appliedScale).toBeLessThan(1);
    expect(geometry.outputWidth * geometry.outputHeight).toBeLessThanOrEqual(12_000_000);
    expect(Math.max(geometry.outputWidth, geometry.outputHeight)).toBeLessThanOrEqual(8_192);
  });

  it('returns a bounded error when DOM capture does not produce PNG data', async () => {
    domToPng.mockResolvedValue('data:image/jpeg;base64,AAAA');

    await expect(handleCaptureAppScreenshot({})).resolves.toEqual({
      success: false,
      error: 'DOM capture returned an invalid PNG data URL.',
    });
  });
});
