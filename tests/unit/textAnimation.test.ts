import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockClip, createMockKeyframe, createMockTrack } from '../helpers/mockData';
import { createTestTimelineStore } from '../helpers/storeFactory';
import { installCanvas2DMock } from '../helpers/mockCanvas2d';
import { DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { sampleTextProperties } from '../../src/services/text/textAnimation';
import { renderTextFrame } from '../../src/services/text/textFrameRuntime';
import { textRenderer } from '../../src/services/textRenderer';

beforeEach(() => installCanvas2DMock());
afterEach(() => vi.restoreAllMocks());
const keys = () => [createMockKeyframe({ clipId: 'txt', property: 'text.fontSize', time: 0, value: 20 }),
  createMockKeyframe({ clipId: 'txt', property: 'text.fontSize', time: 2, value: 100 })];
const makeClip = () => createMockClip({ id: 'txt', trackId: 'video-1', duration: 5,
  source: { type: 'text', textCanvas: document.createElement('canvas') }, textProperties: { ...DEFAULT_TEXT_PROPERTIES, boxEnabled: false } });
describe('text animation', () => {
  it('samples timeline-local curves without changing the canonical text settings', () => {
    const base = { ...DEFAULT_TEXT_PROPERTIES };
    expect(sampleTextProperties(base, keys(), 1).fontSize).toBe(60);
    expect(sampleTextProperties(base, keys(), -1).fontSize).toBe(20);
    expect(sampleTextProperties(base, keys(), 4).fontSize).toBe(100);
    expect(base.fontSize).toBe(72);
    expect(sampleTextProperties(base, [], 1)).toBe(base);
  });
  it('renders animated canvases separately and returns to the static source when keys are removed', () => {
    const clip = makeClip(), spy = vi.spyOn(textRenderer, 'render');
    const a = renderTextFrame(clip, keys(), 1);
    expect(a).not.toBe(clip.source?.textCanvas);
    expect(spy.mock.calls.at(-1)?.[0].fontSize).toBe(60);
    expect(renderTextFrame(clip, keys(), 2)).toBe(a);
    expect(spy.mock.calls.at(-1)?.[0].fontSize).toBe(100);
    expect(renderTextFrame(clip, [], 2)).toBe(clip.source?.textCanvas);
  });
  it('writes static text values, records keys and bakes the current value on disable', () => {
    const store = createTestTimelineStore({ clips: [makeClip()] });
    store.getState().setPropertyValue('txt', 'text.fontSize', 36);
    expect(store.getState().clips[0].textProperties?.fontSize).toBe(36);
    store.getState().addKeyframe('txt', 'text.fontSize', 36, 0);
    store.setState({ playheadPosition: 2 });
    store.getState().setPropertyValue('txt', 'text.fontSize', 100);
    expect(store.getState().clipKeyframes.get('txt')?.map(k => [k.time, k.value])).toEqual([[0, 36], [2, 100]]);
    expect(store.getState().clips[0].textProperties?.fontSize).toBe(36);
    store.getState().disablePropertyKeyframes('txt', 'text.fontSize', 68);
    expect(store.getState().clips[0].textProperties?.fontSize).toBe(68);
    expect(store.getState().hasKeyframes('txt', 'text.fontSize')).toBe(false);
  });
  it('respects locked tracks and export locks', () => {
    const store = createTestTimelineStore({ clips: [makeClip()], tracks: [createMockTrack({ id: 'video-1', locked: true })], clipKeyframes: new Map([['txt', keys()]]) });
    store.getState().setPropertyValue('txt', 'text.fontSize', 200);
    store.getState().disablePropertyKeyframes('txt', 'text.fontSize', 200);
    expect(store.getState().clips[0].textProperties?.fontSize).toBe(72);
    expect(store.getState().clipKeyframes.get('txt')).toHaveLength(2);
    store.setState({ tracks: [createMockTrack({ id: 'video-1' })], isExporting: true });
    store.getState().setPropertyValue('txt', 'text.fontSize', 200);
    expect(store.getState().clips[0].textProperties?.fontSize).toBe(72);
  });
});
