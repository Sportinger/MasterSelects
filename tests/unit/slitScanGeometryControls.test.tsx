import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SlitScanGeometryControls } from '../../src/components/panels/properties/SlitScanGeometryControls';
import * as graphOwner from '../../src/services/operators/effectGraphOwner';
import { useTimelineStore } from '../../src/stores/timeline';
import { getDefaultParams } from '../../src/effects';
import { createMockClip } from '../helpers/mockData';
import { configureInspectorGraphWorker } from '../../src/services/operators/inspectorGraphClient';

const initial = useTimelineStore.getState();
beforeEach(() => configureInspectorGraphWorker(() => new class {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror = null;
  terminate() {}
  postMessage({ id, input }: { id: number; input: Parameters<typeof graphOwner.effectOperatorGraph>[0] }) {
    queueMicrotask(() => this.onmessage?.({ data: { id, graph: graphOwner.effectOperatorGraph(input, { inspectionOnly: true }) } } as MessageEvent));
  }
}()));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useTimelineStore.setState(initial); });

it('keeps sampler discovery warm across playhead snapshots and value edits', async () => {
  const params = { ...getDefaultParams('slit-scan'), geometryMode: 'time-surface', geometrySampler: 'history' };
  const clip = createMockClip({ id: 'geometry-clip', effects: [{ id: 'scan', name: 'Slit Scan', type: 'slit-scan', enabled: true, params }] });
  useTimelineStore.setState({ clips: [clip] });
  const discover = vi.spyOn(graphOwner, 'effectOperatorGraph');
  const onChange = vi.fn();
  const view = render(<SlitScanGeometryControls clipId={clip.id} effectInstanceId="scan" params={params} onChange={onChange} />);
  await waitFor(() => expect(discover).toHaveBeenCalled());
  const initialCalls = discover.mock.calls.length;
  expect(initialCalls).toBeGreaterThan(0);
  for (const depth of [0.5, 1, 2]) {
    act(() => useTimelineStore.setState({ playheadPosition: depth }));
    view.rerender(<SlitScanGeometryControls clipId={clip.id} effectInstanceId="scan"
      params={{ ...params, geometryTimeDepth: depth }} onChange={onChange} />);
    expect(screen.getByRole('slider', { name: 'Time depth / sec', exact: true })).toHaveAttribute('aria-valuenow', String(depth));
  }
  expect(discover).toHaveBeenCalledTimes(initialCalls);
  act(() => useTimelineStore.getState().updateClipEffect(clip.id, 'scan', { profile: 'wave' }));
  expect(discover).toHaveBeenCalledTimes(initialCalls);
});

it.each([false, true])('returns an existing 3D layer to 2D on bypass (effect promotion: %s)', geometryPromoted3D => {
  const params = { ...getDefaultParams('slit-scan'), geometryMode: 'motion-surface', geometrySampler: 'history', geometryPromoted3D };
  const clip = createMockClip({ id: 'geometry-layer', is3D: true,
    effects: [{ id: 'scan', name: 'Slit Scan', type: 'slit-scan', enabled: true, params }] });
  useTimelineStore.setState({ clips: [clip] });
  const onChange = vi.fn();
  render(<SlitScanGeometryControls clipId={clip.id} effectInstanceId="scan" params={params} onChange={onChange} />);
  fireEvent.click(screen.getByRole('switch', { name: 'Disable 3D geometry' }));
  expect(useTimelineStore.getState().clips.find(item => item.id === clip.id)?.is3D).toBe(false);
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ geometryMode: '2d', geometryLastMode: 'motion-surface' }));
});
