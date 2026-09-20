import { expect, it } from 'vitest';
import { createPastedClipboardClipsPlan } from '../../src/stores/timeline/clipboard/clipboardClipPastePlanner';
import { createMaskEdgeFeatherProperty } from '../../src/types/animationProperties';
import type { ClipboardClipData } from '../../src/stores/timeline/types';
import type { ClipMask } from '../../src/types/masks';
import { createMockTrack, createMockTransform } from '../helpers/mockData';

it('keeps pasted node animation bound to the new mask and feather-edge vertices', () => {
  const mask: ClipMask = { id: 'mask-old', name: 'Mask', closed: true, opacity: 1, feather: 0, featherQuality: 1,
    inverted: false, mode: 'add', expanded: true, position: { x: 0, y: 0 }, enabled: true, visible: true,
    vertices: ['a', 'b', 'c'].map((id, i) => ({ id, x: i / 3, y: i / 3, handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } })) };
  const edgeProperty = createMaskEdgeFeatherProperty(mask.id, 'a->b');
  const source: ClipboardClipData = { id: 'source', trackId: 'video-1', trackType: 'video', name: 'Source',
    startTime: 0, duration: 5, inPoint: 0, outPoint: 5, sourceType: 'video', naturalDuration: 5,
    transform: createMockTransform(), effects: [], masks: [mask],
    nodeGraph: { version: 1, nodes: [], keyframeNodes: [{ id: 'curve', label: 'Mask animation', layout: { x: 0, y: 0 },
      channels: [{ id: 'channel', property: edgeProperty, targets: [{ property: 'mask.mask-old.feather', scale: 1, offset: 0 }] }] }] } };
  let id = 0;
  const result = createPastedClipboardClipsPlan({ clipboardData: [source], playheadPosition: 10,
    tracks: [createMockTrack({ id: 'video-1' })], clipKeyframes: new Map(), timestamp: 100, createSuffix: () => String(++id) });
  const pasted = result.newClips[0], copiedMask = pasted.masks![0], channel = pasted.nodeGraph!.keyframeNodes![0].channels[0];
  expect(copiedMask.id).not.toBe(mask.id);
  expect(channel.property).toBe(createMaskEdgeFeatherProperty(copiedMask.id, `${copiedMask.vertices[0].id}->${copiedMask.vertices[1].id}`));
  expect(channel.targets[0].property).toBe(`mask.${copiedMask.id}.feather`);
  expect(source.nodeGraph!.keyframeNodes![0].channels[0].property).toBe(edgeProperty);
  expect(mask.vertices.map(vertex => vertex.id)).toEqual(['a', 'b', 'c']);
});
