import type { EffectPresentationPlan } from './effectPresentationPlans';

/** Folders and port labels of the Acuarela watercolour recipe (acuarelaWatercolorGraph.ts), in pipeline order. */
export function acuarelaPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type !== 'acuarela') return undefined;
  return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Frame & Paper Coordinates', bleed: 'Wet Patches & Bleed',
      wash: 'Pigment Wash (edge-aware, cached)', edges: 'Edge Pooling', paper: 'Paper & Granulation', blooms: 'Blooms',
      pigment: 'Pigment Density', finish: 'Paper Light, Lift & Mix' },
    portLabels: { 'source-cache': 'Premultiplied Source', 'space-scale': 'Pixel Scale', 'space-texel': 'Texel', 'space-q': 'Frame Position',
      'space-px': 'Position (1080p px)', 'space-flow-time': 'Flow Time', wet: 'Wet Patches', 'wet-read-uv': 'Read Position',
      'wash-sigma': 'Wash Sigma (px)', 'wash-range': 'Colour Tolerance', 'wash-weight': 'Tap Weight', 'wash-cache': 'Pigment Wash',
      'pool-wash-rgb': 'Wash Colour', 'pool-wash-luma': 'Wash Luminance', 'pool-contrast': 'Local Contrast', 'pool-density': 'Edge Pooling',
      'paper-height': 'Paper Height', 'paper-light': 'Paper Relief', 'paper-granulation': 'Granulation', 'bloom-density': 'Blooms',
      density: 'Pigment Density', 'density-painted': 'Painted Colour', 'finish-rgb': 'Lit & Lifted', 'result:image': 'Watercolour' },
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^(space-|coverage-floor$|reference-height$)/.test(id) ? 'space'
      : /^wet(-|$)/.test(id) ? 'bleed' : /^wash-/.test(id) ? 'wash' : /^pool-/.test(id) ? 'edges' : /^paper-/.test(id) ? 'paper'
        : /^bloom-/.test(id) ? 'blooms' : /^density(-|$)/.test(id) ? 'pigment' : 'finish',
  };
}
