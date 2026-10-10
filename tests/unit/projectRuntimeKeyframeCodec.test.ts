import { describe, expect, it } from 'vitest';
import { convertRuntimeProjectClip } from '../../src/services/project/projectCompositionSerialization';
import { encodeCompositionClip } from '../../src/services/project/repository/domains/projectDomains';
import { decodeAggregate, entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import type { TimelineClip } from '../../src/types/timeline';
import type { Keyframe } from '../../src/types/keyframes';

function runtimeClip(): TimelineClip {
  return { id: 'clip', trackId: 'video', name: 'Fade clip', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
    source: { type: 'video' }, effects: [], masks: [], transform: { position: { x: 0, y: 0, z: 0 },
      anchor: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 }, opacity: 1, blendMode: 'normal' },
  } as unknown as TimelineClip;
}
describe('current runtime keyframe canonical serialization', () => {
  it('encodes a newly authored fade without runtime clipId while preserving curve and linked animation fields', () => {
    const frame: Keyframe = { id: 'fade', clipId: 'clip', property: 'opacity', time: 4.106370327183125,
      value: 1, easing: 'ease-out', hold: true, rotationInterpolation: 'continuous', cameraOrbitPivot: { x: 2, y: -1, z: 3 },
      handleIn: { x: -0.2, y: 0.1 }, handleOut: { x: 0.3, y: 0.4 },
      animationSource: { nodeId: 'node', channelId: 'channel', keyframeId: 'original-frame' },
    };
    const saved = convertRuntimeProjectClip(runtimeClip(), [frame]);
    const { clipId: _owner, ...authored } = frame;
    expect(saved.keyframes).toEqual([authored]); expect(frame.clipId).toBe('clip');
    expect(decodeAggregate(entityKey('clip', 'composition', 'clip'), encodeCompositionClip('composition', saved))).toMatchObject({ keyframes: [authored] });
  });
  it('keeps existing mask edge property conversion when removing the runtime owner', () => {
    const clip = runtimeClip(); clip.masks = [{ id: 'mask', name: 'Mask', mode: 'add', enabled: true,
      vertices: [{ id: 'left', x: 0, y: 0 }, { id: 'right', x: 1, y: 1 }], closed: true, position: { x: 0, y: 0 },
    }] as unknown as TimelineClip['masks'];
    const frame: Keyframe = { id: 'edge', clipId: 'clip', property: 'mask.mask.edge.left->right.feather', time: 1, value: 4, easing: 'linear' };
    const saved = convertRuntimeProjectClip(clip, [frame]);
    expect(saved.keyframes[0]).toEqual({ id: 'edge', property: 'mask.mask.edge.0->1.feather', time: 1, value: 4, easing: 'linear' });
    expect(frame.property).toBe('mask.mask.edge.left->right.feather');
  });
});
