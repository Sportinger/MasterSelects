import { afterEach, expect, it, vi } from 'vitest';
import { NodePreviewController } from '../../src/components/panels/nodes/previews/NodePreviewController';
import { connectionFixture } from '../helpers/nodeConnectionFixture';
import type { PreviewFrame, PreviewRequest } from '../../src/services/nodePreview/previewTypes';

const mocked = vi.hoisted(() => ({
  state: { clips: [], clipKeyframes: new Map(), playheadPosition: 0, isPlaying: false, isExporting: false },
  produce: vi.fn((request: PreviewRequest): PreviewFrame => ({ key: request.key, revision: request.revision, time: request.time,
    status: 'live', label: 'Source', drawing: { kind: 'text', lines: ['Frame'] } })),
}));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => mocked.state, subscribe: () => () => {} } }));
vi.mock('../../src/stores/landmarkTrackingStore', () => ({ useLandmarkTrackingStore: { subscribe: () => () => {} } }));
vi.mock('../../src/services/nodePreview/PreviewArtifactReader', () => ({ PreviewArtifactReader: class { dispose() {} } }));
vi.mock('../../src/services/nodePreview/NodePreviewTextureTap', () => ({ nodePreviewTextureTap: { cancelClip: vi.fn() } }));
vi.mock('../../src/services/nodePreview/previewSources', () => ({ produceNodePreview: mocked.produce }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); mocked.produce.mockClear(); });

it('refills a cleared atlas across a zoom tier even when the paused thumbnail width stays unchanged', async () => {
  vi.useFakeTimers(); vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const publish = vi.fn();
  const controller = new NodePreviewController({ preview: publish, software: false, previewBusy: false }, document.createElement('div'));
  const view = { width: 800, height: 600, panX: 0, panY: 0, ratio: 1, zoom: 0.3499 };
  controller.scene('clip', [{ ...connectionFixture.nodes[0], preview: { key: 'source', enabled: true, requested: true } }], null);
  controller.viewport(view);
  await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(1);
  controller.viewport({ ...view, zoom: 0.3501 });
  await vi.advanceTimersByTimeAsync(300);
  expect(publish).toHaveBeenCalledTimes(2);
  const [before, after] = mocked.produce.mock.calls.map(call => call[0]);
  expect(before.width).toBe(after.width);
  expect(before.revision).not.toBe(after.revision);
  expect(before.continuity).not.toBe(after.continuity);
  controller.dispose();
});
