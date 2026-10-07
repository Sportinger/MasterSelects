import { describe, expect, it, vi } from 'vitest';
import { FlockPass } from '../../src/engine/native3d/passes/FlockPass';
import { flockNeedsLayerComposite } from '../../src/engine/flock/gpu/FlockLayerComposite';
import type { FlockDrawPlan } from '../../src/engine/flock/gpu/FlockBranchRenderer';
import type { SceneFlockLayer } from '../../src/engine/scene/types';
describe('Flock Transform compositing', () => {
  it('retains opacity and blend mode at the runtime boundary, even if the simulation returns only geometry metadata', () => {
    const runtime = { prepare: vi.fn(() => ({ layer: { clipId: 'a' } })) };
    const pass = new FlockPass(() => runtime as never);
    const layer = { clipId: 'a', blendMode: 'multiply', opacity: .5 } as SceneFlockLayer;
    const [plan] = pass.prepare({} as GPUDevice, {} as GPUCommandEncoder, [layer], false);
    expect(plan.layer.blendMode).toBe('multiply'); expect(plan.layer.opacity).toBe(.5);
    expect(flockNeedsLayerComposite(plan)).toBe(true);
  });
  it('isolates custom blends and partial opacity, leaving existing normal full-opacity scenes on the direct path', () => {
    for (const layer of [{ blendMode: 'screen' }, { blendMode: 'difference' }, { opacity: 0 }, { opacity: .5 }])
      expect(flockNeedsLayerComposite({ layer } as FlockDrawPlan)).toBe(true);
    expect(flockNeedsLayerComposite({ layer: {} } as FlockDrawPlan)).toBe(false);
    expect(flockNeedsLayerComposite({ layer: { blendMode: 'normal', opacity: 1 } } as FlockDrawPlan)).toBe(false);
  });
});
