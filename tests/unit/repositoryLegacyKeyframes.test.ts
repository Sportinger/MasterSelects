import { describe, expect, it } from 'vitest';
import { normalizeLegacyClipKeyframes, normalizeLegacyProjectForRepository } from '../../src/services/project/repository/import/legacyProjectCompatibility';
import { encodeCompositionClip } from '../../src/services/project/repository/domains/projectDomains';
import { decodeAggregate, entityKey } from '../../src/services/project/repository/domains/jsonBoundary';
import type { ProjectClip } from '../../src/services/project/types/composition.types';
import type { ProjectFile } from '../../src/services/project/types/project.types';

function clip(keyframes: unknown[]): ProjectClip {
  return { id: 'clip', trackId: 'video', startTime: 0, duration: 10, inPoint: 0, outPoint: 10,
    effects: [], masks: [], keyframes } as ProjectClip;
}
describe('legacy runtime keyframe conversion', () => {
  it('imports the fade keyframe shape found in older project packages without changing its curve', () => {
    const frames = [
      { id: 'fade-zero', clipId: 'clip', property: 'opacity', time: 0, value: 0, easing: 'ease-out' },
      { id: 'fade-one', clipId: 'clip', property: 'opacity', time: 4.106370327183125, value: 1, easing: 'linear' },
    ];
    const original = clip(frames), normalized = normalizeLegacyClipKeyframes(original);
    const encoded = encodeCompositionClip('composition', normalized);
    expect(decodeAggregate(entityKey('clip', 'composition', 'clip'), encoded)).toMatchObject({ keyframes: frames.map(({ clipId: _owner, ...curve }) => curve) });
    expect(original.keyframes).toBe(frames); expect(frames[0].clipId).toBe('clip');
  });
  it('preserves handles, holds, rotation, mask paths and materialized animation links', () => {
    const frame = { id: 'full', clipId: 'clip', property: 'mask.mask.path', time: 2.5, value: 1, easing: 'bezier',
      hold: true, rotationInterpolation: 'continuous', handleIn: { x: -0.2, y: 0.1 }, handleOut: { x: 0.3, y: 0.4 },
      bezierHandles: { x1: 0.2, y1: 0.3, x2: 0.7, y2: 0.8 },
      animationSource: { nodeId: 'node', channelId: 'channel', keyframeId: 'source-frame' },
      pathValue: { vertices: [{ id: 'vertex', x: 0.2, y: 0.4, handleIn: { x: 0, y: 0 }, handleOut: { x: 1, y: 1 }, handleMode: 'free' }], closed: true },
    };
    const normalized = normalizeLegacyClipKeyframes(clip([frame]));
    const { clipId: _owner, ...authored } = frame;
    expect(normalized.keyframes).toEqual([authored]);
    expect(decodeAggregate(entityKey('clip', 'composition', 'clip'), encodeCompositionClip('composition', normalized))).toMatchObject({ keyframes: [authored] });
  });
  it('retains strict validation and never silently reassigns a mismatched legacy owner', () => {
    expect(() => normalizeLegacyClipKeyframes(clip([{ id: 'bad', clipId: 'other' }]))).toThrow('different clip');
    const normalized = normalizeLegacyClipKeyframes(clip([{ id: 'unknown', clipId: 'clip', futureField: 1 }]));
    expect(() => encodeCompositionClip('composition', normalized)).toThrow('futureField');
  });
  it('changes only affected project/clip shells and keeps source data immutable', () => {
    const affected = clip([{ id: 'legacy', clipId: 'clip', time: 0, property: 'opacity', value: 0, easing: 'linear' }]);
    const untouched = { ...clip([]), id: 'untouched' };
    const project = { compositions: [{ id: 'composition', clips: [affected, untouched] }] } as unknown as ProjectFile;
    const normalized = normalizeLegacyProjectForRepository(project);
    expect(normalized).not.toBe(project); expect(normalized.compositions[0].clips[1]).toBe(untouched);
    expect(project.compositions[0].clips[0]).toBe(affected);
  });
});
