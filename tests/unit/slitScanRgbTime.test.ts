import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { prepareImageEffect } from '../../src/services/operators/imageEffectRuntimePlan';
import { evaluateMaterializedImage } from '../helpers/evaluateMaterializedImage';
function render(params: Record<string, unknown>, protection = 0) {
  const plan = prepareImageEffect({ type: 'slit-scan', params: { ...getDefaultParams('slit-scan'), delay: 2,
    temporalStorage: 'cache', scanSmoothing: 0, scanSmoothingPreview: false, ...params } }).plan!;
  const pixel = evaluateMaterializedImage(plan, [.1, .2, .3, .4], { uv: [.25, .5], resolution: [100, 100],
    timelineTimeSeconds: 2, sampleResource: id => id === 'slit-scan:protection' ? [protection, 0, 0, 1] : [0, 0, 0, 0],
    sampleInputHistory: (_uv, delay) => [delay, delay, delay, delay / 2] });
  return { plan, pixel };
}
describe('separate RGB history queries', () => {
  it('uses distinct bounded channel delays and preserves alpha from the base time', () => {
    const { pixel, plan } = render({ rgbTimeMode: 'separate', rgbRedOffset: .1, rgbGreenOffset: .2, rgbBlueOffset: -.1 });
    [.6, .7, .4, .25].forEach((value, i) => expect(pixel[i]).toBeCloseTo(value));
    expect(new Set(plan.externalResources?.filter(item => item.kind === 'input-history').map(item => item.owner)).size).toBe(4);
    const bounded = render({ rgbTimeMode: 'separate', rgbRedOffset: 60, rgbBlueOffset: -60 }).pixel;
    expect(bounded[0]).toBe(2); expect(bounded[2]).toBe(0);
  });
  it('keeps zero offsets equal to linked RGBA and prunes unused channel samplers', () => {
    const linked = render({ rgbTimeMode: 'linked' }), separate = render({ rgbTimeMode: 'separate' });
    expect(separate.pixel).toEqual(linked.pixel);
    expect(new Set(linked.plan.externalResources?.filter(item => item.kind === 'input-history').map(item => item.owner)).size).toBe(1);
  });
  it('applies protection after offsets and previews the selected protected channel', () => {
    const params = { rgbTimeMode: 'separate', rgbRedOffset: .5, rgbBlueOffset: -.2 };
    expect(render(params, 1).pixel).toEqual([0, 0, 0, 0]);
    const preview = render({ ...params, preview: 'time', rgbTimePreview: 'red' }, .5).pixel;
    expect(preview[0]).toBeCloseTo(.25);
    expect(preview[3]).toBe(1);
  });
  it('does not reuse single-delay smoothing or its diagnostic overlay for RGB', () => {
    const { plan } = render({ rgbTimeMode: 'separate', scanSmoothing: 5, scanSmoothingPreview: true });
    expect(plan.externalResources?.some(item => item.kind === 'source-motion')).toBe(false);
    expect(plan.passes?.some(pass => pass.program.instructions.some(item => item.operation === 'directional-smooth'))).toBeFalsy();
  });
});
