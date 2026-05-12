import { describe, expect, it } from 'vitest';
import { createTestTimelineStore } from '../../helpers/storeFactory';
import { createMockClip, createMockKeyframe } from '../../helpers/mockData';
import {
  createEffectProperty,
  createNodeGraphParamProperty,
  type AnimatableProperty,
  type ClipCustomNodeDefinition,
} from '../../../src/types';

function createAINodeDefinition(): ClipCustomNodeDefinition {
  return {
    id: 'custom-ai',
    label: 'AI Node',
    runtime: 'typescript',
    status: 'ready',
    inputs: [
      { id: 'input', label: 'texture', type: 'texture', direction: 'input' },
      { id: 'time', label: 'time', type: 'time', direction: 'input' },
      { id: 'metadata', label: 'metadata', type: 'metadata', direction: 'input' },
    ],
    outputs: [
      { id: 'output', label: 'texture', type: 'texture', direction: 'output' },
    ],
    parameterSchema: [
      { id: 'amount', label: 'Amount', type: 'number', default: 0.5 },
      { id: 'speed', label: 'Speed', type: 'number', default: 1 },
    ],
    params: { amount: 0.5, speed: 1 },
    ai: {
      prompt: '',
      generatedCode: 'defineNode({ process(input) { return { output: input.input }; } })',
    },
  };
}

describe('nodeGraphSlice', () => {
  it('clears exposed AI params and node keyframes when active code is emptied', () => {
    const amountProperty = createNodeGraphParamProperty('custom-ai', 'amount');
    const opacityProperty = 'opacity' as AnimatableProperty;
    const clip = createMockClip({
      id: 'clip-ai',
      trackId: 'video-1',
      duration: 10,
      nodeGraph: {
        version: 1,
        nodes: [],
        customNodes: [createAINodeDefinition()],
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      clipKeyframes: new Map([
        ['clip-ai', [
          createMockKeyframe({ id: 'kf-node', clipId: 'clip-ai', property: amountProperty, value: 0.2 }),
          createMockKeyframe({ id: 'kf-opacity', clipId: 'clip-ai', property: opacityProperty, value: 1 }),
        ]],
      ]),
      keyframeRecordingEnabled: new Set([`clip-ai:${amountProperty}`, `clip-ai:${opacityProperty}`]),
      selectedKeyframeIds: new Set(['kf-node', 'kf-opacity']),
      expandedCurveProperties: new Map([
        ['video-1', new Set([amountProperty, opacityProperty])],
      ]),
    });

    store.getState().updateClipAICustomNode('clip-ai', 'custom-ai', {
      ai: { generatedCode: '' },
    });

    const node = store.getState().clips[0].nodeGraph?.customNodes?.[0];
    expect(node?.status).toBe('draft');
    expect(node?.ai.generatedCode).toBe('');
    expect(node?.parameterSchema).toEqual([]);
    expect(node?.params).toEqual({});
    expect(store.getState().clipKeyframes.get('clip-ai')?.map((keyframe) => keyframe.id)).toEqual(['kf-opacity']);
    expect(store.getState().keyframeRecordingEnabled).toEqual(new Set([`clip-ai:${opacityProperty}`]));
    expect(store.getState().selectedKeyframeIds).toEqual(new Set(['kf-opacity']));
    expect(store.getState().expandedCurveProperties.get('video-1')).toEqual(new Set([opacityProperty]));
  });

  it('removes stale AI param keyframes when generated code exposes a smaller schema', () => {
    const amountProperty = createNodeGraphParamProperty('custom-ai', 'amount');
    const speedProperty = createNodeGraphParamProperty('custom-ai', 'speed');
    const clip = createMockClip({
      id: 'clip-ai',
      trackId: 'video-1',
      nodeGraph: {
        version: 1,
        nodes: [],
        customNodes: [createAINodeDefinition()],
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      clipKeyframes: new Map([
        ['clip-ai', [
          createMockKeyframe({ id: 'kf-amount', clipId: 'clip-ai', property: amountProperty, value: 0.2 }),
          createMockKeyframe({ id: 'kf-speed', clipId: 'clip-ai', property: speedProperty, value: 2 }),
        ]],
      ]),
      keyframeRecordingEnabled: new Set([`clip-ai:${amountProperty}`, `clip-ai:${speedProperty}`]),
    });

    store.getState().updateClipAICustomNode('clip-ai', 'custom-ai', {
      parameterSchema: [{ id: 'speed', label: 'Speed', type: 'number', default: 1 }],
      params: { speed: 1 },
    });

    expect(store.getState().clipKeyframes.get('clip-ai')?.map((keyframe) => keyframe.id)).toEqual(['kf-speed']);
    expect(store.getState().keyframeRecordingEnabled).toEqual(new Set([`clip-ai:${speedProperty}`]));
  });

  it('deletes custom nodes and removes their parameter timeline state', () => {
    const amountProperty = createNodeGraphParamProperty('custom-ai', 'amount');
    const clip = createMockClip({
      id: 'clip-ai',
      trackId: 'video-1',
      nodeGraph: {
        version: 1,
        nodes: [],
        customNodes: [createAINodeDefinition()],
      },
    });
    const store = createTestTimelineStore({
      clips: [clip],
      clipKeyframes: new Map([
        ['clip-ai', [createMockKeyframe({ id: 'kf-node', clipId: 'clip-ai', property: amountProperty, value: 0.2 })]],
      ]),
      keyframeRecordingEnabled: new Set([`clip-ai:${amountProperty}`]),
      selectedKeyframeIds: new Set(['kf-node']),
    });

    store.getState().removeClipNodeGraphNode('clip-ai', 'custom-ai');

    expect(store.getState().clips[0].nodeGraph?.customNodes).toBeUndefined();
    expect(store.getState().clipKeyframes.has('clip-ai')).toBe(false);
    expect(store.getState().keyframeRecordingEnabled.size).toBe(0);
    expect(store.getState().selectedKeyframeIds.size).toBe(0);
  });

  it('deletes effect nodes and removes their effect keyframes', () => {
    const effectProperty = createEffectProperty('fx-1', 'brightness') as AnimatableProperty;
    const opacityProperty = 'opacity' as AnimatableProperty;
    const clip = createMockClip({
      id: 'clip-fx',
      trackId: 'video-1',
      effects: [
        { id: 'fx-1', type: 'brightness', name: 'Brightness', enabled: true, params: { brightness: 1 } },
      ],
    });
    const store = createTestTimelineStore({
      clips: [clip],
      clipKeyframes: new Map([
        ['clip-fx', [
          createMockKeyframe({ id: 'kf-effect', clipId: 'clip-fx', property: effectProperty, value: 1 }),
          createMockKeyframe({ id: 'kf-opacity', clipId: 'clip-fx', property: opacityProperty, value: 1 }),
        ]],
      ]),
      keyframeRecordingEnabled: new Set([`clip-fx:${effectProperty}`, `clip-fx:${opacityProperty}`]),
    });

    store.getState().removeClipNodeGraphNode('clip-fx', 'effect-fx-1');

    expect(store.getState().clips[0].effects).toEqual([]);
    expect(store.getState().clipKeyframes.get('clip-fx')?.map((keyframe) => keyframe.id)).toEqual(['kf-opacity']);
    expect(store.getState().keyframeRecordingEnabled).toEqual(new Set([`clip-fx:${opacityProperty}`]));
  });
});
