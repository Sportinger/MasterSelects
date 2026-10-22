import type { EffectPresentationPlan } from './effectPresentationPlans';

/** Folders and port labels of the Acuarela watercolour recipe (acuarelaWatercolorGraph.ts), in pipeline order. */
export function acuarelaPresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type !== 'acuarela') return undefined;
  return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Frame & Paper Coordinates', bleed: 'Wet Patches & Bleed',
      wash: 'Pigment Wash (edge-aware, cached)', soften: 'Second Wash & Wet Bleeding (cached)', edges: 'Edge Pooling',
      simplify: 'Simplify (tones)', paper: 'Paper & Granulation', blooms: 'Blooms', pigment: 'Pigment Density',
      shadows: 'Shadow Pigment', finish: 'Paper Light, Lift & Mix' },
    portLabels: { 'source-cache': 'Premultiplied Source', 'space-scale': 'Pixel Scale', 'space-texel': 'Texel', 'space-q': 'Frame Position',
      'space-px': 'Position (1080p px)', 'space-px-raw': 'Pixel Position', 'space-flow-time': 'Flow Time', wet: 'Wet Patches', 'wet-read-uv': 'Read Position',
      'wet-bleed-positive': 'Bleed (≥ 0)', 'wet-half-vec2': 'Half (0.5, 0.5)', 'wash-size-positive': 'Wash (≥ 0)', 'wash-jitter-noise': 'Tap Jitter',
      'pool-wash-rgb-split:alpha': 'Wash Alpha',
      'wash-sigma': 'Wash Sigma (px)', 'wash-range': 'Colour Tolerance', 'wash-weight': 'Tap Weight', 'wash-first-cache': 'First Wash',
      'wash-soft-sigma': 'Second Sigma (px)', 'wash-soft-range': 'Wet Colour Tolerance', 'wash-cache': 'Pigment Wash',
      'pool-wash-rgb': 'Wash Colour', 'pool-wash-luma': 'Wash Luminance', 'pool-mean-rgb': 'Neighbourhood Colour', 'pool-contrast': 'Local Contrast', 'pool-density': 'Edge Pooling',
      'tone-rgb': 'Simplified Colour', 'shade-rgb': 'Shadow-lifted Colour',
      'paper-height': 'Paper Height', 'paper-light': 'Paper Relief', 'paper-visibility': 'Paper Visibility', 'paper-granulation': 'Granulation',
      'bloom-density': 'Blooms', 'density-terms': 'Pigment Excess', 'density-more-eased': 'More Pigment (eased)',
      'density-less-eased': 'Less Pigment (eased)', 'density-excess': 'Eased Excess', 'density-colour': 'Colour C', 'density-transmission': 'C − C²',
      density: 'Pigment Density', 'density-painted': 'Painted Colour', 'finish-rgb': 'Lit & Lifted', 'result:image': 'Watercolour',
      // Inner cards, so recipe pictures and the editor name their cables instead of showing bare "Multiply" or "Add".
      'wet-field': 'Wet Field Noise', 'wet-patch': 'Wet Area', 'wet-bleed-share-raw': 'Bleed ÷ 10', 'wet-bleed-share': 'Bleed Share',
      'wet-wobble': 'Wobble Noise', 'wet-wobble-centered': 'Wobble (−0.5 to 0.5)', 'wet-reach-share': '0.25 + 0.5 Wet', 'wet-reach-raw': 'Wobble Reach',
      'wet-reach-1080': 'Capped Reach', 'wet-reach-px': 'Reach (px)', 'wet-reach-double': '2 × Reach (px)', 'wet-offset-px': 'Wobble Offset (px)', 'wet-offset': 'Wobble Offset',
      'wash-widening': '1 + 0.3 Wet', 'wash-sigma-1080': 'Sigma (1080p px)', 'wash-index-jittered': 'Jittered Tap', 'wash-tap': 'Tap Colour',
      'wash-colour-distance': 'Colour Distance²', 'wash-range-term': 'Colour Term', 'wash-spatial-term': 'Distance Term', 'wash-exponent-positive': 'Exponent',
      'wash-soft-dry': '0.6 Wash', 'wash-soft-bleed': '0.25 Bleed', 'wash-soft-bleed-wet': '0.25 Bleed × Wet', 'wash-soft-sigma-1080': 'Second Sigma (1080p px)',
      'wash-soft-tap': 'Tap Colour', 'wash-soft-colour-distance': 'Colour Distance²', 'wash-soft-range-term': 'Colour Term', 'wash-soft-spatial-term': 'Distance Term',
      'wash-soft-exponent-positive': 'Exponent', 'wash-soft-weight': 'Tap Weight',
      'pool-weight': 'Tap Weight', 'pool-mean-luma': 'Neighbourhood Luminance', 'pool-contrast-negative': '− Local Contrast', 'pool-dark-side': 'Dark Side',
      'pool-light-side': 'Light Side', 'pool-darkening': 'Dark Side × 1.5', 'pool-lightening': 'Light Side × 0.25', 'pool-shape': 'Pooling Shape',
      'pool-dryness': '1 − 0.6 Wet', 'pool-shape-dry': 'Pooling (drier)',
      'paper-position': 'Paper Position', 'paper-slope': 'Paper Slope', 'paper-relief-raw': 'Slope × 4', 'paper-light-raw': '0.5 + Slope × 4',
      'paper-bell': 'Mid-tone Share', 'paper-pigment': 'Pigment Amount', 'paper-valley': 'Valley Depth', 'paper-settling': 'Settled Pigment',
      'paper-uneven-share': 'Uneven Density', 'paper-granulation-raw': 'Granulation Shape', 'paper-granulation-shape': 'Visible Granulation',
      'bloom-field-base': 'Bloom Noise', 'bloom-fringe-share': 'Ragged Fringe', 'bloom-field': 'Bloom Field', 'bloom-inside': 'Bloom Inside',
      'bloom-rim-exponent': '−10000 × Distance²', 'bloom-rim': 'Bloom Rim', 'bloom-rim-share': 'Rim × 1.1', 'bloom-inside-share': 'Inside × 0.5',
      'bloom-shape': 'Bloom Shape', 'bloom-gate-field': 'Gate Noise', 'bloom-gate': 'Bloom Gate', 'bloom-local-contrast': '|Local Contrast|',
      'bloom-busy': 'Busy Area', 'bloom-flat': 'Flat Area', 'bloom-place': 'Bloom Place', 'bloom-placed': 'Placed Bloom',
      'tone-scaled': 'Luminance × 6', 'tone-floor': 'Tone Below', 'tone-fraction': 'Between Tones', 'tone-step': 'Soft Step', 'tone-level-scaled': 'Tone × 6',
      'tone-level': 'Tone Level', 'tone-luma-safe': 'Luminance (safe)', 'tone-ratio': 'Tone ÷ Luminance', 'tone-quantized': 'Toned Colour', 'tone-amount': 'Simplify (0 to 1)',
      'density-pool-granulation': 'Pooling + Granulation', 'density-more': 'More Pigment', 'density-more-decay': 'e^−More', 'density-less': 'Less Pigment',
      'density-less-decay': 'e^Less', 'density-colour-squared': 'C²', 'density-change': 'Pigment Change',
      'shade-clamped': 'Painted (0 to 1)', 'shade-pigment:rgb': 'Indigo Pigment', 'shade-white:rgb': 'White', 'shade-paper-share': '1 − Indigo',
      'shade-scaled': 'Colour × (1 − Indigo)', 'shade-lifted': 'Lifted to Indigo', 'shade-amount': 'Shadow Pigment (0 to 1)',
      'finish-light-centered': 'Relief − 0.5', 'finish-relief-visible': 'Visible Relief', 'finish-relief-amount': 'Relief × Paper', 'finish-relief-raw': '1 + Relief',
      'finish-relief': 'Relief Light', 'finish-lit': 'Lit Colour', 'finish-lift-clamped': 'Lift (0 to 1)', 'finish-lift': 'Lift Share', 'finish-white:rgb': 'White',
      'finish-lifted': 'Lifted Colour', 'finish-alpha': 'Wash Alpha', 'finish-painted-rgb': 'Painted × Alpha', 'finish-painted:image': 'Painted',
      'finish-original:image': 'Original', 'finish-mix': 'Mix (0 to 1)', 'finish-mixed': 'Mixed', 'finish-straight': 'Straight Colour',
      'finish-original-vec4': 'Original (RGBA)', 'finish-painted-vec4': 'Painted (RGBA)', 'finish-relief-share': 'Relief × 0.25',
      'wet-field-position': 'Wet Field Position', 'wet-wobble-x': 'Wobble Noise X', 'wet-wobble-y': 'Wobble Noise Y',
      'wash-range-denominator': '2 × Tolerance²', 'wash-soft-range-denominator': '2 × Tolerance²', 'wash-tap-uv': 'Tap Position', 'wash-soft-tap-uv': 'Tap Position',
      'wash-exponent': '− Exponent', 'wash-soft-exponent': '− Exponent',
      'paper-height-position': 'Grain Position', 'paper-height-x': 'Height (right)', 'paper-height-y': 'Height (below)', 'paper-slope-x': 'Slope Right',
      'paper-slope-y': 'Slope Below', 'paper-valley-gained': 'Valley × 1.3', 'paper-pigment-share': '0.3 + Pigment', 'paper-light-gained': 'Mid-tone Share × 0.8',
      'paper-uneven': 'Uneven Noise', 'paper-uneven-centered': 'Uneven − 0.5', 'shade-pigment-vec3': 'Indigo (0.08, 0.09, 0.14)',
      'bloom-rim-distance': 'Field − 0.6', 'bloom-rim-distance-squared': 'Distance²', 'density-more-exponent': '− More' },
    // Saved smoke-recipe graphs reuse ids such as `density` and `result` for other values.
    portLabelsApply: graph => !graph.nodes.some(node => node.operator === 'image.frame-history'),
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : /^(space-|coverage-floor$|reference-height$)/.test(id) ? 'space'
      : /^wet(-|$)/.test(id) ? 'bleed' : /^(wash-soft-|wash-cache$)/.test(id) ? 'soften' : /^wash-/.test(id) ? 'wash'
        : /^pool(-|$)/.test(id) ? 'edges' : /^tone-/.test(id) ? 'simplify' : /^shade-/.test(id) ? 'shadows' : /^paper-/.test(id) ? 'paper'
          : /^bloom-/.test(id) ? 'blooms' : /^density(-|$)/.test(id) ? 'pigment' : 'finish',
  };
}
