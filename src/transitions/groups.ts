import type { TransitionType, TransitionWipeDirection } from './types';
import {
  THREE_D_TRANSITION_GROUPS,
  type ThreeDTransitionFamily,
  type ThreeDTransitionOption,
} from './threeDTransitionGroups';
export {
  THREE_D_TRANSITION_GROUPS,
  getThreeDTransitionGroup,
  getThreeDTransitionOption,
  type ThreeDTransitionFamily,
  type ThreeDTransitionGroup,
  type ThreeDTransitionOption,
} from './threeDTransitionGroups';

export type DirectionalTransitionFamily = 'push' | 'slide';

export type DissolveTransitionOption =
  | 'crossfade'
  | 'blur-dissolve'
  | 'additive-dissolve'
  | 'non-additive-dissolve'
  | 'smooth-cut'
  | 'flow'
  | 'luma-fade';

export type DipTransitionOption = 'black' | 'white' | 'custom';

export type IrisTransitionOption = 'circle' | 'oval' | 'diamond' | 'square' | 'triangle' | 'cross' | 'star';

export type LightTransitionOption =
  | 'flash'
  | 'light-leak'
  | 'light-sweep'
  | 'chroma-leak'
  | 'lens-flare'
  | 'film-burn'
  | 'projector-flicker'
  | 'film-roll'
  | 'vignette-bloom'
  | 'smoke-reveal'
  | 'portal-ring';

export type MotionBlurTransitionOption = 'directional-blur' | 'whip-pan';

export type GlitchTransitionOption =
  | 'block-glitch'
  | 'crt-collapse'
  | 'rgb-split-glitch'
  | 'mosaic-glitch'
  | 'scanline-glitch'
  | 'datamosh'
  | 'signal-tear'
  | 'data-corrupt'
  | 'vhs-head-switch';

export type PatternTransitionOption =
  | 'checker'
  | 'random-blocks'
  | 'paint-splatter'
  | 'polka-dot'
  | 'doom-bars'
  | 'venetian-horizontal'
  | 'venetian-vertical'
  | 'zig-zag'
  | 'hex-pixelize'
  | 'ink-bleed'
  | 'puzzle-push'
  | 'shatter-glass'
  | 'magnetic-tiles';

export type StylizeTransitionOption =
  | 'noise-dissolve'
  | 'water-drop'
  | 'swirl'
  | 'kaleidoscope'
  | 'liquid-melt'
  | 'fly-eye'
  | 'thermal-bloom'
  | 'neural-dream';
export type RotateTransitionOption = 'rotate-left' | 'rotate-right' | 'rotate-90';

export type WipeTransitionOption = TransitionWipeDirection | 'center' | 'clock' | 'barn-horizontal' | 'barn-vertical';

export type ZoomTransitionOption = 'zoom-in' | 'zoom-out' | 'spin-zoom' | 'zoom-blur';

export type TransitionFamilyDimension = '2d' | '3d';

export type TransitionFamilyId = ThreeDTransitionFamily | 'dip' | 'dissolve' | 'glitch' | 'iris' | 'light' | 'motion-blur' | 'pattern' | 'push' | 'rotate' | 'slide' | 'stylize' | 'wipe' | 'zoom';

export interface DirectionalTransitionGroup {
  id: DirectionalTransitionFamily;
  label: string;
  transitions: Record<TransitionWipeDirection, TransitionType>;
}

export interface DissolveTransitionGroup {
  id: 'dissolve';
  label: string;
  defaultType: TransitionType;
  transitions: Record<DissolveTransitionOption, TransitionType>;
}

export interface WipeTransitionGroup {
  id: 'wipe';
  label: string;
  defaultType: TransitionType;
  transitions: Record<WipeTransitionOption, TransitionType>;
}

export interface DipTransitionGroup {
  id: 'dip';
  label: string;
  defaultType: TransitionType;
  transitions: Record<DipTransitionOption, TransitionType>;
}

export interface IrisTransitionGroup {
  id: 'iris';
  label: string;
  defaultType: TransitionType;
  transitions: Record<IrisTransitionOption, TransitionType>;
}

export interface LightTransitionGroup {
  id: 'light';
  label: string;
  defaultType: TransitionType;
  transitions: Record<LightTransitionOption, TransitionType>;
}

export interface MotionBlurTransitionGroup {
  id: 'motion-blur';
  label: string;
  defaultType: TransitionType;
  transitions: Record<MotionBlurTransitionOption, TransitionType>;
}

export interface GlitchTransitionGroup {
  id: 'glitch';
  label: string;
  defaultType: TransitionType;
  transitions: Record<GlitchTransitionOption, TransitionType>;
}

export interface PatternTransitionGroup {
  id: 'pattern';
  label: string;
  defaultType: TransitionType;
  transitions: Record<PatternTransitionOption, TransitionType>;
}

export interface StylizeTransitionGroup {
  id: 'stylize';
  label: string;
  defaultType: TransitionType;
  transitions: Record<StylizeTransitionOption, TransitionType>;
}

export interface RotateTransitionGroup {
  id: 'rotate';
  label: string;
  defaultType: TransitionType;
  transitions: Record<RotateTransitionOption, TransitionType>;
}

export interface ZoomTransitionGroup {
  id: 'zoom';
  label: string;
  defaultType: TransitionType;
  transitions: Record<ZoomTransitionOption, TransitionType>;
}

export interface TransitionFamilyGroup {
  id: TransitionFamilyId;
  label: string;
  dimension: TransitionFamilyDimension;
  defaultType: TransitionType;
  types: readonly TransitionType[];
}

export const TRANSITION_DIRECTIONS: readonly TransitionWipeDirection[] = [
  'left',
  'right',
  'up',
  'down',
];

export const TRANSITION_DIRECTION_LABELS: Record<TransitionWipeDirection, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
};

export const DISSOLVE_TRANSITION_GROUP: DissolveTransitionGroup = {
  id: 'dissolve',
  label: 'Dissolve',
  defaultType: 'crossfade',
  transitions: {
    crossfade: 'crossfade',
    'blur-dissolve': 'blur-dissolve',
    'additive-dissolve': 'additive-dissolve',
    'non-additive-dissolve': 'non-additive-dissolve',
    'smooth-cut': 'smooth-cut',
    flow: 'flow',
    'luma-fade': 'luma-fade',
  },
};

export const DISSOLVE_TRANSITION_OPTION_LABELS: Record<DissolveTransitionOption, string> = {
  crossfade: 'Cross',
  'blur-dissolve': 'Blur',
  'additive-dissolve': 'Add',
  'non-additive-dissolve': 'Dark',
  'smooth-cut': 'Smooth',
  flow: 'Flow',
  'luma-fade': 'Luma',
};

export const DISSOLVE_TRANSITION_OPTIONS: readonly DissolveTransitionOption[] = [
  'crossfade',
  'blur-dissolve',
  'additive-dissolve',
  'non-additive-dissolve',
  'smooth-cut',
  'flow',
  'luma-fade',
];

export const WIPE_TRANSITION_GROUP: WipeTransitionGroup = {
  id: 'wipe',
  label: 'Wipe',
  defaultType: 'wipe-left',
  transitions: {
    left: 'wipe-left',
    right: 'wipe-right',
    up: 'wipe-up',
    down: 'wipe-down',
    center: 'center-wipe',
    clock: 'clock-wipe',
    'barn-horizontal': 'barn-door-horizontal',
    'barn-vertical': 'barn-door-vertical',
  },
};

export const DIRECTIONAL_TRANSITION_GROUPS: readonly DirectionalTransitionGroup[] = [
  {
    id: 'push',
    label: 'Push',
    transitions: {
      left: 'push-left',
      right: 'push-right',
      up: 'push-up',
      down: 'push-down',
    },
  },
  {
    id: 'slide',
    label: 'Slide',
    transitions: {
      left: 'slide-left',
      right: 'slide-right',
      up: 'slide-up',
      down: 'slide-down',
    },
  },
];

export const DIP_TRANSITION_GROUP: DipTransitionGroup = {
  id: 'dip',
  label: 'Dip',
  defaultType: 'dip-to-black',
  transitions: {
    black: 'dip-to-black',
    white: 'dip-to-white',
    custom: 'dip-to-color',
  },
};

export const DIP_TRANSITION_OPTION_LABELS: Record<DipTransitionOption, string> = {
  black: 'Black',
  white: 'White',
  custom: 'Color',
};

export const IRIS_TRANSITION_GROUP: IrisTransitionGroup = {
  id: 'iris',
  label: 'Iris',
  defaultType: 'circle-iris',
  transitions: {
    circle: 'circle-iris',
    oval: 'oval-iris',
    diamond: 'diamond-iris',
    square: 'square-iris',
    triangle: 'triangle-iris',
    cross: 'cross-iris',
    star: 'star-iris',
  },
};

export const IRIS_TRANSITION_OPTION_LABELS: Record<IrisTransitionOption, string> = {
  circle: 'Circle',
  oval: 'Oval',
  diamond: 'Diamond',
  square: 'Square',
  triangle: 'Triangle',
  cross: 'Cross',
  star: 'Star',
};

export const THREE_D_TRANSITION_OPTION_LABELS: Record<ThreeDTransitionOption, string> = {
  'flip-horizontal': 'Flip H',
  'flip-vertical': 'Flip V',
  'card-spin': 'Card Spin',
  'tumble-away': 'Tumble',
  'roll-3d': '3D Roll',
  'spinback-3d': 'Spinback',
  'cube-3d': 'Cube',
  'door-3d': 'Door',
  'fold-3d': 'Fold',
  'origami-fold': 'Origami',
  'page-peel': 'Peel',
};

export const LIGHT_TRANSITION_GROUP: LightTransitionGroup = {
  id: 'light',
  label: 'Light',
  defaultType: 'flash',
  transitions: {
    flash: 'flash',
    'light-leak': 'light-leak',
    'light-sweep': 'light-sweep',
    'chroma-leak': 'chroma-leak',
    'lens-flare': 'lens-flare',
    'film-burn': 'film-burn',
    'projector-flicker': 'projector-flicker',
    'film-roll': 'film-roll',
    'vignette-bloom': 'vignette-bloom',
    'smoke-reveal': 'smoke-reveal',
    'portal-ring': 'portal-ring',
  },
};

export const LIGHT_TRANSITION_OPTION_LABELS: Record<LightTransitionOption, string> = {
  flash: 'Flash',
  'light-leak': 'Leak',
  'light-sweep': 'Sweep',
  'chroma-leak': 'Chroma',
  'lens-flare': 'Flare',
  'film-burn': 'Burn',
  'projector-flicker': 'Flicker',
  'film-roll': 'Film Roll',
  'vignette-bloom': 'Bloom',
  'smoke-reveal': 'Smoke',
  'portal-ring': 'Portal',
};

export const LIGHT_TRANSITION_OPTIONS: readonly LightTransitionOption[] = [
  'flash',
  'light-leak',
  'light-sweep',
  'chroma-leak',
  'lens-flare',
  'film-burn',
  'projector-flicker',
  'film-roll',
  'vignette-bloom',
  'smoke-reveal',
  'portal-ring',
];

export const MOTION_BLUR_TRANSITION_GROUP: MotionBlurTransitionGroup = {
  id: 'motion-blur',
  label: 'Motion Blur',
  defaultType: 'directional-blur',
  transitions: {
    'directional-blur': 'directional-blur',
    'whip-pan': 'whip-pan',
  },
};

export const MOTION_BLUR_TRANSITION_OPTION_LABELS: Record<MotionBlurTransitionOption, string> = {
  'directional-blur': 'Directional',
  'whip-pan': 'Whip Pan',
};

export const MOTION_BLUR_TRANSITION_OPTIONS: readonly MotionBlurTransitionOption[] = [
  'directional-blur',
  'whip-pan',
];

export const GLITCH_TRANSITION_GROUP: GlitchTransitionGroup = {
  id: 'glitch',
  label: 'Glitch',
  defaultType: 'block-glitch',
  transitions: {
    'block-glitch': 'block-glitch',
    'crt-collapse': 'crt-collapse',
    'rgb-split-glitch': 'rgb-split-glitch',
    'mosaic-glitch': 'mosaic-glitch',
    'scanline-glitch': 'scanline-glitch',
    datamosh: 'datamosh',
    'signal-tear': 'signal-tear',
    'data-corrupt': 'data-corrupt',
    'vhs-head-switch': 'vhs-head-switch',
  },
};

export const GLITCH_TRANSITION_OPTION_LABELS: Record<GlitchTransitionOption, string> = {
  'block-glitch': 'Blocks',
  'crt-collapse': 'CRT',
  'rgb-split-glitch': 'RGB',
  'mosaic-glitch': 'Mosaic',
  'scanline-glitch': 'Lines',
  datamosh: 'Datamosh',
  'signal-tear': 'Tear',
  'data-corrupt': 'Corrupt',
  'vhs-head-switch': 'VHS',
};

export const GLITCH_TRANSITION_OPTIONS: readonly GlitchTransitionOption[] = [
  'block-glitch',
  'crt-collapse',
  'rgb-split-glitch',
  'mosaic-glitch',
  'scanline-glitch',
  'datamosh',
  'signal-tear',
  'data-corrupt',
  'vhs-head-switch',
];

export const PATTERN_TRANSITION_GROUP: PatternTransitionGroup = {
  id: 'pattern',
  label: 'Pattern',
  defaultType: 'checker-wipe',
  transitions: {
    checker: 'checker-wipe',
    'random-blocks': 'random-blocks',
    'paint-splatter': 'paint-splatter',
    'polka-dot': 'polka-dot-curtain',
    'doom-bars': 'doom-bars',
    'venetian-horizontal': 'venetian-blinds-horizontal',
    'venetian-vertical': 'venetian-blinds-vertical',
    'zig-zag': 'zig-zag-blocks',
    'hex-pixelize': 'hex-pixelize',
    'ink-bleed': 'ink-bleed',
    'puzzle-push': 'puzzle-push',
    'shatter-glass': 'shatter-glass',
    'magnetic-tiles': 'magnetic-tiles',
  },
};

export const PATTERN_TRANSITION_OPTION_LABELS: Record<PatternTransitionOption, string> = {
  checker: 'Checker',
  'random-blocks': 'Random',
  'paint-splatter': 'Splat',
  'polka-dot': 'Dots',
  'doom-bars': 'Bars',
  'venetian-horizontal': 'Blinds H',
  'venetian-vertical': 'Blinds V',
  'zig-zag': 'Zig-Zag',
  'hex-pixelize': 'Hex',
  'ink-bleed': 'Ink',
  'puzzle-push': 'Puzzle',
  'shatter-glass': 'Shatter',
  'magnetic-tiles': 'Magnetic',
};

export const PATTERN_TRANSITION_OPTIONS: readonly PatternTransitionOption[] = [
  'checker',
  'random-blocks',
  'paint-splatter',
  'polka-dot',
  'doom-bars',
  'venetian-horizontal',
  'venetian-vertical',
  'zig-zag',
  'hex-pixelize',
  'ink-bleed',
  'puzzle-push',
  'shatter-glass',
  'magnetic-tiles',
];

export const STYLIZE_TRANSITION_GROUP: StylizeTransitionGroup = {
  id: 'stylize',
  label: 'Stylize',
  defaultType: 'noise-dissolve',
  transitions: {
    'noise-dissolve': 'noise-dissolve',
    'water-drop': 'water-drop',
    swirl: 'swirl',
    kaleidoscope: 'kaleidoscope',
    'liquid-melt': 'liquid-melt',
    'fly-eye': 'fly-eye',
    'thermal-bloom': 'thermal-bloom',
    'neural-dream': 'neural-dream',
  },
};

export const STYLIZE_TRANSITION_OPTION_LABELS: Record<StylizeTransitionOption, string> = {
  'noise-dissolve': 'Noise',
  'water-drop': 'Water',
  swirl: 'Swirl',
  kaleidoscope: 'Kaleido',
  'liquid-melt': 'Melt',
  'fly-eye': 'Fly Eye',
  'thermal-bloom': 'Thermal',
  'neural-dream': 'Dream',
};

export const STYLIZE_TRANSITION_OPTIONS: readonly StylizeTransitionOption[] = [
  'noise-dissolve',
  'water-drop',
  'swirl',
  'kaleidoscope',
  'liquid-melt',
  'fly-eye',
  'thermal-bloom',
  'neural-dream',
];

export const ROTATE_TRANSITION_GROUP: RotateTransitionGroup = {
  id: 'rotate',
  label: 'Rotate',
  defaultType: 'rotate-left',
  transitions: {
    'rotate-left': 'rotate-left',
    'rotate-right': 'rotate-right',
    'rotate-90': 'rotate-90',
  },
};

export const ROTATE_TRANSITION_OPTION_LABELS: Record<RotateTransitionOption, string> = {
  'rotate-left': 'Rotate L',
  'rotate-right': 'Rotate R',
  'rotate-90': 'Rotate 90',
};

export const ROTATE_TRANSITION_OPTIONS: readonly RotateTransitionOption[] = [
  'rotate-left',
  'rotate-right',
  'rotate-90',
];

export const ZOOM_TRANSITION_GROUP: ZoomTransitionGroup = {
  id: 'zoom',
  label: 'Zoom',
  defaultType: 'zoom-in',
  transitions: {
    'zoom-in': 'zoom-in',
    'zoom-out': 'zoom-out',
    'spin-zoom': 'spin-zoom',
    'zoom-blur': 'zoom-blur',
  },
};

export const ZOOM_TRANSITION_OPTION_LABELS: Record<ZoomTransitionOption, string> = {
  'zoom-in': 'Zoom In',
  'zoom-out': 'Zoom Out',
  'spin-zoom': 'Spin',
  'zoom-blur': 'Blur',
};

export const ZOOM_TRANSITION_OPTIONS: readonly ZoomTransitionOption[] = [
  'zoom-in',
  'zoom-out',
  'spin-zoom',
  'zoom-blur',
];

export const WIPE_TRANSITION_OPTION_LABELS: Record<WipeTransitionOption, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  center: 'Center',
  clock: 'Clock',
  'barn-horizontal': 'Barn H',
  'barn-vertical': 'Barn V',
};

export const WIPE_TRANSITION_OPTIONS: readonly WipeTransitionOption[] = [
  'left',
  'right',
  'up',
  'down',
  'center',
  'clock',
  'barn-horizontal',
  'barn-vertical',
];

export const IRIS_TRANSITION_OPTIONS: readonly IrisTransitionOption[] = [
  'circle',
  'oval',
  'diamond',
  'square',
  'triangle',
  'cross',
  'star',
];

export const TRANSITION_FAMILY_GROUPS: readonly TransitionFamilyGroup[] = [
  {
    id: DISSOLVE_TRANSITION_GROUP.id,
    label: DISSOLVE_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: DISSOLVE_TRANSITION_GROUP.defaultType,
    types: Object.values(DISSOLVE_TRANSITION_GROUP.transitions),
  },
  {
    id: DIP_TRANSITION_GROUP.id,
    label: DIP_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: DIP_TRANSITION_GROUP.defaultType,
    types: Object.values(DIP_TRANSITION_GROUP.transitions),
  },
  {
    id: WIPE_TRANSITION_GROUP.id,
    label: WIPE_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: WIPE_TRANSITION_GROUP.defaultType,
    types: Object.values(WIPE_TRANSITION_GROUP.transitions),
  },
  {
    id: IRIS_TRANSITION_GROUP.id,
    label: IRIS_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: IRIS_TRANSITION_GROUP.defaultType,
    types: Object.values(IRIS_TRANSITION_GROUP.transitions),
  },
  ...THREE_D_TRANSITION_GROUPS.map((group): TransitionFamilyGroup => ({
    id: group.id,
    label: group.label,
    dimension: '3d',
    defaultType: group.defaultType,
    types: Object.values(group.transitions).filter((type): type is TransitionType => Boolean(type)),
  })),
  {
    id: LIGHT_TRANSITION_GROUP.id,
    label: LIGHT_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: LIGHT_TRANSITION_GROUP.defaultType,
    types: Object.values(LIGHT_TRANSITION_GROUP.transitions),
  },
  {
    id: MOTION_BLUR_TRANSITION_GROUP.id,
    label: MOTION_BLUR_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: MOTION_BLUR_TRANSITION_GROUP.defaultType,
    types: Object.values(MOTION_BLUR_TRANSITION_GROUP.transitions),
  },
  {
    id: GLITCH_TRANSITION_GROUP.id,
    label: GLITCH_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: GLITCH_TRANSITION_GROUP.defaultType,
    types: Object.values(GLITCH_TRANSITION_GROUP.transitions),
  },
  {
    id: PATTERN_TRANSITION_GROUP.id,
    label: PATTERN_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: PATTERN_TRANSITION_GROUP.defaultType,
    types: Object.values(PATTERN_TRANSITION_GROUP.transitions),
  },
  {
    id: STYLIZE_TRANSITION_GROUP.id,
    label: STYLIZE_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: STYLIZE_TRANSITION_GROUP.defaultType,
    types: Object.values(STYLIZE_TRANSITION_GROUP.transitions),
  },
  {
    id: ROTATE_TRANSITION_GROUP.id,
    label: ROTATE_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: ROTATE_TRANSITION_GROUP.defaultType,
    types: Object.values(ROTATE_TRANSITION_GROUP.transitions),
  },
  {
    id: ZOOM_TRANSITION_GROUP.id,
    label: ZOOM_TRANSITION_GROUP.label,
    dimension: '2d',
    defaultType: ZOOM_TRANSITION_GROUP.defaultType,
    types: Object.values(ZOOM_TRANSITION_GROUP.transitions),
  },
  ...DIRECTIONAL_TRANSITION_GROUPS.map((group): TransitionFamilyGroup => ({
    id: group.id,
    label: group.label,
    dimension: '2d',
    defaultType: group.transitions.left,
    types: Object.values(group.transitions),
  })),
];

export function getDirectionalTransitionGroup(type: string): DirectionalTransitionGroup | undefined {
  return DIRECTIONAL_TRANSITION_GROUPS.find((group) =>
    TRANSITION_DIRECTIONS.some((direction) => group.transitions[direction] === type)
  );
}

export function getTransitionDirection(type: string): TransitionWipeDirection | undefined {
  const group = getDirectionalTransitionGroup(type);
  return group
    ? TRANSITION_DIRECTIONS.find((direction) => group.transitions[direction] === type)
    : undefined;
}

export function getDipTransitionOption(type: string): DipTransitionOption | undefined {
  return (Object.entries(DIP_TRANSITION_GROUP.transitions) as [DipTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getDissolveTransitionOption(type: string): DissolveTransitionOption | undefined {
  return (Object.entries(DISSOLVE_TRANSITION_GROUP.transitions) as [DissolveTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function isDipTransitionType(type: string): boolean {
  return getDipTransitionOption(type) !== undefined;
}

export function getWipeTransitionOption(type: string): WipeTransitionOption | undefined {
  return (Object.entries(WIPE_TRANSITION_GROUP.transitions) as [WipeTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getIrisTransitionOption(type: string): IrisTransitionOption | undefined {
  return (Object.entries(IRIS_TRANSITION_GROUP.transitions) as [IrisTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getLightTransitionOption(type: string): LightTransitionOption | undefined {
  return (Object.entries(LIGHT_TRANSITION_GROUP.transitions) as [LightTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getMotionBlurTransitionOption(type: string): MotionBlurTransitionOption | undefined {
  return (Object.entries(MOTION_BLUR_TRANSITION_GROUP.transitions) as [MotionBlurTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getGlitchTransitionOption(type: string): GlitchTransitionOption | undefined {
  return (Object.entries(GLITCH_TRANSITION_GROUP.transitions) as [GlitchTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getPatternTransitionOption(type: string): PatternTransitionOption | undefined {
  return (Object.entries(PATTERN_TRANSITION_GROUP.transitions) as [PatternTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getStylizeTransitionOption(type: string): StylizeTransitionOption | undefined {
  return (Object.entries(STYLIZE_TRANSITION_GROUP.transitions) as [StylizeTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getRotateTransitionOption(type: string): RotateTransitionOption | undefined {
  return (Object.entries(ROTATE_TRANSITION_GROUP.transitions) as [RotateTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getZoomTransitionOption(type: string): ZoomTransitionOption | undefined {
  return (Object.entries(ZOOM_TRANSITION_GROUP.transitions) as [ZoomTransitionOption, TransitionType][])
    .find(([, transitionType]) => transitionType === type)?.[0];
}

export function getTransitionFamilyGroup(type: string): TransitionFamilyGroup | undefined {
  return TRANSITION_FAMILY_GROUPS.find((group) => group.types.some((transitionType) => transitionType === type));
}

export function getTransitionFamilyById(id: string): TransitionFamilyGroup | undefined {
  return TRANSITION_FAMILY_GROUPS.find((group) => group.id === id);
}

export function getTransitionFamilyDimension(type: string): TransitionFamilyDimension {
  return getTransitionFamilyGroup(type)?.dimension ?? '2d';
}
