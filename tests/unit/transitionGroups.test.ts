import { describe, expect, it } from 'vitest';

import {
  DIP_TRANSITION_GROUP,
  DISSOLVE_TRANSITION_GROUP,
  DIRECTIONAL_TRANSITION_GROUPS,
  GLITCH_TRANSITION_GROUP,
  getDipTransitionOption,
  getDissolveTransitionOption,
  getDirectionalTransitionGroup,
  getGlitchTransitionOption,
  getIrisTransitionOption,
  getLightTransitionOption,
  getMotionBlurTransitionOption,
  getPatternTransitionOption,
  getRotateTransitionOption,
  getStylizeTransitionOption,
  getTransitionFamilyById,
  getTransitionFamilyDimension,
  getTransitionFamilyGroup,
  getTransitionDirection,
  getThreeDTransitionGroup,
  getThreeDTransitionOption,
  getWipeTransitionOption,
  getZoomTransitionOption,
  IRIS_TRANSITION_GROUP,
  LIGHT_TRANSITION_GROUP,
  MOTION_BLUR_TRANSITION_GROUP,
  PATTERN_TRANSITION_GROUP,
  ROTATE_TRANSITION_GROUP,
  STYLIZE_TRANSITION_GROUP,
  THREE_D_TRANSITION_GROUPS,
  WIPE_TRANSITION_GROUP,
  ZOOM_TRANSITION_GROUP,
} from '../../src/transitions';

describe('transition groups', () => {
  it('groups directional push and slide variants by family', () => {
    expect(DIRECTIONAL_TRANSITION_GROUPS.map((group) => group.id)).toEqual(['push', 'slide']);

    expect(getDirectionalTransitionGroup('push-left')?.id).toBe('push');
    expect(getTransitionDirection('push-left')).toBe('left');

    expect(getDirectionalTransitionGroup('slide-down')?.id).toBe('slide');
    expect(getTransitionDirection('slide-down')).toBe('down');

    expect(getDirectionalTransitionGroup('crossfade')).toBeUndefined();
    expect(getTransitionDirection('crossfade')).toBeUndefined();
  });

  it('groups wipe variants under one display family', () => {
    expect(WIPE_TRANSITION_GROUP.transitions).toEqual({
      left: 'wipe-left',
      right: 'wipe-right',
      up: 'wipe-up',
      down: 'wipe-down',
      center: 'center-wipe',
      clock: 'clock-wipe',
      'barn-horizontal': 'barn-door-horizontal',
      'barn-vertical': 'barn-door-vertical',
    });

    expect(getWipeTransitionOption('wipe-up')).toBe('up');
    expect(getWipeTransitionOption('center-wipe')).toBe('center');
    expect(getWipeTransitionOption('clock-wipe')).toBe('clock');
    expect(getWipeTransitionOption('barn-door-horizontal')).toBe('barn-horizontal');
    expect(getWipeTransitionOption('barn-door-vertical')).toBe('barn-vertical');
    expect(getTransitionFamilyGroup('clock-wipe')?.id).toBe('wipe');
    expect(getTransitionFamilyGroup('clock-wipe')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('wipe')?.defaultType).toBe('wipe-left');
    expect(getTransitionFamilyDimension('wipe-left')).toBe('2d');
  });

  it('groups dip variants by color choice', () => {
    expect(DIP_TRANSITION_GROUP.transitions).toEqual({
      black: 'dip-to-black',
      white: 'dip-to-white',
      custom: 'dip-to-color',
    });

    expect(getDipTransitionOption('dip-to-black')).toBe('black');
    expect(getDipTransitionOption('dip-to-white')).toBe('white');
    expect(getDipTransitionOption('dip-to-color')).toBe('custom');
    expect(getDipTransitionOption('wipe-left')).toBeUndefined();
  });

  it('groups dissolve variants under one display family', () => {
    expect(DISSOLVE_TRANSITION_GROUP.transitions).toEqual({
      crossfade: 'crossfade',
      'blur-dissolve': 'blur-dissolve',
      'additive-dissolve': 'additive-dissolve',
      'non-additive-dissolve': 'non-additive-dissolve',
      'smooth-cut': 'smooth-cut',
      flow: 'flow',
      'luma-fade': 'luma-fade',
    });

    expect(getDissolveTransitionOption('crossfade')).toBe('crossfade');
    expect(getDissolveTransitionOption('blur-dissolve')).toBe('blur-dissolve');
    expect(getDissolveTransitionOption('additive-dissolve')).toBe('additive-dissolve');
    expect(getDissolveTransitionOption('non-additive-dissolve')).toBe('non-additive-dissolve');
    expect(getDissolveTransitionOption('smooth-cut')).toBe('smooth-cut');
    expect(getDissolveTransitionOption('flow')).toBe('flow');
    expect(getDissolveTransitionOption('luma-fade')).toBe('luma-fade');
    expect(getTransitionFamilyGroup('crossfade')?.id).toBe('dissolve');
    expect(getTransitionFamilyGroup('blur-dissolve')?.id).toBe('dissolve');
    expect(getTransitionFamilyGroup('additive-dissolve')?.id).toBe('dissolve');
    expect(getTransitionFamilyGroup('non-additive-dissolve')?.id).toBe('dissolve');
    expect(getTransitionFamilyById('dissolve')?.defaultType).toBe('crossfade');
    expect(getTransitionFamilyDimension('non-additive-dissolve')).toBe('2d');
  });

  it('groups iris variants by shape choice', () => {
    expect(IRIS_TRANSITION_GROUP.transitions).toEqual({
      circle: 'circle-iris',
      oval: 'oval-iris',
      diamond: 'diamond-iris',
      square: 'square-iris',
      triangle: 'triangle-iris',
      cross: 'cross-iris',
      star: 'star-iris',
    });

    expect(getIrisTransitionOption('circle-iris')).toBe('circle');
    expect(getIrisTransitionOption('oval-iris')).toBe('oval');
    expect(getIrisTransitionOption('diamond-iris')).toBe('diamond');
    expect(getIrisTransitionOption('square-iris')).toBe('square');
    expect(getIrisTransitionOption('triangle-iris')).toBe('triangle');
    expect(getIrisTransitionOption('cross-iris')).toBe('cross');
    expect(getIrisTransitionOption('star-iris')).toBe('star');
    expect(getTransitionFamilyGroup('diamond-iris')?.id).toBe('iris');
    expect(getTransitionFamilyGroup('diamond-iris')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('iris')?.defaultType).toBe('circle-iris');
  });

  it('groups 3D variants under one display family', () => {
    expect(THREE_D_TRANSITION_GROUPS.map((group) => [group.id, group.transitions])).toEqual([
      ['flip', {
        'flip-horizontal': 'flip-horizontal',
        'flip-vertical': 'flip-vertical',
      }],
      ['tumble', { 'tumble-away': 'tumble-away' }],
      ['roll', { 'roll-3d': 'roll-3d' }],
      ['spin', {
        'card-spin': 'card-spin',
        'spinback-3d': 'spinback-3d',
      }],
      ['cube', { 'cube-3d': 'cube-3d' }],
      ['door', { 'door-3d': 'door-3d' }],
      ['fold', {
        'fold-3d': 'fold-3d',
        'origami-fold': 'origami-fold',
      }],
      ['peel', { 'page-peel': 'page-peel' }],
    ]);

    expect(getThreeDTransitionOption('flip-horizontal')).toBe('flip-horizontal');
    expect(getThreeDTransitionOption('flip-vertical')).toBe('flip-vertical');
    expect(getThreeDTransitionOption('card-spin')).toBe('card-spin');
    expect(getThreeDTransitionOption('tumble-away')).toBe('tumble-away');
    expect(getThreeDTransitionOption('roll-3d')).toBe('roll-3d');
    expect(getThreeDTransitionOption('spinback-3d')).toBe('spinback-3d');
    expect(getThreeDTransitionOption('cube-3d')).toBe('cube-3d');
    expect(getThreeDTransitionOption('door-3d')).toBe('door-3d');
    expect(getThreeDTransitionOption('fold-3d')).toBe('fold-3d');
    expect(getThreeDTransitionOption('origami-fold')).toBe('origami-fold');
    expect(getThreeDTransitionOption('page-peel')).toBe('page-peel');
    expect(getThreeDTransitionGroup('flip-horizontal')?.id).toBe('flip');
    expect(getThreeDTransitionGroup('card-spin')?.id).toBe('spin');
    expect(getTransitionFamilyGroup('card-spin')?.id).toBe('spin');
    expect(getTransitionFamilyGroup('roll-3d')?.id).toBe('roll');
    expect(getTransitionFamilyGroup('spinback-3d')?.id).toBe('spin');
    expect(getTransitionFamilyGroup('card-spin')?.dimension).toBe('3d');
    expect(getTransitionFamilyById('flip')?.defaultType).toBe('flip-horizontal');
    expect(getTransitionFamilyById('tumble')?.defaultType).toBe('tumble-away');
    expect(getTransitionFamilyById('roll')?.defaultType).toBe('roll-3d');
    expect(getTransitionFamilyById('spin')?.defaultType).toBe('card-spin');
    expect(getTransitionFamilyById('cube')?.defaultType).toBe('cube-3d');
    expect(getTransitionFamilyById('door')?.defaultType).toBe('door-3d');
    expect(getTransitionFamilyById('fold')?.defaultType).toBe('fold-3d');
    expect(getTransitionFamilyById('peel')?.defaultType).toBe('page-peel');
    expect(getTransitionFamilyDimension('tumble-away')).toBe('3d');
    expect(getTransitionFamilyDimension('roll-3d')).toBe('3d');
  });

  it('groups light variants under one 2D display family', () => {
    expect(LIGHT_TRANSITION_GROUP.transitions).toEqual({
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
    });

    expect(getLightTransitionOption('flash')).toBe('flash');
    expect(getLightTransitionOption('light-leak')).toBe('light-leak');
    expect(getLightTransitionOption('light-sweep')).toBe('light-sweep');
    expect(getLightTransitionOption('chroma-leak')).toBe('chroma-leak');
    expect(getLightTransitionOption('lens-flare')).toBe('lens-flare');
    expect(getLightTransitionOption('film-burn')).toBe('film-burn');
    expect(getLightTransitionOption('projector-flicker')).toBe('projector-flicker');
    expect(getLightTransitionOption('film-roll')).toBe('film-roll');
    expect(getLightTransitionOption('vignette-bloom')).toBe('vignette-bloom');
    expect(getLightTransitionOption('smoke-reveal')).toBe('smoke-reveal');
    expect(getLightTransitionOption('portal-ring')).toBe('portal-ring');
    expect(getTransitionFamilyGroup('flash')?.id).toBe('light');
    expect(getTransitionFamilyGroup('light-leak')?.id).toBe('light');
    expect(getTransitionFamilyGroup('light-sweep')?.id).toBe('light');
    expect(getTransitionFamilyGroup('chroma-leak')?.id).toBe('light');
    expect(getTransitionFamilyGroup('lens-flare')?.id).toBe('light');
    expect(getTransitionFamilyGroup('film-burn')?.id).toBe('light');
    expect(getTransitionFamilyGroup('projector-flicker')?.id).toBe('light');
    expect(getTransitionFamilyGroup('film-roll')?.id).toBe('light');
    expect(getTransitionFamilyGroup('vignette-bloom')?.id).toBe('light');
    expect(getTransitionFamilyGroup('smoke-reveal')?.id).toBe('light');
    expect(getTransitionFamilyGroup('portal-ring')?.id).toBe('light');
    expect(getTransitionFamilyGroup('flash')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('light')?.defaultType).toBe('flash');
    expect(getTransitionFamilyDimension('flash')).toBe('2d');
  });

  it('groups motion blur variants under one 2D display family', () => {
    expect(MOTION_BLUR_TRANSITION_GROUP.transitions).toEqual({
      'directional-blur': 'directional-blur',
      'whip-pan': 'whip-pan',
    });

    expect(getMotionBlurTransitionOption('directional-blur')).toBe('directional-blur');
    expect(getMotionBlurTransitionOption('whip-pan')).toBe('whip-pan');
    expect(getTransitionFamilyGroup('directional-blur')?.id).toBe('motion-blur');
    expect(getTransitionFamilyGroup('whip-pan')?.id).toBe('motion-blur');
    expect(getTransitionFamilyGroup('whip-pan')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('motion-blur')?.defaultType).toBe('directional-blur');
    expect(getTransitionFamilyDimension('directional-blur')).toBe('2d');
  });

  it('groups glitch variants under one 2D display family', () => {
    expect(GLITCH_TRANSITION_GROUP.transitions).toEqual({
      'block-glitch': 'block-glitch',
      'crt-collapse': 'crt-collapse',
      'rgb-split-glitch': 'rgb-split-glitch',
      'mosaic-glitch': 'mosaic-glitch',
      'scanline-glitch': 'scanline-glitch',
      datamosh: 'datamosh',
      'signal-tear': 'signal-tear',
      'data-corrupt': 'data-corrupt',
      'vhs-head-switch': 'vhs-head-switch',
    });

    expect(getGlitchTransitionOption('block-glitch')).toBe('block-glitch');
    expect(getGlitchTransitionOption('crt-collapse')).toBe('crt-collapse');
    expect(getGlitchTransitionOption('rgb-split-glitch')).toBe('rgb-split-glitch');
    expect(getGlitchTransitionOption('mosaic-glitch')).toBe('mosaic-glitch');
    expect(getGlitchTransitionOption('scanline-glitch')).toBe('scanline-glitch');
    expect(getGlitchTransitionOption('datamosh')).toBe('datamosh');
    expect(getGlitchTransitionOption('signal-tear')).toBe('signal-tear');
    expect(getGlitchTransitionOption('data-corrupt')).toBe('data-corrupt');
    expect(getGlitchTransitionOption('vhs-head-switch')).toBe('vhs-head-switch');
    expect(getTransitionFamilyGroup('block-glitch')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('crt-collapse')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('rgb-split-glitch')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('mosaic-glitch')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('scanline-glitch')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('datamosh')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('signal-tear')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('data-corrupt')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('vhs-head-switch')?.id).toBe('glitch');
    expect(getTransitionFamilyGroup('block-glitch')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('glitch')?.defaultType).toBe('block-glitch');
    expect(getTransitionFamilyDimension('block-glitch')).toBe('2d');
  });

  it('groups pattern variants under one 2D display family', () => {
    expect(PATTERN_TRANSITION_GROUP.transitions).toEqual({
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
    });

    expect(getPatternTransitionOption('checker-wipe')).toBe('checker');
    expect(getPatternTransitionOption('random-blocks')).toBe('random-blocks');
    expect(getPatternTransitionOption('paint-splatter')).toBe('paint-splatter');
    expect(getPatternTransitionOption('polka-dot-curtain')).toBe('polka-dot');
    expect(getPatternTransitionOption('doom-bars')).toBe('doom-bars');
    expect(getPatternTransitionOption('venetian-blinds-horizontal')).toBe('venetian-horizontal');
    expect(getPatternTransitionOption('venetian-blinds-vertical')).toBe('venetian-vertical');
    expect(getPatternTransitionOption('zig-zag-blocks')).toBe('zig-zag');
    expect(getPatternTransitionOption('hex-pixelize')).toBe('hex-pixelize');
    expect(getPatternTransitionOption('ink-bleed')).toBe('ink-bleed');
    expect(getPatternTransitionOption('puzzle-push')).toBe('puzzle-push');
    expect(getPatternTransitionOption('shatter-glass')).toBe('shatter-glass');
    expect(getPatternTransitionOption('magnetic-tiles')).toBe('magnetic-tiles');
    expect(getTransitionFamilyGroup('checker-wipe')?.id).toBe('pattern');
    expect(getTransitionFamilyGroup('checker-wipe')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('pattern')?.defaultType).toBe('checker-wipe');
    expect(getTransitionFamilyDimension('venetian-blinds-horizontal')).toBe('2d');
  });

  it('groups zoom variants under one 2D display family', () => {
    expect(ZOOM_TRANSITION_GROUP.transitions).toEqual({
      'zoom-in': 'zoom-in',
      'zoom-out': 'zoom-out',
      'spin-zoom': 'spin-zoom',
      'zoom-blur': 'zoom-blur',
    });

    expect(getZoomTransitionOption('zoom-in')).toBe('zoom-in');
    expect(getZoomTransitionOption('zoom-out')).toBe('zoom-out');
    expect(getZoomTransitionOption('spin-zoom')).toBe('spin-zoom');
    expect(getZoomTransitionOption('zoom-blur')).toBe('zoom-blur');
    expect(getTransitionFamilyGroup('spin-zoom')?.id).toBe('zoom');
    expect(getTransitionFamilyGroup('zoom-blur')?.id).toBe('zoom');
    expect(getTransitionFamilyGroup('spin-zoom')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('zoom')?.defaultType).toBe('zoom-in');
    expect(getTransitionFamilyDimension('zoom-out')).toBe('2d');
  });

  it('groups stylized variants under one 2D display family', () => {
    expect(STYLIZE_TRANSITION_GROUP.transitions).toEqual({
      'noise-dissolve': 'noise-dissolve',
      'water-drop': 'water-drop',
      swirl: 'swirl',
      kaleidoscope: 'kaleidoscope',
      'liquid-melt': 'liquid-melt',
      'fly-eye': 'fly-eye',
      'thermal-bloom': 'thermal-bloom',
      'neural-dream': 'neural-dream',
    });

    expect(getStylizeTransitionOption('noise-dissolve')).toBe('noise-dissolve');
    expect(getStylizeTransitionOption('rotate-left')).toBeUndefined();
    expect(getStylizeTransitionOption('water-drop')).toBe('water-drop');
    expect(getStylizeTransitionOption('swirl')).toBe('swirl');
    expect(getStylizeTransitionOption('kaleidoscope')).toBe('kaleidoscope');
    expect(getStylizeTransitionOption('liquid-melt')).toBe('liquid-melt');
    expect(getStylizeTransitionOption('fly-eye')).toBe('fly-eye');
    expect(getStylizeTransitionOption('thermal-bloom')).toBe('thermal-bloom');
    expect(getStylizeTransitionOption('neural-dream')).toBe('neural-dream');
    expect(getTransitionFamilyGroup('noise-dissolve')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('water-drop')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('kaleidoscope')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('liquid-melt')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('fly-eye')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('thermal-bloom')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('neural-dream')?.id).toBe('stylize');
    expect(getTransitionFamilyGroup('noise-dissolve')?.dimension).toBe('2d');
    expect(getTransitionFamilyById('stylize')?.defaultType).toBe('noise-dissolve');
    expect(getTransitionFamilyDimension('noise-dissolve')).toBe('2d');
  });

  it('groups flat rotate variants under one 2D display family', () => {
    expect(ROTATE_TRANSITION_GROUP.transitions).toEqual({
      'rotate-left': 'rotate-left',
      'rotate-right': 'rotate-right',
      'rotate-90': 'rotate-90',
    });

    expect(getRotateTransitionOption('rotate-left')).toBe('rotate-left');
    expect(getRotateTransitionOption('rotate-right')).toBe('rotate-right');
    expect(getRotateTransitionOption('rotate-90')).toBe('rotate-90');
    expect(getTransitionFamilyGroup('rotate-left')?.id).toBe('rotate');
    expect(getTransitionFamilyById('rotate')?.defaultType).toBe('rotate-left');
    expect(getTransitionFamilyDimension('rotate-90')).toBe('2d');
  });
});
