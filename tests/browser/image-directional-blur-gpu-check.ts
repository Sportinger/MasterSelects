import { motionBlur } from '../../src/effects/blur/motion';
import { radialBlur } from '../../src/effects/blur/radial';
import { zoomBlur } from '../../src/effects/blur/zoom';
import { createDefaultZoomBlurGraph } from '../../src/services/operators/directionalBlurEffectGraphs';
import type { FullscreenEffectDefinition } from '../../src/effects/types';
import { alphaEdgeFixture, assertCleanAlphaEdge, checkTwoPassBlurs, ROW_PITCH } from './blur-two-pass-gpu-check';

const definitions = { 'motion-blur': motionBlur, 'radial-blur': radialBlur, 'zoom-blur': zoomBlur } as Record<string, FullscreenEffectDefinition>;
const cases = [
  { name: 'motion-zero', type: 'motion-blur', params: { amount: 0 }, width: 64, height: 37 },
  { name: 'motion-default', type: 'motion-blur', params: {}, width: 64, height: 37 },
  { name: 'motion-diagonal-legacy-samples', type: 'motion-blur', params: { amount: 0.12, angle: 1.1, samples: 5.9 }, width: 64, height: 37 },
  { name: 'motion-max', type: 'motion-blur', params: { amount: 0.3, angle: 6.28318 }, width: 48, height: 27 },
  { name: 'radial-zero', type: 'radial-blur', params: { amount: 0 }, width: 64, height: 37 },
  { name: 'radial-default', type: 'radial-blur', params: {}, width: 64, height: 37 },
  { name: 'radial-off-center', type: 'radial-blur', params: { amount: 1.1, centerX: 0.2, centerY: 0.8 }, width: 64, height: 37 },
  { name: 'radial-max', type: 'radial-blur', params: { amount: 2, centerX: 0, centerY: 1 }, width: 48, height: 27 },
  { name: 'radial-spin', type: 'radial-blur', params: { mode: 'spin', amount: 0.5 }, width: 64, height: 37 },
  { name: 'radial-spin-max', type: 'radial-blur', params: { mode: 'spin', amount: 2, centerX: 0.3, centerY: 0.6 }, width: 48, height: 27 },
  { name: 'zoom-zero', type: 'zoom-blur', params: { amount: 0 }, width: 64, height: 37 },
  { name: 'zoom-default', type: 'zoom-blur', params: {}, width: 64, height: 37 },
  { name: 'zoom-off-center', type: 'zoom-blur', params: { amount: 0.65, centerX: 0.3, centerY: 0.7 }, width: 64, height: 37 },
  { name: 'zoom-max', type: 'zoom-blur', params: { amount: 1, centerX: 1, centerY: 0 }, width: 48, height: 27 },
  // Negative amounts reverse the range (legacy): finite pixels, never NaN.
  { name: 'motion-negative', type: 'motion-blur', params: { amount: -0.05, angle: 0.4 }, width: 64, height: 37 },
  { name: 'zoom-negative', type: 'zoom-blur', params: { amount: -0.3 }, width: 64, height: 37 },
  { name: 'radial-negative', type: 'radial-blur', params: { amount: -0.5 }, width: 64, height: 37 },
  { name: 'radial-spin-negative', type: 'radial-blur', params: { mode: 'spin', amount: -0.5 }, width: 64, height: 37 },
  { name: 'motion-alpha-edge', type: 'motion-blur', params: { amount: 0.07 }, width: 64, height: 37, fixture: alphaEdgeFixture(30) },
];

export async function checkDirectionalBlurGpu(device: GPUDevice): Promise<number> {
  let averagedAlpha = 0;
  const comparisons = await checkTwoPassBlurs(device, cases, definitions, ['directionalBlurPremultiply', 'directionalBlurFine', 'directionalBlurCoarse'],
    async (item, input, actual, rerender) => {
      const inside = (index: number) => (index % ROW_PITCH) < item.width * 4;
      if (item.name.endsWith('alpha-edge')) { assertCleanAlphaEdge(item.name, actual, item.width, item.height); return 1; }
      if (item.name.endsWith('-negative') && !actual.some((value, index) => inside(index) && value !== input[index])) {
        throw new Error(`${item.name} did not blur`);
      }
      if (item.name.endsWith('-zero')) {
        // Amount 0 is the identity up to the premultiplied rgba16float round trip (fully transparent RGB is not kept).
        actual.forEach((value, index) => { if (inside(index) && input[index - (index % 4) + 3] > 0 && Math.abs(value - input[index]) > 1) {
          throw new Error(`${item.name} changed pixels at byte ${index}`);
        } });
      }
      if (item.name.endsWith('-default')) {
        if (!actual.some((value, index) => index % 4 === 3 && inside(index) && value !== input[index])) {
          throw new Error(`${item.name} kept center alpha instead of averaging full RGBA`);
        }
        averagedAlpha++;
      }
      if (item.name !== 'zoom-default') return 0;
      const edited = createDefaultZoomBlurGraph();
      edited.nodes.find(node => node.id === 'zoom-scale-per-amount')!.constants = { value: 0.25 };
      const editedOutput = await rerender(edited);
      if (editedOutput.every((value, index) => value === actual[index])) throw new Error('Edited Zoom Blur scale-per-amount literal did not change actual GPU pixels');
      return 1;
    });
  if (averagedAlpha !== 3) throw new Error(`Expected three full-RGBA alpha checks, got ${averagedAlpha}`);
  return comparisons;
}
