import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SolvedCameraPath } from '../../src/services/photogrammetry/cameraSolvePoses';
import { placeSplatOnTimeline } from '../../src/services/photogrammetry/placeSplatOnTimeline';

const { state, media } = vi.hoisted(() => ({ state: { clips: [] as any[], playheadPosition: 2,
  tracks: [{ id: 'existing-track', type: 'video' }], reorderTrack: vi.fn(),
  addTrack: vi.fn(), addClip: vi.fn(), addCameraClip: vi.fn(), updateClip: vi.fn(),
  updateClipTransform: vi.fn(), selectClip: vi.fn() }, media: { setSourceMonitorFile: vi.fn(), setSelection: vi.fn() } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => state } }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => media } }));
const path: SolvedCameraPath = { width: 2160, height: 3840, focalLength: 2880, fovDegrees: 67.38, duration: 10,
  poses: [{ sourceIndex: 0, imageName: 'one.jpg', time: 0, position: { x: 1, y: 2, z: 3 }, rotation: { x: 4, y: 5, z: 6 } }] };

beforeEach(() => {
  vi.clearAllMocks(); state.clips = [{ id: 'existing-camera', startTime: 0, duration: 20, source: { type: 'camera' } }];
  state.addTrack.mockReturnValue('track');
  state.addClip.mockImplementation(async () => { state.clips.push({ id: 'splat', source: { type: 'gaussian-splat' } }); return 'splat'; });
  state.addCameraClip.mockImplementation(() => { state.clips.push({ id: 'training-camera', source: { type: 'camera', cameraSettings: {} } }); return 'training-camera'; });
});
describe('scan splat timeline placement', () => {
  it('keeps the trained scene and capture camera in the same coordinate system without changing existing cameras', async () => {
    await placeSplatOnTimeline(new File([], 'trained.ply'), { id: 'media' } as any, path);
    expect(state.updateClip).toHaveBeenCalledWith('splat', expect.objectContaining({ source: expect.objectContaining({
      gaussianSplatSettings: expect.objectContaining({ render: expect.objectContaining({ orientationPreset: 'default', nearPlane: .001 }) }) }) }));
    expect(state.updateClip).toHaveBeenCalledWith('training-camera', expect.objectContaining({ name: 'Training Camera', source: expect.objectContaining({
      cameraSettings: expect.objectContaining({ fov: path.fovDegrees, resolutionWidth: 2160, resolutionHeight: 3840 }) }) }));
    expect(state.updateClipTransform).toHaveBeenCalledWith('training-camera', { position: path.poses[0].position, rotation: path.poses[0].rotation });
    expect(state.reorderTrack).toHaveBeenCalledWith('track', 'existing-track', true);
    expect(state.updateClip.mock.calls.every(([id]) => id !== 'existing-camera')).toBe(true);
  });
  it('retains ordinary placement for datasets without a supported camera path', async () => {
    await placeSplatOnTimeline(new File([], 'sparse.ply'), { id: 'media' } as any);
    expect(state.addCameraClip).not.toHaveBeenCalled();
    expect(state.updateClipTransform).not.toHaveBeenCalled();
  });
});
