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
  // Vector Engraving: the turned line grid, the picture and its averaged tone, the wave, the line width, ink and paper.
  if (type === 'vector-tiling') return {
    labels: { grid: 'Line Grid (Line Spacing, Angle)', source: 'Picture & Tone', filter: 'Cell Filter', wave: 'Wave', width: 'Line Width (Line Weight)',
      finish: 'Ink & Paper (Amount)' },
    portLabels: { rotated: 'Turned Pixel', 'safe-scale-pixels': 'Line Spacing (px)', 'line-position': 'Position in Lines', 'line-components:x': 'Along', 'line-components:y': 'Across',
      'tap-0-sample': 'Averaged Picture', tone: 'Tone', darkness: 'Darkness', wave: 'Wave', 'wave-depth': 'Wave Depth', 'waved-across': 'Across, Waved',
      'engraving-distance': 'Distance to Line', 'heavy-width': 'Heavy Width', 'line-width': 'Half Width', engraving: 'Line',
      'source-color:rgb': 'Picture RGB', 'source-color:alpha': 'Picture Alpha', styled: 'Drawing',
      'cell-filter': 'Cell Filter (cached)', 'cell-filter-rows': 'Row Average (cached)', 'cell-filter-width': 'Box Width (px)', 'cell-filter-taps': 'Reads per Row',
      'cell-filter-srgb': 'Average Colour' },
    stage: ({ id }) => /^cell-filter/.test(id) ? 'filter'
      : /^(color-[ab]-rgb|styled|mixed|combined)$/.test(id) ? 'finish'
      : /^(source|source-color|clamped-uv|clamp-m(in|ax)-vec2|tap-0-sample(-clamped-uv)?|tone|darkness)$/.test(id) ? 'source'
      : /^(wave(-phase|-depth|-offset)?|waved-across|engraving-(fraction|offset|distance))$/.test(id) ? 'wave'
      : /^(weight(-clamped)?|darkness-width|heavy-width|line-width|engraving(-low|-high|-smooth)?)$/.test(id) ? 'width' : 'grid',
  };
  return undefined;
}
