import { act, fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TextTab } from '../../src/components/panels/TextTab';
import { useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { installCanvas2DMock } from '../helpers/mockCanvas2d';
import { POPULAR_FONTS } from '../../src/services/googleFontsService';

vi.mock('../../src/services/googleFontsService', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/googleFontsService')>(),
  googleFontsService: { loadFont: vi.fn(async () => {}), preloadFont: vi.fn(async () => {}),
    getAvailableWeights: (family: string) => family === 'Thin Only' ? [300] : [400, 700] },
}));
vi.mock('../../src/stores/historyStore', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/stores/historyStore')>(),
  startBatch: vi.fn(() => ({ opened: true, batchId: 1 })), endBatch: vi.fn(),
}));
const original = useTimelineStore.getState();
function Inspector() {
  const clip = useTimelineStore(state => state.clips[0]);
  return <TextTab clipId={clip.id} textProperties={clip.textProperties!} editSelection />;
}
const sizes = () => useTimelineStore.getState().clips.map(clip => clip.textProperties?.fontSize);
beforeEach(() => {
  installCanvas2DMock();
  useTimelineStore.setState({ clips: [40, 60, 80].map((fontSize, index) => createMockClip({ id: `text-${index}`, trackId: 'video-1',
    source: { type: 'text', textCanvas: document.createElement('canvas') },
    textProperties: { ...DEFAULT_TEXT_PROPERTIES, text: `Content ${index}`, fontSize, fontFamily: POPULAR_FONTS[0].family,
      fontWeight: index === 0 ? 400 : 700, boxEnabled: true, boxX: index * 100, boxY: 0, boxWidth: 400, boxHeight: 200 } })),
    tracks: [createMockTrack({ id: 'video-1' })], selectedClipIds: new Set(['text-0', 'text-1', 'text-2']),
    clipKeyframes: new Map(), keyframeRecordingEnabled: new Set(), isExporting: false, playheadPosition: 0 });
});
afterEach(() => { cleanup(); useTimelineStore.setState(original, true); });

describe('Text inspector multiselection UI', () => {
  it('wires the numeric slider to relative selection edits and reset', async () => {
    render(<Inspector />);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Font Size slider' }), { key: 'ArrowRight', shiftKey: true });
    expect(sizes()).toEqual([50, 70, 90]);
    fireEvent.click(screen.getByRole('button', { name: 'Reset Font Size' }));
    expect(sizes()).toEqual([72, 92, 112]);
    await act(async () => {});
  });
  it('enables wheel selection only on font family and preserves each weight', async () => {
    render(<Inspector />);
    const font = screen.getByRole('combobox', { name: 'Font family' });
    expect(fireEvent.wheel(font, { deltaY: 100 })).toBe(false);
    expect(useTimelineStore.getState().clips.map(clip => clip.textProperties?.fontFamily)).toEqual(Array(3).fill(POPULAR_FONTS[1].family));
    expect(useTimelineStore.getState().clips.map(clip => clip.textProperties?.fontWeight)).toEqual([400, 700, 700]);
    expect(fireEvent.wheel(screen.getByRole('combobox', { name: 'Font weight' }), { deltaY: 100 })).toBe(true);
    expect(useTimelineStore.getState().clips[0].textProperties?.fontWeight).toBe(400);
    fireEvent.click(font);
    expect(fireEvent.wheel(screen.getByRole('listbox'), { deltaY: 100 })).toBe(true);
    expect(useTimelineStore.getState().clips[0].textProperties?.fontFamily).toBe(POPULAR_FONTS[1].family);
    await act(async () => {});
  });
  it('applies alignment to the selection and keeps text content separate', async () => {
    render(<Inspector />);
    fireEvent.click(screen.getByRole('button', { name: 'Align right' }));
    expect(useTimelineStore.getState().clips.every(clip => clip.textProperties?.textAlign === 'right')).toBe(true);
    expect(useTimelineStore.getState().clips.map(clip => clip.textProperties?.text)).toEqual(['Content 0', 'Content 1', 'Content 2']);
    await act(async () => {});
  });
  it('adds and removes numeric keyframes for each selected clip using its own value', async () => {
    render(<Inspector />);
    const row = screen.getByRole('slider', { name: 'Font Size slider' }).closest('.resolve-inspector-row')!;
    const toggle = row.querySelector('.keyframe-toggle')!;
    fireEvent.click(toggle);
    for (const [index, size] of [40, 60, 80].entries()) expect(useTimelineStore.getState().clipKeyframes.get(`text-${index}`))
      .toContainEqual(expect.objectContaining({ property: 'text.fontSize', value: size }));
    fireEvent.contextMenu(toggle);
    expect(sizes()).toEqual([40, 60, 80]);
    expect([...useTimelineStore.getState().clipKeyframes.values()].flat()).toEqual([]);
    await act(async () => {});
  });
  it('disables font wheel edits while exporting', async () => {
    useTimelineStore.setState({ isExporting: true });
    render(<Inspector />);
    const font = screen.getByRole('combobox', { name: 'Font family' });
    expect(font).toBeDisabled();
    fireEvent.wheel(font, { deltaY: 100 });
    expect(useTimelineStore.getState().clips[0].textProperties?.fontFamily).toBe(POPULAR_FONTS[0].family);
    await act(async () => {});
  });
});
