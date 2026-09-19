import { waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import type { ClipNodeGraph } from '../../src/types/nodeGraph';
import { DEFAULT_MODEL_MATERIAL_SETTINGS } from '../../src/types/modelMaterial';
import { DEFAULT_TRACKS, useTimelineStore } from '../../src/stores/timeline';
import { DEFAULT_TEXT_3D_PROPERTIES, DEFAULT_TEXT_PROPERTIES } from '../../src/stores/timeline/constants';
import { useMediaStore } from '../../src/stores/mediaStore';
import { playheadState } from '../../src/services/layerBuilder/PlayheadState';
import { createMockClip, createMockKeyframe } from '../helpers/mockData';

function graph(): ClipNodeGraph {
  return {
    version: 1,
    nodes: [
      { id: 'source', backing: { kind: 'clip-source' }, layout: { x: 20, y: 30 } },
      { id: 'effect-blur', backing: { kind: 'clip-effect', effectId: 'blur' }, layout: { x: 220, y: 80 } },
      { id: 'output', backing: { kind: 'clip-output' }, layout: { x: 460, y: 30 } },
    ],
    manualEdges: [
      { id: 'source-to-blur', fromNodeId: 'source', fromPortId: 'texture', toNodeId: 'effect-blur', toPortId: 'texture', type: 'texture' },
      { id: 'blur-to-output', fromNodeId: 'effect-blur', fromPortId: 'texture', toNodeId: 'output', toPortId: 'texture', type: 'texture' },
    ],
  };
}

function clipContent(kind: string): Partial<TimelineClip> {
  if (kind === 'text') return {
    source: { type: 'text', textCanvas: document.createElement('canvas') },
    textProperties: { ...DEFAULT_TEXT_PROPERTIES, text: 'Copied title\nPreserved content', fontFamily: 'Roboto', fontSize: 82, color: '#123456', strokeEnabled: true, boxEnabled: false },
  };
  if (kind === 'camera') return {
    source: { type: 'camera', cameraSettings: { fov: 32, near: 0.25, far: 600, resolutionWidth: 1280, resolutionHeight: 720 } },
  };
  const text3DProperties = kind === 'text3d'
    ? { ...DEFAULT_TEXT_3D_PROPERTIES, text: 'Copied 3D title', depth: 0.3, bevelEnabled: true }
    : undefined;
  const meshType = kind === 'text3d' ? 'text3d' as const : 'torus' as const;
  return {
    is3D: true, meshType, text3DProperties,
    source: { type: 'model', meshType, text3DProperties, modelMaterialSettings: { ...DEFAULT_MODEL_MATERIAL_SETTINGS, overrideBaseColor: true, baseColor: '#abcd12' } },
  };
}

describe('synthetic clip clipboard content', () => {
  beforeEach(() => {
    playheadState.isUsingInternalPosition = false;
    useTimelineStore.setState({
      tracks: DEFAULT_TRACKS, clips: [], selectedClipIds: new Set(), primarySelectedClipId: null,
      clipboardData: null, clipKeyframes: new Map(), playheadPosition: 20, duration: 60, targetTrackIdByType: {},
    });
    vi.mocked(useMediaStore.getState).mockReturnValue({ files: [], compositions: [], activeCompositionId: null } as unknown as ReturnType<typeof useMediaStore.getState>);
  });

  it.each(['text', 'camera', 'mesh', 'text3d'])('copies and pastes %s with its content, configuration, node connections and automation', async (kind) => {
    const source = createMockClip({
      id: 'original', trackId: 'video-1', name: `Saved ${kind}`, startTime: 3, duration: 5,
      ...clipContent(kind), nodeGraph: graph(),
      effects: [{ id: 'blur', type: 'blur', name: 'Blur', enabled: true, params: { radius: 12 } }],
    });
    const key = createMockKeyframe({ clipId: source.id, property: 'effect.blur.radius', time: 1, value: 9 });
    useTimelineStore.setState({ clips: [source], selectedClipIds: new Set([source.id]), clipKeyframes: new Map([[source.id, [key]]]) });
    useTimelineStore.getState().copyClips();
    useTimelineStore.getState().pasteClips();
    await waitFor(() => {
      expect(useTimelineStore.getState().clips).toHaveLength(2);
      expect(useTimelineStore.getState().clips[1].isLoading).toBe(false);
    });
    const pasted = useTimelineStore.getState().clips[1];
    expect(pasted.id).not.toBe(source.id);
    expect(pasted.startTime).toBe(20);
    expect(pasted.textProperties).toEqual(source.textProperties);
    expect(pasted.text3DProperties).toEqual(source.text3DProperties);
    expect(pasted.source?.text3DProperties).toEqual(source.source?.text3DProperties);
    expect(pasted.source?.cameraSettings).toEqual(source.source?.cameraSettings);
    expect(pasted.source?.modelMaterialSettings).toEqual(source.source?.modelMaterialSettings);
    expect(pasted.source?.meshType).toEqual(source.source?.meshType);
    if (kind === 'text') {
      expect(pasted.source?.textCanvas).toBeInstanceOf(HTMLCanvasElement);
      expect(pasted.source?.textCanvas).not.toBe(source.source?.textCanvas);
    }
    const effectId = pasted.effects[0].id;
    expect(effectId).not.toBe('blur');
    expect(pasted.effects[0].params).toEqual({ radius: 12 });
    expect(pasted.nodeGraph?.nodes[1]).toEqual({ id: `effect-${effectId}`, backing: { kind: 'clip-effect', effectId }, layout: { x: 220, y: 80 } });
    expect(pasted.nodeGraph?.manualEdges?.[0]).toMatchObject({ fromNodeId: 'source', toNodeId: `effect-${effectId}` });
    expect(pasted.nodeGraph?.manualEdges?.[1]).toMatchObject({ fromNodeId: `effect-${effectId}`, toNodeId: 'output' });
    expect(useTimelineStore.getState().clipKeyframes.get(pasted.id)?.[0]).toMatchObject({ clipId: pasted.id, property: `effect.${effectId}.radius`, time: 1, value: 9 });
    pasted.nodeGraph!.nodes[1].layout.x = 999;
    expect(source.nodeGraph!.nodes[1].layout.x).toBe(220);
    expect(useTimelineStore.getState().clipboardData![0].nodeGraph!.nodes[1].layout.x).toBe(220);
  });
});
