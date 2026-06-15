import {
  TRANSITION_DIRECTIONS,
  getTransitionFamilyDimension,
  getTransitionFamilyGroup,
  type DissolveTransitionOption,
  type DipTransitionOption,
  type GlitchTransitionOption,
  type LightTransitionOption,
  type MotionBlurTransitionOption,
  type RotateTransitionOption,
  type StylizeTransitionOption,
  type ThreeDTransitionOption,
  type TransitionDefinition,
  type TransitionFamilyDimension,
  type WipeTransitionOption,
} from '../../../transitions';

interface TransitionSelectOption {
  value: string;
  label: string;
  dimension: TransitionFamilyDimension;
}

export interface TransitionSelectOptionGroup {
  dimension: TransitionFamilyDimension;
  label: string;
  options: TransitionSelectOption[];
}

export const DIP_OPTIONS: readonly DipTransitionOption[] = ['black', 'white', 'custom'];

export const DIP_SWATCHES: Record<DipTransitionOption, string> = {
  black: '#050505',
  white: '#f4f4f5',
  custom: '#000000',
};

const THREE_D_SELECT_ORDER: Record<string, number> = {
  flip: 0,
  tumble: 1,
  roll: 2,
  spin: 3,
};

export function getTransitionSelectOptionGroups(
  transitions: readonly TransitionDefinition[],
): TransitionSelectOptionGroup[] {
  const seen = new Set<string>();
  const options = transitions.flatMap((candidate): TransitionSelectOption[] => {
    const family = getTransitionFamilyGroup(candidate.id);
    const value = family?.id ?? candidate.id;
    if (seen.has(value)) return [];
    seen.add(value);
    return [{
      value,
      label: family?.label ?? candidate.name,
      dimension: family?.dimension ?? getTransitionFamilyDimension(candidate.id),
    }];
  });
  const groups: TransitionSelectOptionGroup[] = [
    {
      dimension: '2d',
      label: '2D',
      options: options.filter((option) => option.dimension === '2d'),
    },
    {
      dimension: '3d',
      label: '3D',
      options: options
        .filter((option) => option.dimension === '3d')
        .toSorted((a, b) => (THREE_D_SELECT_ORDER[a.value] ?? 99) - (THREE_D_SELECT_ORDER[b.value] ?? 99)),
    },
  ];
  return groups.filter((group) => group.options.length > 0);
}

export function getDissolveGlyphClass(option: DissolveTransitionOption): string {
  if (option === 'blur-dissolve') return 'transition-dissolve-glyph-blur';
  if (option === 'additive-dissolve') return 'transition-dissolve-glyph-add';
  if (option === 'non-additive-dissolve') return 'transition-dissolve-glyph-dark';
  return 'transition-dissolve-glyph-cross';
}

export function getMotionBlurGlyphClass(option: MotionBlurTransitionOption): string {
  return option === 'whip-pan'
    ? 'transition-motion-blur-glyph-whip'
    : 'transition-motion-blur-glyph-directional';
}

export function isDirectionOption(option: WipeTransitionOption): option is (typeof TRANSITION_DIRECTIONS)[number] {
  return (TRANSITION_DIRECTIONS as readonly string[]).includes(option);
}

export function getThreeDGlyphClass(option: ThreeDTransitionOption): string {
  if (option === 'flip-horizontal') return 'transition-three-d-glyph-flip-horizontal';
  if (option === 'flip-vertical') return 'transition-three-d-glyph-flip-vertical';
  if (option === 'card-spin') return 'transition-three-d-glyph-card-spin';
  if (option === 'roll-3d') return 'transition-three-d-glyph-roll';
  if (option === 'spinback-3d') return 'transition-three-d-glyph-spinback';
  return 'transition-three-d-glyph-tumble-away';
}

export function getLightGlyphClass(option: LightTransitionOption): string {
  if (option === 'light-leak') return 'transition-light-glyph-leak';
  if (option === 'light-sweep') return 'transition-light-glyph-sweep';
  if (option === 'chroma-leak') return 'transition-light-glyph-leak';
  if (option === 'lens-flare') return 'transition-light-glyph-sweep';
  if (option === 'film-burn') return 'transition-light-glyph-flash';
  if (option === 'projector-flicker') return 'transition-light-glyph-flicker';
  if (option === 'film-roll') return 'transition-light-glyph-film-roll';
  if (option === 'vignette-bloom') return 'transition-light-glyph-bloom';
  return 'transition-light-glyph-flash';
}

export function getGlitchGlyphClass(option: GlitchTransitionOption): string {
  if (option === 'block-glitch') return 'transition-glitch-glyph-blocks';
  if (option === 'rgb-split-glitch') return 'transition-glitch-glyph-rgb';
  if (option === 'mosaic-glitch') return 'transition-glitch-glyph-mosaic';
  if (option === 'scanline-glitch') return 'transition-glitch-glyph-scanline';
  return 'transition-glitch-glyph-crt';
}

export function getPatternGlyphClass(option: string): string {
  if (option === 'checker') return 'transition-pattern-glyph-checker';
  if (option === 'doom-bars') return 'transition-pattern-glyph-doom-bars';
  if (option === 'paint-splatter') return 'transition-pattern-glyph-paint-splatter';
  if (option === 'polka-dot') return 'transition-pattern-glyph-polka-dot';
  if (option === 'puzzle-push') return 'transition-pattern-glyph-puzzle';
  if (option === 'magnetic-tiles') return 'transition-pattern-glyph-magnetic';
  if (option === 'random-blocks') return 'transition-pattern-glyph-random-blocks';
  if (option === 'venetian-horizontal') return 'transition-pattern-glyph-venetian-horizontal';
  if (option === 'venetian-vertical') return 'transition-pattern-glyph-venetian-vertical';
  return 'transition-pattern-glyph-zig-zag';
}

export function getZoomGlyphClass(option: string): string {
  if (option === 'zoom-in') return 'transition-zoom-glyph-in';
  if (option === 'zoom-out') return 'transition-zoom-glyph-out';
  if (option === 'zoom-blur') return 'transition-zoom-glyph-blur';
  return 'transition-zoom-glyph-spin';
}

export function getStylizeGlyphClass(option: StylizeTransitionOption): string {
  if (option === 'noise-dissolve') return 'transition-stylize-glyph-noise';
  if (option === 'kaleidoscope') return 'transition-stylize-glyph-kaleidoscope';
  if (option === 'water-drop' || option === 'swirl') return 'transition-stylize-glyph-noise';
  return 'transition-stylize-glyph-noise';
}

export function getRotateGlyphClass(option: RotateTransitionOption): string {
  if (option === 'rotate-left') return 'transition-stylize-glyph-rotate-left';
  if (option === 'rotate-right') return 'transition-stylize-glyph-rotate-right';
  return 'transition-stylize-glyph-rotate-90';
}
