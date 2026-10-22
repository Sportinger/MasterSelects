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
  // Contour Map: the averaged picture (Smoothing), its height and slope, the band colours (Band Density, Fill), the lines on
  // the band edges (Line Width), ink and paper.
  if (type === 'contour-map') return {
    labels: { source: 'Picture & Tone', filter: 'Smoothing', height: 'Height & Slope (Band Density)', bands: 'Bands (Fill, Ink, Paper)',
      lines: 'Lines (Line Width)', finish: 'Drawing (Amount)' },
    portLabels: { levels: 'Bands', 'tap-0-tone': 'Tone', 'tap-1-tone': 'Tone Right', 'tap-2-tone': 'Tone Left', 'tap-3-tone': 'Tone Below',
      'tap-4-tone': 'Tone Above', height: 'Height', 'safe-slope': 'Slope (bands/px)', 'nearest-edge': 'Nearest Edge', 'edge-distance': 'Distance to Edge (px)',
      'line-coverage': 'Line Cover', 'inner-edge': 'Inner Edge', line: 'Line', quantized: 'Band Position', 'band-color': 'Band Colour',
      'filled-band': 'Filled Band', 'source-color:rgb': 'Picture RGB', 'source-color:alpha': 'Picture Alpha', styled: 'Drawing',
      'cell-filter': 'Smoothed Picture (cached)', 'cell-filter-rows': 'Row Average (cached)', 'cell-filter-width': 'Box Width (px)',
      'cell-filter-taps': 'Reads per Row', 'cell-filter-srgb': 'Average Colour' },
    // The 1080p frame scale sits with Smoothing (it also feeds Line Width), and Ink and Paper enter with the bands they
    // tint, so no folder feeds one that feeds it back.
    stage: ({ id }) => /^(cell-filter|smoothing|frame-)/.test(id) ? 'filter'
      : /^(styled|mixed|combined)$/.test(id) ? 'finish'
      : /^(source|source-color|clamped-uv|clamp-m(in|ax)-vec2|pixel-(step|left|up)(-components)?|one-vec2)$|^tap-\d/.test(id) ? 'source'
      : /^(line|lineWidth)|^(edge-above-black|edge-below-white|half-edge|last-edge|half-step|inner-edge)$/.test(id) ? 'lines'
      : /^(color-[ab]-rgb|band-(index|position|color|count|steps)|bands-minus-one|quantized|fill(-clamped)?|filled-band)$/.test(id) ? 'bands'
        : 'height',
  };
  return undefined;
}
