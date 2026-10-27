import { afterEach, describe, expect, it } from 'vitest';

import {
  addPhonePenPoint, canClosePhonePenPath, closePhonePenPath, describePhonePenPath, EMPTY_PHONE_PEN_PATH, hitPhonePenPoint,
  movePhonePenPoint, PHONE_PEN_MASK_NAME, setPhonePenHandle, toPhonePenMaskPatch, undoPhonePenPoint, type PhonePenPath,
} from '../../src/components/mobileSkin/mask/phonePenModel';
import { readPhoneMaskInventory, readPhonePenMask, writePhonePenDraft } from '../../src/components/mobileSkin/mask/phoneMaskCommands';
import { usePhonePenStore } from '../../src/components/mobileSkin/mask/phonePenStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { ClipMask } from '../../src/types/masks';
import { createMockClip, createMockTrack } from '../helpers/mockData';

function triangle(): PhonePenPath {
  let path = EMPTY_PHONE_PEN_PATH;
  path = addPhonePenPoint(path, 0.2, 0.2);
  path = addPhonePenPoint(path, 0.8, 0.2);
  path = addPhonePenPoint(path, 0.5, 0.8);
  return path;
}

function asMask(patch: Partial<ClipMask>, id = 'm1'): ClipMask {
  return {
    id, name: '', vertices: [], closed: true, opacity: 1, feather: 0, featherQuality: 50, inverted: false,
    mode: 'add', expanded: true, position: { x: 0, y: 0 }, enabled: true, visible: true, ...patch,
  } as ClipMask;
}

describe('phone pen path model', () => {
  it('adds points with stable ids, closes only with three points, and undo reopens before removing', () => {
    let path = addPhonePenPoint(addPhonePenPoint(EMPTY_PHONE_PEN_PATH, 0.1, 0.1), 0.9, 0.1);
    expect(canClosePhonePenPath(path)).toBe(false);
    expect(closePhonePenPath(path)).toBe(path);
    path = addPhonePenPoint(path, 0.5, 0.9);
    expect(path.points.map((point) => point.id)).toEqual(['p1', 'p2', 'p3']);
    const closed = closePhonePenPath(path);
    expect(closed.closed).toBe(true);
    // A closed path takes no more points.
    expect(addPhonePenPoint(closed, 0.3, 0.3)).toBe(closed);
    const reopened = undoPhonePenPoint(closed);
    expect(reopened.closed).toBe(false);
    expect(reopened.points).toHaveLength(3);
    const shorter = undoPhonePenPoint(reopened);
    expect(shorter.points).toHaveLength(2);
    // Ids are never reused after an undo.
    expect(addPhonePenPoint(shorter, 0.4, 0.4).points[2].id).toBe('p4');
    expect(undoPhonePenPoint(EMPTY_PHONE_PEN_PATH)).toBe(EMPTY_PHONE_PEN_PATH);
  });

  it('moves points and pulls mirrored handles; non-finite input becomes 0', () => {
    let path = triangle();
    path = movePhonePenPoint(path, 1, 0.7, 0.3);
    path = setPhonePenHandle(path, 2, 0.1, -0.05);
    expect(path.points[1]).toMatchObject({ x: 0.7, y: 0.3 });
    const patch = toPhonePenMaskPatch(closePhonePenPath(path), 'mask', { feather: 8, inverted: true });
    expect(patch.vertices![2]).toMatchObject({ id: 'mask-p3', handleOut: { x: 0.1, y: -0.05 }, handleIn: { x: -0.1, y: 0.05 }, handleMode: 'mirrored' });
    expect(patch.vertices![0].handleMode).toBe('none');
    expect(patch).toMatchObject({ name: PHONE_PEN_MASK_NAME, closed: true, feather: 8, inverted: true, rotation: 0, position: { x: 0, y: 0 }, opacity: 1 });
    expect(movePhonePenPoint(path, 0, Number.NaN, 0.5).points[0]).toMatchObject({ x: 0, y: 0.5 });
    expect(movePhonePenPoint(path, 9, 0.5, 0.5)).toBe(path);
  });

  it('hits the nearest point inside the radius only', () => {
    const points = [{ x: 10, y: 10 }, { x: 30, y: 10 }];
    expect(hitPhonePenPoint(points, { x: 27, y: 12 }, 22)).toBe(1);
    expect(hitPhonePenPoint(points, { x: 100, y: 100 }, 22)).toBe(-1);
  });

  it('says what the next tap does', () => {
    expect(describePhonePenPath(EMPTY_PHONE_PEN_PATH)).toMatch(/first point/);
    expect(describePhonePenPath(triangle())).toMatch(/first point .*close/i);
    expect(describePhonePenPath(closePhonePenPath(triangle()))).toMatch(/Closed path with 3 points/);
  });
});

describe('phone pen mask commands', () => {
  const original = useTimelineStore.getState();
  afterEach(() => {
    useTimelineStore.setState(original, true);
    usePhonePenStore.getState().end();
  });

  it('creates, updates and removes one pen mask through the store', () => {
    const clip = createMockClip({ id: 'c', trackId: 't' });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: 't', type: 'video' })], clipKeyframes: new Map() });
    const ref = { maskId: null as string | null };
    // An empty path creates nothing.
    writePhonePenDraft('c', ref, EMPTY_PHONE_PEN_PATH, { feather: 0, inverted: false });
    expect(useTimelineStore.getState().clips[0].masks ?? []).toHaveLength(0);
    writePhonePenDraft('c', ref, closePhonePenPath(triangle()), { feather: 4, inverted: false });
    const masks = useTimelineStore.getState().clips[0].masks!;
    expect(masks).toHaveLength(1);
    expect(masks[0]).toMatchObject({ id: ref.maskId, name: PHONE_PEN_MASK_NAME, closed: true, feather: 4 });
    expect(masks[0].vertices.map((vertex) => vertex.id)).toEqual([`${ref.maskId}-p1`, `${ref.maskId}-p2`, `${ref.maskId}-p3`]);
    writePhonePenDraft('c', ref, null, { feather: 0, inverted: false });
    expect(useTimelineStore.getState().clips[0].masks ?? []).toHaveLength(0);
    expect(ref.maskId).toBeNull();
  });

  it('reads a phone pen mask back with its vertex ids, and refuses moved, rotated or broken-handle paths', () => {
    const path = setPhonePenHandle(closePhonePenPath(triangle()), 1, 0.05, 0.02);
    const mask = asMask(toPhonePenMaskPatch(path, 'm1', { feather: 0, inverted: false }));
    const read = readPhonePenMask(mask)!;
    expect(read.points.map((point) => point.id)).toEqual(['p1', 'p2', 'p3']);
    expect(read.nextId).toBe(4);
    expect(read.points[1]).toMatchObject({ handleX: 0.05, handleY: 0.02 });
    expect(toPhonePenMaskPatch(read, 'm1', { feather: 0, inverted: false }).vertices).toEqual(mask.vertices);
    expect(readPhonePenMask({ ...mask, position: { x: 0.1, y: 0 } })).toBeNull();
    expect(readPhonePenMask({ ...mask, rotation: 10 })).toBeNull();
    expect(readPhonePenMask({ ...mask, name: 'Mask 1' })).toBeNull();
    const broken = { ...mask, vertices: mask.vertices.map((vertex, index) => (index === 1 ? { ...vertex, handleIn: { x: 0, y: 0 } } : vertex)) };
    expect(readPhonePenMask(broken)).toBeNull();
  });

  it('lists an editable pen path in the inventory instead of as a desktop mask', () => {
    const mask = asMask(toPhonePenMaskPatch(closePhonePenPath(triangle()), 'pen1', { feather: 6, inverted: true }), 'pen1');
    const clip = createMockClip({ id: 'c', trackId: 't', masks: [mask] });
    useTimelineStore.setState({ clips: [clip], clipKeyframes: new Map() });
    const inventory = readPhoneMaskInventory(clip, 1080 / 1920);
    expect(inventory.pen?.mask.id).toBe('pen1');
    expect(inventory.pen).toMatchObject({ feather: 6, inverted: true });
    expect(inventory.custom).toHaveLength(0);
  });

  it('pen store keeps the selection inside the path', () => {
    const store = usePhonePenStore.getState();
    store.begin('c', triangle());
    expect(usePhonePenStore.getState()).toMatchObject({ active: true, clipId: 'c', selected: 2 });
    usePhonePenStore.getState().update(undoPhonePenPoint, 2);
    expect(usePhonePenStore.getState().selected).toBeNull();
    usePhonePenStore.getState().end();
    expect(usePhonePenStore.getState()).toMatchObject({ active: false, clipId: null, path: EMPTY_PHONE_PEN_PATH });
  });
});
