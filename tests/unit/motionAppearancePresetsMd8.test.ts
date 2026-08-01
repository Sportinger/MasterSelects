import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';

import { MotionAppearanceStackEditor } from '../../src/components/panels/properties/MotionAppearanceStackEditor';
import {
  handleApplyMotionAppearancePreset,
  handleListMotionAppearancePresets,
  handleSaveMotionAppearancePreset,
} from '../../src/services/aiTools/handlers/motionDesign';
import { createMotionAppearancePreset } from '../../src/services/motionDesign/appearancePresets';
import {
  MOTION_APPEARANCE_PRESET_LIBRARY_CAP,
  listMotionAppearancePresets,
  saveMotionAppearancePresetToLibrary,
} from '../../src/services/motionDesign/presetLibrary';
import {
  createDefaultMotionLayerDefinition,
  createLinearGradientAppearance,
} from '../../src/types/motionDesign';
import { MOTION_MAX_APPEARANCES } from '../../src/engine/motion/MotionBuffers';
import { useTimelineStore } from '../../src/stores/timeline';

const initialState = useTimelineStore.getState();
const track = { id: 'video-1', name: 'Video', type: 'video' as const, height: 70, muted: false, visible: true, solo: false };

function reset(): [string, string] {
  useTimelineStore.setState({ ...initialState, clips: [], tracks: [track], clipKeyframes: new Map() });
  return [
    useTimelineStore.getState().addMotionShapeClip(track.id, 0, { primitive: 'rectangle', duration: 5 })!,
    useTimelineStore.getState().addMotionShapeClip(track.id, 6, { primitive: 'rectangle', duration: 5 })!,
  ];
}

describe('MD8 appearance presets', () => {
  let sourceId: string;
  let targetId: string;

  beforeEach(() => { localStorage.clear(); [sourceId, targetId] = reset(); });
  afterEach(() => { localStorage.clear(); act(() => useTimelineStore.setState(initialState)); });

  it('round-trips library data, skips corrupt entries, and evicts oldest presets', () => {
    const motion = createDefaultMotionLayerDefinition('shape');
    saveMotionAppearancePresetToLibrary(createMotionAppearancePreset(motion.appearance!, 'First', 'first'));
    expect(listMotionAppearancePresets().presets.map((preset) => preset.name)).toEqual(['First']);
    localStorage.setItem('masterselects.motionAppearancePresets', JSON.stringify({ version: 1, presets: ['bad json'] }));
    expect(listMotionAppearancePresets().warnings).toContain('Skipped corrupt appearance preset at index 0');
    localStorage.clear();
    for (let index = 0; index <= MOTION_APPEARANCE_PRESET_LIBRARY_CAP; index += 1) {
      saveMotionAppearancePresetToLibrary(createMotionAppearancePreset(motion.appearance!, `Preset ${index}`, `preset-${index}`));
    }
    expect(listMotionAppearancePresets().presets).toHaveLength(MOTION_APPEARANCE_PRESET_LIBRARY_CAP);
    expect(listMotionAppearancePresets().presets.some((preset) => preset.id === 'preset-0')).toBe(false);
  });

  it('AI saves, lists, and applies remapped gradient ids', async () => {
    // The default motion shape appearance only carries a color fill; add a
    // gradient so id remapping (including stop ids) is observable.
    useTimelineStore.getState().updateMotionLayer(sourceId, (motion) => ({
      ...motion,
      appearance: {
        ...motion.appearance!,
        items: [...motion.appearance!.items, createLinearGradientAppearance()],
      },
    }));
    const source = useTimelineStore.getState().clips.find((clip) => clip.id === sourceId)!;
    const gradient = source.motion!.appearance!.items.find((item) => item.kind === 'linear-gradient')!;
    const saved = await handleSaveMotionAppearancePreset({ clipId: sourceId, name: 'Gradient' }, useTimelineStore.getState());
    expect(saved.success).toBe(true);
    const listed = await handleListMotionAppearancePresets();
    const presetId = (listed.data as { presets: Array<{ id: string }> }).presets[0].id;
    const applied = await handleApplyMotionAppearancePreset({ clipId: targetId, presetId }, useTimelineStore.getState());
    expect(applied.success).toBe(true);
    const targetGradient = useTimelineStore.getState().clips.find((clip) => clip.id === targetId)!.motion!.appearance!.items.find((item) => item.kind === 'linear-gradient')!;
    expect(targetGradient.id).not.toBe(gradient.id);
    if (targetGradient.kind === 'linear-gradient' && gradient.kind === 'linear-gradient') {
      expect(targetGradient.stops.map((stop) => stop.id)).not.toEqual(gradient.stops.map((stop) => stop.id));
    }
  });

  it('rejects append over the appearance limit and texture preset saves', async () => {
    const source = useTimelineStore.getState().clips.find((clip) => clip.id === sourceId)!;
    const items = source.motion!.appearance!.items;
    const fullItems = Array.from({ length: MOTION_MAX_APPEARANCES }, (_, index) => {
      const item = structuredClone(items[index % items.length]);
      item.id = `full-${index}`;
      if (item.kind === 'linear-gradient' || item.kind === 'radial-gradient') {
        item.stops = item.stops.map((stop, stopIndex) => ({ ...stop, id: `full-${index}-stop-${stopIndex}` }));
      }
      return item;
    });
    saveMotionAppearancePresetToLibrary(createMotionAppearancePreset({ version: 1, items: fullItems }, 'Full', 'full'));
    const appended = await handleApplyMotionAppearancePreset({ clipId: targetId, presetId: 'full', mode: 'append' }, useTimelineStore.getState());
    expect(appended.success).toBe(false);
    useTimelineStore.getState().updateMotionLayer(sourceId, (motion) => ({ ...motion, appearance: { ...motion.appearance!, items: [{ ...motion.appearance!.items[0], kind: 'texture-fill', mediaFileId: 'media-1' } as never] } }));
    const texture = await handleSaveMotionAppearancePreset({ clipId: sourceId, name: 'Texture' }, useTimelineStore.getState());
    expect(texture.error).toBe('Appearance presets cannot embed texture or media fills');
  });

  it('saves and applies a preset from the appearance editor', () => {
    render(createElement(MotionAppearanceStackEditor, { clipId: sourceId }));
    fireEvent.change(screen.getByLabelText('Appearance preset name'), { target: { value: 'UI preset' } });
    fireEvent.click(screen.getByText('Save'));
    expect(listMotionAppearancePresets().presets).toHaveLength(1);
    const expected = useTimelineStore.getState().clips.find((clip) => clip.id === sourceId)!.motion!.appearance!.items.length;
    render(createElement(MotionAppearanceStackEditor, { clipId: targetId }));
    fireEvent.change(screen.getAllByLabelText('Appearance preset')[1], { target: { value: listMotionAppearancePresets().presets[0].id } });
    fireEvent.click(screen.getAllByText('Apply')[1]);
    expect(useTimelineStore.getState().clips.find((clip) => clip.id === targetId)!.motion!.appearance!.items).toHaveLength(expected);
  });
});
