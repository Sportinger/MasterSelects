import { afterEach, describe, expect, it, vi } from 'vitest';

// Scopes in the phone colour editor: on Linux/Mesa a WebGPU <canvas> reports success but never
// composites, so the scope canvas is presented through the software path there (the preview's own
// SoftwareOutputCanvas), and one canvas keeps one context across remounts.
const platform = vi.hoisted(() => ({ software: true }));
vi.mock('../../src/utils/canvasPlatform', () => ({
  prefersSoftwareTimelineCanvas: () => platform.software,
  resetCanvasPlatformPreferenceForTests: () => {},
}));
vi.mock('../../src/engine/core/SoftwareOutputCanvas', () => ({
  SoftwareOutputCanvas: class { readonly kind = 'software'; constructor(readonly canvas: HTMLCanvasElement) {} },
}));

import { createScopeCanvasContext } from '../../src/components/panels/scopes/useScopeAnalysis';

afterEach(() => { vi.restoreAllMocks(); platform.software = true; });

describe('scope canvas presentation', () => {
  it('uses the software presentation on Linux/Mesa and reuses it for the same canvas', () => {
    const canvas = document.createElement('canvas');
    const getContext = vi.spyOn(canvas, 'getContext');
    const first = createScopeCanvasContext(canvas) as unknown as { kind: string; canvas: HTMLCanvasElement };
    expect(first.kind).toBe('software');
    expect(first.canvas).toBe(canvas);
    expect(createScopeCanvasContext(canvas)).toBe(first);
    expect(getContext).not.toHaveBeenCalled();
  });

  it('asks the canvas for a WebGPU context elsewhere', () => {
    platform.software = false;
    const canvas = document.createElement('canvas');
    const webgpu = { configure: vi.fn() };
    const getContext = vi.spyOn(canvas, 'getContext').mockReturnValue(webgpu as unknown as RenderingContext);
    expect(createScopeCanvasContext(canvas)).toBe(webgpu);
    expect(getContext).toHaveBeenCalledWith('webgpu');
  });
});
