import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SlitScanGeometryControls } from '../../src/components/panels/properties/SlitScanGeometryControls';
import * as graphOwner from '../../src/services/operators/effectGraphOwner';
import { useTimelineStore } from '../../src/stores/timeline';
import { getDefaultParams } from '../../src/effects';
import { createMockClip } from '../helpers/mockData';

const initial = useTimelineStore.getState();
afterEach(() => { cleanup(); vi.restoreAllMocks(); useTimelineStore.setState(initial); });

it('keeps sampler discovery warm across playhead snapshots while displaying animated values', () => {
  const params = { ...getDefaultParams('slit-scan'), geometryMode: 'time-surface', geometrySampler: 'history' };
  const clip = createMockClip({ id: 'geometry-clip', effects: [{ id: 'scan', name: 'Slit Scan', type: 'slit-scan', enabled: true, params }] });
  useTimelineStore.setState({ clips: [clip] });
  const discover = vi.spyOn(graphOwner, 'effectOperatorGraph');
  const onChange = vi.fn();
  const view = render(<SlitScanGeometryControls clipId={clip.id} effectInstanceId="scan" params={params} onChange={onChange} />);
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
  expect(discover.mock.calls.length).toBeGreaterThan(initialCalls);
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
