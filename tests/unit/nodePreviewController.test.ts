import { afterEach, expect, it, vi } from 'vitest';
import { NodePreviewController } from '../../src/components/panels/nodes/previews/NodePreviewController';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { PreviewFrame, PreviewRequest } from '../../src/services/nodePreview/previewTypes';
import { previewTextStore } from '../../src/services/nodePreview/previewTextStore';

const mocked = vi.hoisted(() => ({
  state: { clips: [], clipKeyframes: new Map(), playheadPosition: 0, isPlaying: false, isExporting: false },
  produce: vi.fn((request: PreviewRequest): PreviewFrame => ({ key: request.key, revision: request.revision, time: request.time,
    status: 'live', label: 'Source', drawing: { kind: 'plot', values: [0, 1] } })),
}));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => mocked.state, subscribe: () => () => {} } }));
vi.mock('../../src/stores/landmarkTrackingStore', () => ({ useLandmarkTrackingStore: { subscribe: () => () => {} } }));
vi.mock('../../src/services/nodePreview/PreviewArtifactReader', () => ({ PreviewArtifactReader: class { dispose() {} } }));
vi.mock('../../src/services/nodePreview/NodePreviewTextureTap', () => ({ nodePreviewTextureTap: { cancelClip: vi.fn() } }));
vi.mock('../../src/services/nodePreview/previewSources', () => ({ produceNodePreview: mocked.produce }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocked.produce.mockReset(); });

it('budgets synchronous preview compilation after lazy loading instead of releasing a microtask burst', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let cpuTime = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => cpuTime);
  mocked.produce.mockImplementation(request => {
    cpuTime += 3; // One expensive numeric preview exceeds the 2 ms tick budget.
    return { key: request.key, revision: request.revision, time: request.time,
      status: 'live', label: 'Value', drawing: { kind: 'number', value: '2', caption: 'Output' } };
  });
  const host = document.createElement('div');
  const controller = new NodePreviewController({ preview: vi.fn(), software: false, previewBusy: false }, host);
  const nodes = Array.from({ length: 24 }, (_, index) => ({ ...connectionFixture.nodes[0], id: `value-${index}`,
    operatorId: 'values.number', layout: { x: 0, y: 0 }, preview: { key: `value-${index}`, enabled: true, requested: true } }));
  controller.scene('clip', nodes, null);
  controller.viewport({ width: 800, height: 600, panX: 0, panY: 0, ratio: 1, zoom: 1 });
  try {
    await vi.advanceTimersByTimeAsync(1);
    expect(mocked.produce).toHaveBeenCalledTimes(1);
    expect(JSON.parse(host.dataset.previewStats!).workMs).toBeGreaterThanOrEqual(3);
    await vi.advanceTimersByTimeAsync(400);
    expect(new Set(mocked.produce.mock.calls.map(call => call[0].key)).size).toBe(24);
  } finally { controller.dispose(); }
});

it('keeps paused previews cached across continuous zoom and atlas tiers', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const publish = vi.fn();
  const controller = new NodePreviewController({ preview: publish, software: false, previewBusy: false }, document.createElement('div'));
  const view = { width: 800, height: 600, panX: 0, panY: 0, ratio: 1, zoom: 0.3499 };
  controller.scene('clip', [{ ...connectionFixture.nodes[0], preview: { key: 'source', enabled: true, requested: true } }], null);
  controller.viewport(view);
  await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(1);
  for (const zoom of [0.3501, 0.5, 0.8, 1.5, 0.2]) {
    controller.viewport({ ...view, zoom });
    await vi.advanceTimersByTimeAsync(300);
  }
  expect(publish).toHaveBeenCalledTimes(1);
  expect(mocked.produce).toHaveBeenCalledTimes(1);
  controller.dispose();
});

it('defers newly exposed previews while folding and resumes them at the latest playhead', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  mocked.produce.mockImplementation(request => ({ key: request.key, revision: request.revision, time: request.time,
    status: 'live', label: 'Image', drawing: { kind: 'plot', values: [0, 1] } }));
  const publish = vi.fn();
  const controller = new NodePreviewController({ preview: publish, software: false, previewBusy: false }, document.createElement('div'));
  controller.suspend(true);
  controller.scene('clip', [{ ...connectionFixture.nodes[0], preview: { key: 'fold-preview', enabled: true, requested: true } }], null);
  controller.viewport({ width: 800, height: 600, panX: 0, panY: 0, ratio: 1, zoom: 1 });
  try {
    await vi.advanceTimersByTimeAsync(500);
    expect(mocked.produce).not.toHaveBeenCalled();
    mocked.state.playheadPosition = 2;
    controller.suspend(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(mocked.produce).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].time).toBe(2);
  } finally { mocked.state.playheadPosition = 0; controller.dispose(); }
});

it('sends actual numbers to the canvas only when changed, and restores them after a worker reset', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  let value = '2';
  mocked.produce.mockImplementation(request => ({ key: request.key, revision: request.revision, time: request.time,
    status: 'live', label: 'Value', drawing: { kind: 'number', value, caption: 'Output' } }));
  const publish = vi.fn(), controller = new NodePreviewController({ preview: publish, software: false, previewBusy: false }, document.createElement('div'));
  const view = { width: 800, height: 600, panX: 0, panY: 0, ratio: 1, zoom: 0.3499 };
  controller.scene('clip', [{ ...connectionFixture.nodes[0], preview: { key: 'numeric', enabled: true, requested: true } }], null);
  controller.viewport(view); await vi.advanceTimersByTimeAsync(300);
  controller.viewport({ ...view, zoom: 0.3501 }); await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(1);
  expect(publish.mock.calls[0][0]).toMatchObject({ presentation: 'text' });
  expect(publish.mock.calls[0][0].drawing).toMatchObject({ kind: 'number', value: '2' });
  expect(previewTextStore.get('numeric')?.drawing).toMatchObject({ kind: 'number', value: '2' });
  value = '3'; mocked.state.playheadPosition = 1;
  controller.viewport(view); await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(2);
  expect(publish.mock.calls[1][0].drawing.value).toBe('3');
  mocked.state.playheadPosition = 2;
  controller.viewport(view); await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(2);
  controller.reset(); await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(3);
  mocked.state.playheadPosition = 0;
  controller.dispose(); expect(previewTextStore.get('numeric')).toBeUndefined();
});
