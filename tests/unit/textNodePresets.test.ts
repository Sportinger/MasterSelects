import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { applyTextNodePresetSettings, isTextNodePreset, listTextNodePresets, saveTextNodePreset } from '../../src/services/text/textNodePresets';
import { createTextNodePreset, textNodePresetPatch } from '../../src/services/text/textNodeStages';

beforeEach(() => localStorage.clear());
describe('reusable text settings', () => {
  it('roundtrips a stage without replacing destination content or unrelated appearance', () => {
    const source = { ...DEFAULT_TEXT_PROPERTIES, text: 'Source', fontSize: 120, color: '#ff0000' };
    const preset = saveTextNodePreset('Big type', 'typography', source);
    expect(listTextNodePresets()).toEqual([preset]);
    const target = { ...DEFAULT_TEXT_PROPERTIES, text: 'Destination', ...applyTextNodePresetSettings(preset) };
    expect(target.text).toBe('Destination'); expect(target.fontSize).toBe(120); expect(target.color).toBe(DEFAULT_TEXT_PROPERTIES.color);
    expect(isTextNodePreset({ ...preset, settings: { ...preset.settings, text: 'Overwrite' } })).toBe(false);
  });
  it('copies complete style deeply and clears optional layout values when absent', () => {
    const source = { ...DEFAULT_TEXT_PROPERTIES, boxEnabled: undefined, pathPoints: [{ x: 1, y: 2, handleIn: { x: 0, y: 0 }, handleOut: { x: 1, y: 1 } }] };
    const preset = saveTextNodePreset('Style', 'all', source);
    const patch = applyTextNodePresetSettings(preset);
    expect(patch).toHaveProperty('textBounds', undefined);
    expect(patch).not.toHaveProperty('text');
    source.pathPoints[0].x = 20;
    expect(patch.pathPoints?.[0].x).toBe(1);
    expect(textNodePresetPatch(createTextNodePreset('Fill', 'fill', source))).toEqual({ color: source.color });
  });
  it('rejects corrupt storage, nonfinite values and invalid bounds without overwriting the library', () => {
    const preset = saveTextNodePreset('Good', 'all', DEFAULT_TEXT_PROPERTIES);
    expect(isTextNodePreset({ ...preset, settings: { ...preset.settings, fontSize: Infinity } })).toBe(false);
    expect(isTextNodePreset({ ...preset, settings: { ...preset.settings, textBounds: { vertices: [{ x: 0, y: 0 }] } } })).toBe(false);
    const key = localStorage.key(0)!;
    localStorage.setItem(key, '{broken');
    expect(() => saveTextNodePreset('No', 'fill', DEFAULT_TEXT_PROPERTIES)).toThrow();
    expect(localStorage.getItem(key)).toBe('{broken');
  });
});
