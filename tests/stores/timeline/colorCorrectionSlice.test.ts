import { describe, it, expect, beforeEach } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip } from '../../helpers/mockData';
import { createColorProperty, createDefaultColorCorrectionState } from '../../../src/types';

describe('colorCorrectionSlice', () => {
  let store: ReturnType<typeof createTestTimelineStore>;

  beforeEach(() => {
    store = createTestTimelineStore({
      clips: [
        createMockClip({
          id: 'clip-1',
          trackId: 'video-1',
          startTime: 0,
          duration: 10,
          colorCorrection: createDefaultColorCorrectionState(),
        }),
      ],
    });
  });

  it('removeColorNode removes keyframes and recording state for that node', () => {
    const property = createColorProperty('version_main', 'node_primary', 'exposure');
    store.getState().addKeyframe('clip-1', property, 0.5, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 0.7, 1);

    const colorKeyframeId = store.getState().clipKeyframes.get('clip-1')!
      .find(keyframe => keyframe.property === property)!.id;
    store.getState().selectKeyframe(colorKeyframeId);
    store.setState({
      keyframeRecordingEnabled: new Set([
        `clip-1:${property}`,
        'clip-1:opacity',
      ]),
    });

    store.getState().removeColorNode('clip-1', 'node_primary');

    const remainingKeyframes = store.getState().clipKeyframes.get('clip-1') ?? [];
    expect(remainingKeyframes.map(keyframe => keyframe.property)).toEqual(['opacity']);
    expect(store.getState().selectedKeyframeIds.has(colorKeyframeId)).toBe(false);
    expect(store.getState().keyframeRecordingEnabled.has(`clip-1:${property}`)).toBe(false);
    expect(store.getState().keyframeRecordingEnabled.has('clip-1:opacity')).toBe(true);
  });

  it('deleteColorVersion removes only keyframes and recording state for that version', () => {
    const versionBId = store.getState().duplicateColorVersion('clip-1');
    const versionAProperty = createColorProperty('version_main', 'node_primary', 'exposure');
    const versionBProperty = createColorProperty(versionBId, 'node_primary', 'exposure');

    store.getState().addKeyframe('clip-1', versionAProperty, 0.2, 1);
    store.getState().addKeyframe('clip-1', versionBProperty, 0.8, 2);
    store.setState({
      keyframeRecordingEnabled: new Set([
        `clip-1:${versionAProperty}`,
        `clip-1:${versionBProperty}`,
      ]),
    });

    store.getState().deleteColorVersion('clip-1', versionBId);

    const clip = store.getState().clips.find(candidate => candidate.id === 'clip-1')!;
    const remainingKeyframes = store.getState().clipKeyframes.get('clip-1') ?? [];
    expect(clip.colorCorrection?.versions.map(version => version.id)).toEqual(['version_main']);
    expect(clip.colorCorrection?.activeVersionId).toBe('version_main');
    expect(remainingKeyframes.map(keyframe => keyframe.property)).toEqual([versionAProperty]);
    expect(store.getState().keyframeRecordingEnabled.has(`clip-1:${versionAProperty}`)).toBe(true);
    expect(store.getState().keyframeRecordingEnabled.has(`clip-1:${versionBProperty}`)).toBe(false);
  });

  it('deleteColorVersion keeps the last remaining version', () => {
    store.getState().deleteColorVersion('clip-1', 'version_main');

    const clip = store.getState().clips.find(candidate => candidate.id === 'clip-1')!;
    expect(clip.colorCorrection?.versions).toHaveLength(1);
    expect(clip.colorCorrection?.activeVersionId).toBe('version_main');
  });

  it('adds wheels nodes and compiles flat lift gamma gain values', () => {
    const wheelsNodeId = store.getState().addColorNode('clip-1', 'wheels');
    const gainRProperty = createColorProperty('version_main', wheelsNodeId, 'gainR');
    const gainBProperty = createColorProperty('version_main', wheelsNodeId, 'gainB');

    store.getState().setPropertyValue('clip-1', gainRProperty, 1.4);
    store.getState().setPropertyValue('clip-1', gainBProperty, 0.8);

    const clip = store.getState().clips.find(candidate => candidate.id === 'clip-1')!;
    const version = clip.colorCorrection!.versions[0];
    const wheelsNode = version.nodes.find(node => node.id === wheelsNodeId);
    const grade = store.getState().getInterpolatedColorCorrection('clip-1', 0);

    expect(version.nodes.map(node => node.type)).toEqual(['input', 'primary', 'wheels', 'output']);
    expect(wheelsNode?.type).toBe('wheels');
    expect(wheelsNode?.params.gainR).toBe(1.4);
    expect(wheelsNode?.params.gainB).toBe(0.8);
    expect(grade?.nodeIds).toEqual([wheelsNodeId]);
    expect(grade?.primaryNodes[0].gainR).toBeCloseTo(1.4);
    expect(grade?.primaryNodes[0].gainB).toBeCloseTo(0.8);
    expect(grade?.primary.gainR).toBeCloseTo(1.4);
  });

  it('interpolates wheels keyframes through the color runtime grade', () => {
    const wheelsNodeId = store.getState().addColorNode('clip-1', 'wheels');
    const property = createColorProperty('version_main', wheelsNodeId, 'gammaG');

    store.getState().addKeyframe('clip-1', property, 1, 0);
    store.getState().addKeyframe('clip-1', property, 1.8, 10);

    const grade = store.getState().getInterpolatedColorCorrection('clip-1', 5);

    expect(grade?.nodeIds).toEqual([wheelsNodeId]);
    expect(grade?.primaryNodes[0].gammaG).toBeCloseTo(1.4);
  });

  it('removeColorNode removes wheel keyframes and recording state', () => {
    const wheelsNodeId = store.getState().addColorNode('clip-1', 'wheels');
    const property = createColorProperty('version_main', wheelsNodeId, 'liftR');

    store.getState().addKeyframe('clip-1', property, 0.2, 1);
    store.getState().addKeyframe('clip-1', 'opacity', 0.7, 1);
    store.setState({
      keyframeRecordingEnabled: new Set([
        `clip-1:${property}`,
        'clip-1:opacity',
      ]),
    });

    store.getState().removeColorNode('clip-1', wheelsNodeId);

    const remainingKeyframes = store.getState().clipKeyframes.get('clip-1') ?? [];
    expect(remainingKeyframes.map(keyframe => keyframe.property)).toEqual(['opacity']);
    expect(store.getState().keyframeRecordingEnabled.has(`clip-1:${property}`)).toBe(false);
    expect(store.getState().keyframeRecordingEnabled.has('clip-1:opacity')).toBe(true);
  });

  it('stores the color workspace viewport without touching graph data', () => {
    store.getState().setColorWorkspaceViewport('clip-1', { x: 120, y: -48, zoom: 1 });

    const clip = store.getState().clips.find(candidate => candidate.id === 'clip-1')!;
    expect(clip.colorCorrection?.ui.workspaceViewport).toEqual({ x: 120, y: -48, zoom: 1 });
    expect(clip.colorCorrection?.versions[0].nodes.map(node => node.id)).toEqual([
      'node_input',
      'node_primary',
      'node_output',
    ]);
  });
});
