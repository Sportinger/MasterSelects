import type { EffectPresentationPlan } from './effectPresentationPlans';

/** Folders and port labels of the Acuarela watercolour recipe (acuarelaWatercolorGraph.ts), in pipeline order. */
export function acuarelaPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type !== 'acuarela') return undefined;
  return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Frame & Paper Coordinates', bleed: 'Wet Patches & Bleed',
      wash: 'Pigment Wash (edge-aware, cached)', soften: 'Second Wash & Wet Bleeding (cached)', edges: 'Edge Pooling',
      simplify: 'Simplify (tones)', shadows: 'Shadow Pigment', paper: 'Paper & Granulation', blooms: 'Blooms',
      pigment: 'Pigment Density', finish: 'Paper Light, Lift & Mix' },
    portLabels: { 'source-cache': 'Premultiplied Source', 'space-scale': 'Pixel Scale', 'space-texel': 'Texel', 'space-q': 'Frame Position',
      'space-px': 'Position (1080p px)', 'space-flow-time': 'Flow Time', wet: 'Wet Patches', 'wet-read-uv': 'Read Position',
      'wash-sigma': 'Wash Sigma (px)', 'wash-range': 'Colour Tolerance', 'wash-weight': 'Tap Weight', 'wash-first-cache': 'First Wash',
      'wash-soft-sigma': 'Second Sigma (px)', 'wash-soft-range': 'Wet Colour Tolerance', 'wash-cache': 'Pigment Wash',
      'pool-wash-rgb': 'Wash Colour', 'pool-wash-luma': 'Wash Luminance', 'pool-contrast': 'Local Contrast', 'pool-density': 'Edge Pooling',
      'tone-rgb': 'Simplified Colour', 'shade-rgb': 'Shadow-lifted Colour',
      'paper-height': 'Paper Height', 'paper-light': 'Paper Relief', 'paper-visibility': 'Paper Visibility', 'paper-granulation': 'Granulation',
      'bloom-density': 'Blooms', density: 'Pigment Density', 'density-painted': 'Painted Colour', 'finish-rgb': 'Lit & Lifted', 'result:image': 'Watercolour' },
    // Saved smoke-recipe graphs reuse ids such as `density` and `result` for other values.
    portLabelsApply: graph => !graph.nodes.some(node => node.operator === 'image.frame-history'),
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^(space-|coverage-floor$|reference-height$)/.test(id) ? 'space'
      : /^wet(-|$)/.test(id) ? 'bleed' : /^(wash-soft-|wash-cache$)/.test(id) ? 'soften' : /^wash-/.test(id) ? 'wash'
        : /^pool(-|$)/.test(id) ? 'edges' : /^tone-/.test(id) ? 'simplify' : /^shade-/.test(id) ? 'shadows' : /^paper-/.test(id) ? 'paper'
          : /^bloom-/.test(id) ? 'blooms' : /^density(-|$)/.test(id) ? 'pigment' : 'finish',
  };
}
