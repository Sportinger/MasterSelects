import type { EffectPresentationPlan } from './effectPresentationPlans';

/** Folder names and port labels of the Kaleidoscope, Mirror, RGB Split, Pixelate, Blockify and Block Mosaic recipes. */
const READ = /-(mirrored-uv|clamped-uv|edge-uv|sample|low-px|high-uv|high-px|low-min|high-min|inside-px|inside-centered|coverage|weight|read)$/;
const STRAIGHT = /^cell-(split|alpha|alpha-floor|safe-alpha|rgb)$/;
const COMMON_PORTS = { 'source-cache': 'Premultiplied Source', 'result:image': 'Result', 'one-vec2': '(1, 1)' };
const SPACE_PORTS = { 'space-center': 'Centre', 'space-scale': 'Shape Scale', 'space-p': 'Offset', 'space-p-split:x': 'Offset X', 'space-p-split:y': 'Offset Y' };
const CELL_PORTS = { 'pixel-scale': 'Pixel Scale', 'cell-px': 'Cell (px)', 'tile-px': 'Tile (px)', 'tile-size': 'Tile Size', pixel: 'Pixel', origin: 'Grid Origin',
  'from-origin': 'From Origin', 'grid-start': 'Cell Start', 'grid-end': 'Cell End', 'grid-low': 'Cell Start (in frame)', 'grid-high': 'Cell End (in frame)',
  'row-count': 'Cell Width', 'column-count': 'Cell Height', 'row-taps': 'Taps', 'column-taps': 'Taps', 'row-position': 'Read Pixel', 'column-position': 'Read Pixel',
  'row-weight': 'Texels Read', 'column-weight': 'Texels Read', 'row-cache': 'Row Averages', 'column-image': 'Cell Average', 'cell-rgb': 'Cell Colour',
  'row-sequence:index': 'Tap Index', 'column-sequence:index': 'Tap Index', poster: 'Posterized', 'levels-count': 'Levels', 'mix-amount': 'Amount (0–1)',
  'is-large': 'Large Tile', 'large-px': 'Large Tile (px)', hash: 'Random', 'time-step': 'Shuffle Step', 'grout-px': 'Grout (px)', 'edge-distance': 'Distance to Edge',
  'tile-coverage': 'Tile Coverage', mosaic: 'Tiles & Grout', 'mixed-image': 'Mixed', 'large-position': 'Large Grid Position', 'large-index': 'Large Tile Index',
  'hash-input': 'Shuffled Index', 'grid-low-split:x': 'Cell Start X', 'grid-high-split:x': 'Cell End X', 'grid-low-split:y': 'Cell Start Y',
  'grid-high-split:y': 'Cell End Y', 'resolution-split:x': 'Frame Width', 'resolution-split:y': 'Frame Height', 'uv-split:x': 'UV X', 'uv-split:y': 'UV Y' };

export function mirrorPixelPresentationPlan(type: string): EffectPresentationPlan | undefined {
  const finish = (id: string) => /^(result|coverage-floor)/.test(id);
  if (type === 'kaleidoscope') return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Centre & Shape', fold: 'Wedge Fold', reads: 'Frame Edges & Reads', finish: 'Crossfade & Straight Alpha' },
    portLabels: { ...COMMON_PORTS, ...SPACE_PORTS, 'base-angle': 'Angle', angle: 'Turned Angle', 'source-angle': 'Source Angle', radius: 'Radius',
      'read-radius': 'Read Radius', 'segment-count': 'Segments', 'segments-low': 'Fewer Segments', 'segments-high': 'More Segments', 'segments-blend': 'Crossfade',
      'fold-low-folded': 'Folded Angle', 'fold-high-folded': 'Folded Angle', 'fold-low-position-uv': 'Read Position', 'fold-high-position-uv': 'Read Position',
      'fold-mix': 'Crossfaded', 'fold-low-wedge': 'Wedge', 'fold-high-wedge': 'Wedge', 'fold-low-turned': 'Read Angle', 'fold-high-turned': 'Read Angle',
      'fold-low-moved': 'Read Offset', 'fold-high-moved': 'Read Offset' },
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : finish(id) || /^fold-(mix|image|low-vec4|high-vec4)$/.test(id) ? 'finish'
      : /^edge-/.test(id) || /^fold-(low|high)/.test(id) && READ.test(id) ? 'reads'
        : /^space-/.test(id) || id === 'one-vec2' ? 'space' : 'fold',
  };
  if (type === 'mirror') return {
    labels: { premultiply: 'Premultiplied Source (cached)', space: 'Centre', reflect: 'Mirror Lines', reads: 'Frame Edges & Read', finish: 'Straight Alpha Output' },
    portLabels: { ...COMMON_PORTS, ...SPACE_PORTS, local: 'Turned Offset', 'keep-sign': 'Kept Side', reflected: 'Reflected Offset', moved: 'Turned Back',
      'mirror-position-uv': 'Read Position' },
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : finish(id) ? 'finish'
      : /^edge-/.test(id) || /^mirror-/.test(id) && READ.test(id) ? 'reads' : /^space-/.test(id) || id === 'one-vec2' ? 'space' : 'reflect',
  };
  if (type === 'rgb-split') return {
    labels: { premultiply: 'Premultiplied Source (cached)', offset: 'Split Offset', reads: 'Channel Reads & Frame Edges', finish: 'Channel Merge & Straight Alpha' },
    portLabels: { ...COMMON_PORTS, direction: 'Direction', 'length-px': 'Length (px)', 'linear-offset': 'Offset', 'lens-offset': 'Lens Offset', offset: 'Split Offset',
      'red-uv': 'Red Read', 'blue-uv': 'Blue Read', 'red-vec4': 'Red Plate', 'green-vec4': 'Green Plate', 'blue-vec4': 'Blue Plate',
      alpha: 'Union Alpha', combined: 'Merged Channels' },
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : finish(id) || /^(red|green|blue)-(vec4|split)$|^alpha|^combined/.test(id) ? 'finish'
      : /^edge-|^green-read$/.test(id) || /^(red|blue)-/.test(id) && READ.test(id) ? 'reads' : 'offset',
  };
  if (['pixelate', 'blockify', 'block-mosaic'].includes(type)) return {
    labels: { premultiply: 'Premultiplied Source (cached)', size: 'Cell Size', position: 'Pixel Position', grid: 'Centred Cell Grid', tiles: 'Large Tiles', row: 'Row Average (cached)',
      column: 'Column Average', poster: 'Posterize', grout: 'Grout', mix: 'Mix with Original', finish: 'Straight Alpha Output' },
    portLabels: { ...COMMON_PORTS, ...CELL_PORTS },
    stage: ({ id }) => /^source-/.test(id) ? 'premultiply' : finish(id) ? 'finish'
      : /^row-/.test(id) || id === 'pairs-limit' ? 'row' : /^column-/.test(id) ? 'column'
        : /^(cell-px|tile-px|short-side|pixel-scale)/.test(id) ? 'size'
          : /^(levels|poster)/.test(id) || type === 'blockify' && STRAIGHT.test(id) ? 'poster'
            : /^(grout|edge-|tile-inside|tile-coverage|mosaic$)/.test(id) || STRAIGHT.test(id) ? 'grout'
              : /^(effect-|original|mix-|mixed)/.test(id) ? 'mix'
                : /^(large-|time-|hash|is-large|tile-size)/.test(id) ? 'tiles'
                  : /^(pixel|origin-raw|origin|from-origin|zero-vec2|half-vec2)$/.test(id) ? 'position' : 'grid',
  };
  return undefined;
}
