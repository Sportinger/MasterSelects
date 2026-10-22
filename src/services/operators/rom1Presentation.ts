import type { EffectPresentationPlan } from './effectPresentationPlans';

const octaves = (make: (index: number, name: string) => Array<[string, string]>) =>
  Object.fromEntries(Array.from({ length: 4 }, (_, index) => make(index, `Octave ${index + 1}`)).flat());

/** Folders and port labels of the Rom1 recipe (rom1EffectGraph.ts), in pipeline order. */
export function rom1PresentationPlan(type: string): EffectPresentationPlan | undefined {
  if (type !== 'rom1') return undefined;
  return {
    labels: { scale: 'Noise Scale (Density, Detail)', octaves: 'Noise Octaves (4 layers)', sum: 'Octave Sum (currents)',
      drift: 'Drift per Frame (Strength, Speed, Gain X/Y)', edges: 'Frame Edge Fade', read: 'Premultiplied Reads',
      lift: 'Wet Mix & Gain Lift', trail: 'Trail (fade, keep brighter)', finish: 'Opacity Mix & Straight Alpha' },
    portLabels: {
      'safe-density': 'Density (> 0)', 'safe-detail': 'Detail (> 0)', 'density-uv': 'UV × Density', 'noise-uv': 'Noise Position',
      ...octaves((index, name) => [[`octave-${index}-point`, `${name} Position`], [`octave-${index}-time`, `${name} Time`],
        [`octave-${index}-noise`, `${name} Noise (0 to 1)`], [`octave-${index}-centered`, `${name} Flow (−1 to 1)`],
        [`octave-${index}-weighted`, `${name} Flow × Weight`], [`octave-${index}-n1-result`, `${name} Noise X`], [`octave-${index}-n1-point`, `${name} Noise X Read`],
        [`octave-${index}-n1-point-offset`, `${name} Time Shift (× 0.071, 0.113)`], [`octave-${index}-noise2`, `${name} Noise × 2`],
        [`octave-${index}-n2-result`, `${name} Noise Y`], [`sum-${index}`, index === 3 ? 'Flow Sum' : `Flow Sum (${index + 1})`],
        [`normalizer-${index}`, index === 3 ? 'Weight Sum' : `Weight Sum (${index + 1})`]]),
      ...Object.fromEntries([1, 2, 3].flatMap(index => [[`amplitude-${index}`, `Octave ${index + 1} Weight`], [`frequency-${index}`, `Octave ${index + 1} Scale`]])),
      'offset-base': 'Currents (−1 to 1)', 'normalizer-vec2': 'Weight Sum (x, y)', 'sum-zero': 'Zero Flow',
      'noise-gain': 'Speed (> 0)', 'negative-gain-y': '− Gain Y', 'gain-vector': 'Drift Direction', 'gain-strength': 'Direction × Strength',
      'gain-scale': 'Direction × Strength × 0.005', 'gain-noise': 'Drift Scale', offset: 'Drift', 'warped-uv': 'Drifted Position',
      'feedback-uv': 'Read Position (in frame)', 'zero-vec2': '(0, 0)', 'one-vec2': '(1, 1)',
      'one-minus-x': '1 − x', 'one-minus-y': '1 − y', 'edge-x': 'Distance to Side', 'edge-y': 'Distance to Top or Bottom', edge: 'Distance to Edge',
      'edge-mask': 'Edge Fade',
      'source-alpha-components:w': 'Picture Alpha', 'wet-alpha-components:w': 'Drifted Alpha', 'feedback-alpha-components:w': 'Last Frame Alpha',
      'feedback-alpha-masked': 'Last Frame Alpha (faded at edges)', 'source-premultiplied': 'Picture (premultiplied)',
      'wet-premultiplied': 'Drifted Picture (premultiplied)', 'feedback-premultiplied': 'Last Frame (premultiplied)',
      'safe-gain': 'Gain (≥ 0)', 'gain-knee': 'Gain Lift', 'gain-rgb': 'Gain Lift (RGB)', 'alpha-gain': 'Lift × Alpha',
      'wet-mix': 'Wet Picture', 'lifted-raw': 'Wet Picture + Lift', lifted: 'Lifted Picture',
      'trail-clamped': 'Trail (kept in range)', advected: 'Faded Trail', 'trail-fade-floor': 'Fade Floor (3/4 step)', 'trail-faded-by': 'Fade by Trail', 'trail-shortfall': 'Missing Fade', 'trail-faded': 'Faded Trail (at least a step)', 'trail-alpha-faded-by': 'Alpha Fade by Trail', 'trail-alpha-shortfall': 'Missing Alpha Fade', 'trail-alpha-faded': 'Faded Trail Alpha (at least a step)', 'feedback-alpha-decayed': 'Faded Trail Alpha', 'water-rgb': 'Smoke', 'water-alpha-max': 'Brighter Alpha', 'water-alpha': 'Smoke Alpha',
      'opacity-clamp': 'Opacity (0 to 1)', mixed: 'Mixed (premultiplied)', 'mixed-alpha': 'Mixed Alpha', 'mixed-alpha-safe': 'Mixed Alpha (> 0)',
      straight: 'Straight Colour', 'straight-clamped': 'Straight Colour (0 to 1)', 'water-value': 'Smoke (RGBA)', 'result:image': 'Rom1',
    },
    // Edited graphs and the recipe saved before 2026-10-22 reuse some ids for other values.
    portLabelsApply: graph => graph.nodes.some(node => node.id === 'feedback-premultiplied'),
    stage: ({ id }) => /^(safe-density|safe-detail|density-uv|noise-uv)$/.test(id) ? 'scale'
      : /^(octave-|amplitude-|frequency-)/.test(id) ? 'octaves'
        : /^(sum-|normalizer-|offset-base$)/.test(id) ? 'sum'
          : /^(noise-gain|negative-gain-y|gain-vector|gain-strength|gain-scale|gain-noise|offset|warped-uv|zero-vec2|one-vec2|feedback-uv)$/.test(id) ? 'drift'
            : /^(warped-parts|one-minus-[xy]|edge-[xy]|edge|edge-mask)$/.test(id) ? 'edges'
              : /^(source|wet-source|feedback-sample|source-split|wet-split|feedback-split|(source|wet|feedback)-alpha-(vec4|components)|feedback-alpha-masked|(source|wet|feedback)-premultiplied)$/.test(id) ? 'read'
                : /^(wet-mix|alpha-gain|lifted-raw|lifted|safe-gain|gain-rgb|gain-knee.*)$/.test(id) ? 'lift'
                  : /^(trail-.*|advected|water-rgb|feedback-alpha-decayed|water-alpha-max|water-alpha)$/.test(id) ? 'trail' : 'finish',
  };
}
