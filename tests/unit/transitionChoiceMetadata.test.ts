import { describe, expect, it } from 'vitest';

import { getAllTransitions } from '../../src/transitions';
import {
  DIP_OPTIONS,
  DIP_SWATCHES,
  getLightGlyphClass,
  getPatternGlyphClass,
  getRotateGlyphClass,
  getStylizeGlyphClass,
  getThreeDGlyphClass,
  getTransitionSelectOptionGroups,
  isDirectionOption,
} from '../../src/components/panels/properties/transitionChoiceMetadata';

describe('transition choice metadata', () => {
  it('builds grouped Properties selector options from runtime transitions', () => {
    const groups = getTransitionSelectOptionGroups(getAllTransitions());

    expect(groups.map((group) => [group.label, group.options.length])).toEqual([
      ['2D', 13],
      ['3D', 4],
    ]);
    expect(groups[0].options.map((option) => option.value)).toContain('wipe');
    expect(groups[0].options.map((option) => option.value)).not.toContain('wipe-up');
    expect(groups[1].options).toEqual([
      { value: 'flip', label: 'Flip', dimension: '3d' },
      { value: 'tumble', label: 'Tumble', dimension: '3d' },
      { value: 'roll', label: 'Roll', dimension: '3d' },
      { value: 'spin', label: 'Spin', dimension: '3d' },
    ]);
  });

  it('keeps choice glyph and swatch metadata stable', () => {
    expect(DIP_OPTIONS).toEqual(['black', 'white', 'custom']);
    expect(DIP_SWATCHES.white).toBe('#f4f4f5');
    expect(isDirectionOption('left')).toBe(true);
    expect(isDirectionOption('clock')).toBe(false);
    expect(getLightGlyphClass('light-leak')).toBe('transition-light-glyph-leak');
    expect(getLightGlyphClass('film-burn')).toBe('transition-light-glyph-flash');
    expect(getThreeDGlyphClass('spinback-3d')).toBe('transition-three-d-glyph-spinback');
    expect(getPatternGlyphClass('puzzle-push')).toBe('transition-pattern-glyph-puzzle');
    expect(getPatternGlyphClass('magnetic-tiles')).toBe('transition-pattern-glyph-magnetic');
    expect(getStylizeGlyphClass('kaleidoscope')).toBe('transition-stylize-glyph-kaleidoscope');
    expect(getRotateGlyphClass('rotate-right')).toBe('transition-stylize-glyph-rotate-right');
  });
});
