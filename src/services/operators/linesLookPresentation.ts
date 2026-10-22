import type { EffectPresentationPlan } from './effectPresentationPlans';

/** Lines & Engraving looks of the pattern engine (geometryFragmentEffectGraphs.ts): their stage folders in the Nodes tab. */
export function linesLookPresentationPlan(type: string): EffectPresentationPlan | undefined {
  // Crosshatch: the three line grids, the picture and its tone, how wide each line is drawn, which layers the tone lets through, ink and paper.
  if (type === 'crosshatch') return {
    labels: { grid: 'Line Grid (Line Spacing)', source: 'Picture & Tone', width: 'Line Width (Line Weight)', layers: 'Tone Layers', finish: 'Ink & Paper (Amount)' },
    portLabels: { 'pattern-pixel': 'Position in Lines', 'first-distance': 'Distance to Line', 'second-distance': 'Distance to Line',
      'third-distance': 'Distance to Line', first: 'Line', second: 'Line', third: 'Line', 'first-width': 'Half Width', 'second-width': 'Half Width',
      'third-width': 'Half Width', 'first-gated': 'Layer 1', 'second-gated': 'Layer 2', 'third-gated': 'Layer 3', 'dark-hatch': 'Layers 2 + 3', hatch: 'Hatch',
      'source-tone': 'Tone', 'source-color:rgb': 'Picture RGB', 'source-color:alpha': 'Picture Alpha', styled: 'Drawing' },
    stage: ({ id }) => /^(color-[ab]-rgb|styled|mixed|combined)$/.test(id) ? 'finish'
      : /^(source|source-color|source-tone|clamped-uv|clamp-m(in|ax)-vec2)$/.test(id) ? 'source'
      : /^(hatch|dark-hatch)$|-gate(d)?$/.test(id) ? 'layers'
        : /^(weight|(first|second|third)(-(below-limit|darkness|heavy|width|low|high|smooth))?$)/.test(id) ? 'width' : 'grid',
  };
  return undefined;
}
