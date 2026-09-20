import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeValuePreview } from '../../src/components/panels/nodes/previews/NodeValuePreview';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { describeNodePort } from '../../src/services/nodeGraph/nodePortPresentation';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import { imageOperatorKnownValues, imageOperatorValuePreview } from '../../src/services/nodePreview/imageOperatorPreviews';
import { previewTextStore } from '../../src/services/nodePreview/previewTextStore';
import { useTimelineStore } from '../../src/stores/timeline';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { getEditableDraggableNumberSettings, operatorConstantNumberPersistenceKey, saveEditableDraggableNumberSettings } from '../../src/components/common/EditableDraggableNumberSettings';

const initial = useTimelineStore.getState();
const owner = {};
afterEach(() => {
  cleanup();
  previewTextStore.retain(owner, new Set());
  useTimelineStore.setState(initial);
  localStorage.clear();
});

function fixture() {
  const graph = createDefaultInvertImageGraph();
  graph.nodes.push({ id: 'literal', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.25 } });
  graph.layout.literal = { x: 440, y: 220 };
  const effect: Effect = { id: 'invert-ui', name: 'Invert', type: 'invert', enabled: true, params: {}, operatorGraph: graph };
  const clip = createMockClip({ id: 'invert-clip', effects: [effect] });
  return { clip, effect };
}

describe('image operator node UI', () => {
  it('keeps UV-dependent distances as image previews while exposing uniform operands', () => {
    const effect: Effect = { id: 'vignette-ui', name: 'Vignette', type: 'vignette', enabled: true, params: {} };
    const clip = createMockClip({ id: 'vignette-clip', effects: [effect] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'distance')!;
    const request = { key: 'distance', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 };
    expect(imageOperatorValuePreview(request, clip, effect)).toBeUndefined();
    expect(imageOperatorKnownValues(request, clip, effect)).toEqual([{ portId: 'b', direction: 'input', value: 2 }]);
  });

  it('presents one adaptive RGBA split with image-context channel labels', () => {
    const { clip, effect } = fixture();
    const graph = buildEffectOperatorGraph(clip, effect);
    const split = graph.nodes.find(node => node.id === 'split')!;
    expect(split.outputs.map(port => [port.label, describeNodePort(port).typeLabel])).toEqual([
      ['R', 'Number'],
      ['G', 'Number'],
      ['B', 'Number'],
      ['A', 'Number'],
    ]);
    expect(split.operatorId).toBe('vector.split.vec4');
    expect(graph.nodes.find(node => node.id === 'invert-r')?.params?.bypassable).toBe(true);
  });

  it('edits an unbound node constant immediately through the standard inline number control', () => {
    const { clip, effect } = fixture();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'literal')!;
    node.preview = { enabled: true, requested: true, key: 'image-literal' };
    const frame = imageOperatorValuePreview({ key: 'image-literal', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 }, clip, effect)!;
    expect(frame.controls?.map(control => [control.direction, control.portId])).toContainEqual(['output', 'value']);
    expect(frame.values?.map(value => [value.direction, value.portId])).toContainEqual(['output', 'value']);
    previewTextStore.retain(owner, new Set(['image-literal']));
    act(() => previewTextStore.publish(frame));
    render(<NodeValuePreview node={node} />);
    const slider = screen.getByRole('slider', { name: 'Value Value inline' });
    expect(slider).toHaveAttribute('aria-valuenow', '0.25');
    expect(slider).toHaveAttribute('aria-valuemin', '-30');
    expect(slider).toHaveAttribute('aria-valuemax', '30');
    expect(screen.queryByRole('status', { name: 'Value output value live value' })).toBeNull();
    fireEvent.doubleClick(slider);
    const input = screen.getByRole('textbox', { name: 'Value Value inline' });
    fireEvent.change(input, { target: { value: '0.75' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    const saved = useTimelineStore.getState().clips[0].effects[0].operatorGraph?.nodes.find(candidate => candidate.id === 'literal');
    expect(saved?.constants?.value).toBe(0.75);
    expect(useTimelineStore.getState().clips[0].effects[0].params.value).toBeUndefined();
  });

  it('shares custom constant bounds/defaults across views and permits the offered finite literal range', () => {
    const { clip, effect } = fixture();
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'literal')!;
    node.preview = { enabled: true, requested: true, key: 'image-literal-settings' };
    const target = { clipId: clip.id, effectId: effect.id, nodeId: node.id, parameter: 'value' };
    const sharedKey = operatorConstantNumberPersistenceKey(target);
    saveEditableDraggableNumberSettings(sharedKey, { min: -100, max: 100, defaultValue: 4 });
    const frame = imageOperatorValuePreview({ key: 'image-literal-settings', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 }, clip, effect)!;
    previewTextStore.retain(owner, new Set(['image-literal-settings']));
    act(() => previewTextStore.publish(frame));
    render(<NodeValuePreview node={node} />);
    let slider = screen.getByRole('slider', { name: 'Value Value inline' });
    expect(slider).toHaveAttribute('aria-valuemin', '-100');
    expect(slider).toHaveAttribute('aria-valuemax', '100');
    fireEvent.doubleClick(slider);
    const input = screen.getByRole('textbox', { name: 'Value Value inline' });
    fireEvent.change(input, { target: { value: '175' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph?.nodes.find(candidate => candidate.id === 'literal')?.constants?.value).toBe(100);
    slider = screen.getByRole('slider', { name: 'Value Value inline' });
    fireEvent.contextMenu(slider);
    expect(useTimelineStore.getState().clips[0].effects[0].operatorGraph?.nodes.find(candidate => candidate.id === 'literal')?.constants?.value).toBe(4);
  });

  it('migrates an existing inspector constant preference into the shared semantic key', () => {
    localStorage.setItem('editable-draggable-number-settings:operator.invert-ui.literal.value', JSON.stringify({ min: -8, max: 8, defaultValue: 2 }));
    const key = operatorConstantNumberPersistenceKey({ clipId: 'invert-clip', effectId: 'invert-ui', nodeId: 'literal', parameter: 'value' });
    expect(getEditableDraggableNumberSettings(key)).toEqual({ min: -8, max: 8, defaultValue: 2 });
  });

  it('presents connected scalar operands and their result as calculated read-only values', () => {
    const { clip, effect } = fixture();
    effect.operatorGraph!.nodes.push(
      { id: 'literal-b', operator: 'values.number', operatorVersion: 1, bindings: {}, constants: { value: 0.1 } },
      { id: 'subtract', operator: 'math.subtract.scalar', operatorVersion: 1, bindings: {} },
    );
    Object.assign(effect.operatorGraph!.layout, { 'literal-b': { x: 440, y: 400 }, subtract: { x: 660, y: 300 } });
    effect.operatorGraph!.edges.push(
      { id: 'literal-a-subtract', from: 'literal', output: 'value', to: 'subtract', input: 'a' },
      { id: 'literal-b-subtract', from: 'literal-b', output: 'value', to: 'subtract', input: 'b' },
    );
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'subtract')!;
    const request = { key: 'subtract', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 };
    expect(imageOperatorValuePreview(request, clip, effect)?.drawing).toEqual({ kind: 'number', value: '0.15', caption: 'Result' });
    expect(imageOperatorKnownValues(request, clip, effect)).toEqual([
      { portId: 'a', direction: 'input', value: 0.25 },
      { portId: 'b', direction: 'input', value: 0.1 },
      { portId: 'value', direction: 'output', value: 0.15 },
    ]);
    effect.operatorGraph!.nodes.find(candidate => candidate.id === 'subtract')!.bypassed = true;
    expect(imageOperatorKnownValues(request, clip, effect).at(-1)).toEqual({ portId: 'value', direction: 'output', value: 0.1 });
  });

  it('routes a per-pixel subtract result to GPU preview while retaining its uniform A input', () => {
    const { clip, effect } = fixture();
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'invert-r')!;
    const request = { key: 'invert-r', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 };
    expect(imageOperatorValuePreview(request, clip, effect)).toBeUndefined();
    expect(imageOperatorKnownValues(request, clip, effect)).toEqual([{ portId: 'a', direction: 'input', value: 1 }]);
    effect.operatorGraph!.nodes.find(candidate => candidate.id === 'invert-r')!.bypassed = true;
    expect(imageOperatorKnownValues(request, clip, effect)).toEqual([{ portId: 'a', direction: 'input', value: 1 }]);
  });

  it('uses the shared IR for constant-only scalar calculations', () => {
    const { clip, effect } = fixture();
    effect.operatorGraph!.nodes.push({ id: 'gain', operator: 'math.exp2.scalar', operatorVersion: 1, bindings: {} });
    effect.operatorGraph!.layout.gain = { x: 660, y: 300 };
    effect.operatorGraph!.edges.push({ id: 'gain-input', from: 'literal', output: 'value', to: 'gain', input: 'value' });
    const node = buildEffectOperatorGraph(clip, effect).nodes.find(candidate => candidate.id === 'gain')!;
    const request = { key: 'gain', revision: '1', time: 0, clipId: clip.id, node,
      width: 164, height: 100, interval: 16, priority: 1 };
    const preview = imageOperatorValuePreview(request, clip, effect)!;
    expect(preview.drawing).toEqual({ kind: 'number', value: '1.1892', caption: 'Result' });
    expect(preview.controls).toEqual([]);
    expect(preview.values?.at(-1)?.value).toBeCloseTo(2 ** 0.25);
  });
});
