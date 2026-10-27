import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPhoneMaskPatch, defaultPhoneMaskParams, PHONE_MASK_SHAPES, readPhoneMask, type PhoneMaskParams, type PhoneMaskShape,
} from '../../src/components/mobileSkin/mask/phoneMaskGeometry';
import { readPhoneMaskInventory, writePhoneMaskDraft } from '../../src/components/mobileSkin/mask/phoneMaskCommands';
import { useTimelineStore } from '../../src/stores/timeline';
import type { ClipMask } from '../../src/types/masks';
import { transformMaskPoint } from '../../src/utils/maskTransform';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const ASPECT = 1080 / 1920;
const SIZE = { width: 1080, height: 1920 };

function asMask(patch: Partial<ClipMask>, extra: Partial<ClipMask> = {}): ClipMask {
  return {
    id: 'm1', name: '', vertices: [], closed: true, opacity: 1, feather: 0, featherQuality: 50, inverted: false,
    mode: 'add', expanded: true, position: { x: 0, y: 0 }, enabled: true, visible: true, ...patch, ...extra,
  } as ClipMask;
}

const SHAPES = PHONE_MASK_SHAPES.map((entry) => entry.value);

describe('phone mask geometry', () => {
  it.each(SHAPES)('%s round-trips through an editor mask with centre, rotation, edge and invert', (shape: PhoneMaskShape) => {
    const params: PhoneMaskParams = { ...defaultPhoneMaskParams(shape, ASPECT), centerX: 0.3, centerY: 0.65, rotation: 30, feather: 12, inverted: true };
    const mask = asMask(buildPhoneMaskPatch(shape, params, ASPECT, 'id'));
    const read = readPhoneMask(mask, ASPECT);
    expect(read?.shape).toBe(shape);
    expect(read!.params.centerX).toBeCloseTo(0.3, 6);
    expect(read!.params.centerY).toBeCloseTo(0.65, 6);
    expect(read!.params.rotation).toBe(30);
    expect(read!.params.feather).toBe(12);
    expect(read!.params.inverted).toBe(true);
    if (shape === 'rectangle' || shape === 'circle') {
      expect(read!.params.width).toBeCloseTo(params.width, 6);
      expect(read!.params.height).toBeCloseTo(params.height, 6);
    }
    expect(mask.closed).toBe(true);
    expect(mask.name).toBe(PHONE_MASK_SHAPES.find((entry) => entry.value === shape)!.maskName);
  });

  it('places the rotated centre where the editor renders it (rectangle and circle)', () => {
    for (const shape of ['rectangle', 'circle'] as const) {
      const params = { ...defaultPhoneMaskParams(shape, ASPECT), centerX: 0.7, centerY: 0.2, rotation: 45 };
      const mask = asMask(buildPhoneMaskPatch(shape, params, ASPECT));
      const centre = transformMaskPoint(mask, { x: 0.5, y: 0.5 }, SIZE);
      expect(centre.x).toBeCloseTo(0.7, 6);
      expect(centre.y).toBeCloseTo(0.2, 6);
    }
  });

  it('keeps the linear edge through the chosen point at any angle, perpendicular in raster pixels', () => {
    const params = { ...defaultPhoneMaskParams('linear', ASPECT), centerX: 0.4, centerY: 0.6, rotation: 90 };
    const mask = asMask(buildPhoneMaskPatch('linear', params, ASPECT));
    // The edge is the top side of the vertex box; its middle must land on (0.4, 0.6).
    const xs = mask.vertices.map((vertex) => vertex.x);
    const top = Math.min(...mask.vertices.map((vertex) => vertex.y));
    const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: top };
    const onLine = transformMaskPoint(mask, mid, SIZE);
    expect(onLine.x).toBeCloseTo(0.4, 6);
    expect(onLine.y).toBeCloseTo(0.6, 6);
    // At 90° the edge is vertical: a point further along the edge keeps x.
    const along = transformMaskPoint(mask, { x: mid.x + 0.25, y: top }, SIZE);
    expect(along.x).toBeCloseTo(0.4, 6);
  });

  it.each(SHAPES)('%s writes no negative zero (the project round trip would read it as an edit)', (shape: PhoneMaskShape) => {
    const patch = buildPhoneMaskPatch(shape, defaultPhoneMaskParams(shape, ASPECT), ASPECT);
    const numbers: number[] = [];
    JSON.stringify(patch, (_key, value) => { if (typeof value === 'number') numbers.push(value); return value; });
    const walk = (value: unknown) => {
      if (typeof value === 'number') numbers.push(value);
      else if (value && typeof value === 'object') Object.values(value).forEach(walk);
    };
    walk(patch);
    expect(numbers.filter((value) => Object.is(value, -0))).toEqual([]);
  });

  it('circle has equal radii in raster pixels', () => {
    const params = defaultPhoneMaskParams('circle', ASPECT);
    const mask = asMask(buildPhoneMaskPatch('circle', params, ASPECT));
    const xs = mask.vertices.map((vertex) => vertex.x);
    const ys = mask.vertices.map((vertex) => vertex.y);
    const widthPx = (Math.max(...xs) - Math.min(...xs)) * SIZE.width;
    const heightPx = (Math.max(...ys) - Math.min(...ys)) * SIZE.height;
    expect(widthPx).toBeCloseTo(heightPx, 3);
  });

  it('reads an ellipse and a rectangle made by the desktop mask panel', () => {
    const store = useTimelineStore.getState();
    const clip = createMockClip({ id: 'c', trackId: 't' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't', type: 'video' })] });
    const ellipseId = store.addEllipseMask('c');
    const rectId = useTimelineStore.getState().addRectangleMask('c');
    const masks = useTimelineStore.getState().clips[0].masks!;
    const ellipse = readPhoneMask(masks.find((mask) => mask.id === ellipseId)!, ASPECT);
    const rect = readPhoneMask(masks.find((mask) => mask.id === rectId)!, ASPECT);
    expect(ellipse?.shape).toBe('circle');
    expect(ellipse!.params.width).toBeCloseTo(0.8, 6);
    expect(rect?.shape).toBe('rectangle');
    expect(rect!.params.centerX).toBeCloseTo(0.5, 6);
  });

  it('treats edited paths, pen paths, edge profiles and the crop mask as custom', () => {
    const rect = buildPhoneMaskPatch('rectangle', defaultPhoneMaskParams('rectangle', ASPECT), ASPECT);
    const moved = rect.vertices!.map((vertex, index) => (index === 0 ? { ...vertex, x: vertex.x - 0.05 } : vertex));
    expect(readPhoneMask(asMask(rect, { vertices: moved }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { name: 'Mask 1' }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { featherOffset: 4 }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { purpose: 'crop' }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { mode: 'subtract' }), ASPECT)).toBeNull();
  });

  it('treats a desktop mask at partial opacity, disabled or kept for effects only as custom (a phone write would reset it)', () => {
    const rect = buildPhoneMaskPatch('rectangle', defaultPhoneMaskParams('rectangle', ASPECT), ASPECT);
    expect(readPhoneMask(asMask(rect), ASPECT)?.shape).toBe('rectangle');
    expect(readPhoneMask(asMask(rect, { opacity: 0.5 }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { enabled: false }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { compositeEnabled: false }), ASPECT)).toBeNull();
    expect(readPhoneMask(asMask(rect, { compositeEnabled: true }), ASPECT)?.shape).toBe('rectangle');
  });
});

describe('phone mask commands', () => {
  const original = useTimelineStore.getState();
  afterEach(() => useTimelineStore.setState(original, true));

  it('adds, updates and removes one phone mask through the store and leaves custom masks alone', () => {
    const clip = createMockClip({ id: 'c', trackId: 't' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't', type: 'video' })], clipKeyframes: new Map() });
    const customId = useTimelineStore.getState().addMask('c', { name: 'Pen path', closed: true, vertices: [] });
    const ref = { maskId: null as string | null };
    writePhoneMaskDraft('c', ref, { shape: 'circle', params: defaultPhoneMaskParams('circle', ASPECT) }, ASPECT);
    expect(ref.maskId).not.toBeNull();
    writePhoneMaskDraft('c', ref, { shape: 'star', params: { ...defaultPhoneMaskParams('star', ASPECT), feather: 20 } }, ASPECT);
    let masks = useTimelineStore.getState().clips[0].masks!;
    expect(masks).toHaveLength(2);
    const inventory = readPhoneMaskInventory(useTimelineStore.getState().clips[0], ASPECT);
    expect(inventory.editable?.shape).toBe('star');
    expect(inventory.editable?.params.feather).toBe(20);
    expect(inventory.custom.map((mask) => mask.id)).toEqual([customId]);
    // The vertex ids belong to the mask, so two masks never share one.
    expect(masks.find((mask) => mask.id === ref.maskId)!.vertices[0].id.startsWith(ref.maskId!)).toBe(true);
    writePhoneMaskDraft('c', ref, { shape: 'none' }, ASPECT);
    masks = useTimelineStore.getState().clips[0].masks!;
    expect(masks.map((mask) => mask.id)).toEqual([customId]);
    expect(ref.maskId).toBeNull();
  });

  it('reports an animated phone mask instead of editing it', () => {
    const clip = createMockClip({ id: 'c', trackId: 't' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't', type: 'video' })], clipKeyframes: new Map() });
    const ref = { maskId: null as string | null };
    writePhoneMaskDraft('c', ref, { shape: 'rectangle', params: defaultPhoneMaskParams('rectangle', ASPECT) }, ASPECT);
    useTimelineStore.setState({
      clipKeyframes: new Map([['c', [{ id: 'k', clipId: 'c', time: 0, property: `mask.${ref.maskId}.feather`, value: 3, easing: 'linear' }]]]),
    } as never);
    const inventory = readPhoneMaskInventory(useTimelineStore.getState().clips[0], ASPECT);
    expect(inventory.animated).toBe(true);
    expect(inventory.editable).toBeNull();
  });
});
