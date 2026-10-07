import { describe, expect, it, vi } from 'vitest';
import type { SceneCamera } from '../../src/engine/scene/types';
import type { StrandPass, StrandShadowFrame } from '../../src/engine/native3d/passes/StrandPass';
import type { LayerSpaceEffectContext } from '../../src/engine/native3d/sceneRenderer/LayerSpaceEffectRenderer';
const projected = vi.hoisted(() => ({ render: vi.fn(), release: vi.fn(), destroy: vi.fn() }));
vi.mock('../../src/engine/native3d/passes/ProjectedLayerEffects', () => ({ ProjectedLayerEffects: class {
  render = projected.render; release = projected.release; destroy = projected.destroy;
} }));
import { StrandProjectedEffects } from '../../src/engine/native3d/sceneRenderer/StrandProjectedEffects';

describe('projected strand effects', () => {
  it('keeps layer targets aligned, scopes effects by render target, and releases removed layers', () => {
    const wrapper = new StrandProjectedEffects(), render = vi.fn(() => true);
    projected.render.mockClear(); projected.release.mockClear();
    projected.render.mockImplementation((...args: unknown[]) => (args[9] as (a: unknown,b: unknown)=>boolean)('own-color','own-depth'));
    const effect = { id: 'glow', type: 'glow', enabled: true, params: {} };
    const draws = [{ layer: { layerId: 'a', postProjectionEffects: [effect] } },
      { layer: { layerId: 'b' } }, { layer: { layerId: 'c', postProjectionEffects: [effect] } }];
    const frame = { draws, targets: ['target-a','target-b','target-c'] } as unknown as StrandShadowFrame;
    const device = {} as GPUDevice, encoder = {} as GPUCommandEncoder, view = {} as GPUTextureView;
    const camera = { viewport: { width: 100, height: 200 } } as SceneCamera;
    const context = {} as LayerSpaceEffectContext, pass = { render } as unknown as StrandPass;
    expect(wrapper.render('main',pass,device,encoder,view,view,frame,camera,[],context)).toBe(true);
    expect(render.mock.calls.map(call => (call as unknown[])[4])).toEqual([
      { draws:[draws[1]], targets:['target-b'] }, { draws:[draws[0]], targets:['target-a'] }, { draws:[draws[2]], targets:['target-c'] },
    ]);
    expect(projected.render.mock.calls.map(call => [call[0], call[8]])).toEqual([
      ['["main","a"]',1], ['["main","c"]',1],
    ]);
    expect(wrapper.hasApplied('main')).toBe(true);
    wrapper.render('nested',pass,device,encoder,view,view,frame,camera,[],context);
    wrapper.render('main',pass,device,encoder,view,view,{ ...frame,draws:[],targets:[] },camera,[],context);
    expect(projected.release.mock.calls).toEqual([['["main","a"]'],['["main","c"]']]);
    expect(wrapper.hasApplied('main')).toBe(false); expect(wrapper.hasApplied('nested')).toBe(true);
    wrapper.releaseTarget('nested'); expect(wrapper.hasApplied('nested')).toBe(false);
    expect(projected.release).toHaveBeenCalledWith('["nested","a"]');
    wrapper.destroy(); expect(projected.destroy).toHaveBeenCalled();
  });
});
