import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, cleanup, act } from '@testing-library/react';
import { PreviewTextStore, previewTextStore } from '../../src/services/nodePreview/previewTextStore';
import { NodeValuePreview } from '../../src/components/panels/nodes/previews/NodeValuePreview';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { voxelPreview } from '../../src/services/nodePreview/voxelPreviews';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { useTimelineStore } from '../../src/stores/timeline';
import { compileVoxelGraph } from '../../src/services/operators/voxelGraph';
import type { PreviewFrame } from '../../src/services/nodePreview/previewTypes';
import { scalarPreviewSamples } from '../../src/services/nodePreview/scalarPreviewSamples';
import { nodeScalarSampleTap } from '../../src/services/nodePreview/NodeScalarSampleTap';

const initial = useTimelineStore.getState(), owner = {};
afterEach(() => { cleanup(); previewTextStore.retain(owner, new Set()); useTimelineStore.setState(initial); });
describe('DOM node values', () => {
  it('reevaluates every operand immediately from the last GPU sample while another readback is pending', async () => {
    const clip = createMockClip({ id: 'live-math', effects: [{ id: 'relief-live', name: 'Relief', type: 'voxel-relief', enabled: true, params: {} }] });
    const effect = clip.effects[0], node = buildEffectOperatorGraph(clip, effect).nodes.find(node => node.id === 'height')!;
    const sampleKey = scalarPreviewSamples.key(clip.id, 'voxel-effect:relief-live', [1, 1, 0, 0], 107.4, false);
    scalarPreviewSamples.publish(sampleKey, [0.5, 0.5, 0.5, 1]);
    const pending = vi.spyOn(nodeScalarSampleTap, 'request').mockImplementation(() => new Promise(() => {}));
    try {
      const request = { key: 'live-math', revision: '1', time: 0, clipId: clip.id, node, width: 164, height: 100, interval: 16, priority: 1 };
      const before = await voxelPreview(request, clip, effect, [], 0);
      const after = await voxelPreview({ ...request, revision: 'drag' }, clip, { ...effect, params: { height: 2 } }, [], 0);
      expect(before.values?.find(value => value.direction === 'output')?.value).toBeCloseTo(0.15);
      expect(after.values?.find(value => value.direction === 'output')?.value).toBeCloseTo(0.25);
      expect(after.controls?.find(control => control.portId === 'b')?.value).toBe(2);
    } finally { pending.mockRestore(); scalarPreviewSamples.cancelClip(clip.id); }
  });
  it('deduplicates unchanged values and releases data when its last workspace closes', () => {
    const store = new PreviewTextStore(), a = {}, b = {}, changed = vi.fn();
    store.retain(a, new Set(['value'])); store.retain(b, new Set(['value'])); store.subscribe('value', changed);
    const frame: PreviewFrame = { key: 'value', revision: '1', time: 0, status: 'live', label: 'Value', drawing: { kind: 'number', value: '2', caption: 'Output' } };
    store.publish(frame); store.publish({ ...frame, revision: '2', time: 1 });
    expect(changed).toHaveBeenCalledTimes(1);
    store.retain(a, new Set()); expect(store.get('value')).toBeDefined();
    store.retain(b, new Set()); expect(store.get('value')).toBeUndefined();
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('renders a real editable input below its port and changes the owning graph', async () => {
    const clip = createMockClip({ id: 'clip', effects: [{ id: 'relief', name: 'Relief', type: 'voxel-relief', enabled: true, params: {} }] });
    useTimelineStore.setState({ clips: [clip], tracks: [createMockTrack({ id: clip.trackId })] });
    const node = buildEffectOperatorGraph(clip, clip.effects[0]).nodes.find(node => node.id === 'height')!;
    node.preview = { enabled: true, requested: true, key: 'inline-test' };
    previewTextStore.retain(owner, new Set(['inline-test']));
    const frame = await voxelPreview({ key: 'inline-test', revision: '1', time: 0, clipId: clip.id, node, width: 164, height: 100, interval: 100, priority: 1 }, clip, clip.effects[0], [], 0);
    act(() => { previewTextStore.publish(frame); });
    const view = render(<NodeValuePreview node={node} />);
    const value = screen.getByRole('slider', { name: 'Multiply Height inline' });
    expect(value.closest('[aria-label="Value below b"]')).not.toBeNull();
    expect(view.container.querySelector('canvas,img')).toBeNull();
    fireEvent.doubleClick(value);
    const input = screen.getByRole('textbox', { name: 'Multiply Height inline' });
    fireEvent.change(input, { target: { value: '0.4' } }); fireEvent.keyDown(input, { key: 'Enter' });
    // The edited number follows the input immediately, even before another
    // preview frame arrives with the downstream calculation.
    expect(screen.getByRole('slider', { name: 'Multiply Height inline' })).toHaveAttribute('aria-valuenow', '0.4');
    expect(compileVoxelGraph(useTimelineStore.getState().clips[0].effects[0].params).maxHeight).toBeCloseTo(0.415);
    expect(screen.getByRole('status', { name: 'Multiply output value live value' })).toHaveTextContent('—');
  });
});
