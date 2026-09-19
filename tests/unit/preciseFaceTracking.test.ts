import { beforeEach, describe, expect, it, vi } from 'vitest';

const fake = vi.hoisted(() => ({ detect: vi.fn(), video: vi.fn(), options: vi.fn(), close: vi.fn(), save: vi.fn(), current: vi.fn(), readClose: vi.fn() }));
vi.mock('../../src/services/landmarkTracking/modelCatalog', () => ({ loadLandmarkModel: async () => new Uint8Array() }));
vi.mock('../../src/services/landmarkTracking/landmarkSidecar', () => ({ saveLandmarkSidecar: fake.save }));
vi.mock('@mediapipe/tasks-vision', () => ({ FaceLandmarker: {
  createFromOptions: async (_files: unknown, options: unknown) => {
    fake.options(options);
    return { detect: fake.detect, detectForVideo: fake.video, close: fake.close };
  },
  ...Object.fromEntries(['LIPS', 'LEFT_EYE', 'RIGHT_EYE', 'LEFT_IRIS', 'RIGHT_IRIS', 'LEFT_EYEBROW', 'RIGHT_EYEBROW', 'FACE_OVAL']
    .map(key => [`FACE_LANDMARKS_${key}`, [{ start: 0, end: 1 }]])),
} }));
vi.mock('../../src/services/planarTracking/surfaceFrameReader', () => ({
  surfaceFrameIndex: (frames: { time: number }[], time: number) => frames.findLastIndex(f => f.time <= time),
  openSurfaceFrames: async () => ({ frames: [{ time: 1, duration: 0.04 }, { time: 1.04, duration: 0.06 }], close: fake.readClose,
    async *readRange() {
      yield { time: 1, duration: 0.04, pixels: {} };
      yield { time: 1.04, duration: 0.06, pixels: {} };
    },
  }),
}));
import { preciseFaceTracking } from '../../src/services/landmarkTracking/preciseFaceTracking';
import { landmarkRuntime } from '../../src/services/landmarkTracking/landmarkRuntime';
import { useLandmarkTrackingStore } from '../../src/stores/landmarkTrackingStore';

const request = (clipId: string) => ({ clipId, sourceId: 'source', url: 'blob:test', from: 1, to: 1.1, isCurrent: fake.current });
const detected = () => ({ faceLandmarks: [Array.from({ length: 478 }, () => ({ x: 0.4, y: 0.5, z: 0 }))],
  faceBlendshapes: [{ categories: [{ categoryName: 'jawOpen', score: 0.8 }] }], facialTransformationMatrixes: [{ data: [1, 0, 0, 1] }],
});
beforeEach(() => { vi.clearAllMocks(); fake.current.mockReturnValue(true); fake.save.mockResolvedValue(undefined); fake.detect.mockReturnValue(detected()); fake.video.mockReturnValue(detected()); });

describe('precise face analysis lifecycle', () => {
  it('saves every decoded PTS, all points, expressions and explicit missing detections', async () => {
    fake.detect.mockReturnValueOnce(detected()).mockReturnValueOnce({ faceLandmarks: [] });
    await preciseFaceTracking.track(request('complete'));
    const track = landmarkRuntime.getSeries('face:complete')!;
    expect(track.frames.map(f => f.time)).toEqual([1, 1.04]);
    expect(track.frames[0].faces[0]).toHaveLength(478);
    expect(track.frames[0].faceBlendshapes?.jawOpen).toBe(0.8);
    expect(track.frames[0].faceTransform).toEqual([1, 0, 0, 1]);
    expect(track.frames[1].faces).toEqual([]);
    expect(track.faceTracking?.detectedFrames).toBe(1);
    expect(track.faceTracking?.mode).toBe('independent');
    expect(fake.options).toHaveBeenCalledWith(expect.objectContaining({ runningMode: 'IMAGE' }));
    expect(fake.detect).toHaveBeenCalledTimes(2);
    expect(fake.video).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(fake.readClose).toHaveBeenCalledOnce();
  });
  it('retains opt-in temporal video tracking with source timestamps', async () => {
    await preciseFaceTracking.track({ ...request('video'), mode: 'video' });
    expect(fake.options).toHaveBeenCalledWith(expect.objectContaining({ runningMode: 'VIDEO' }));
    expect(fake.video.mock.calls.map(call => call[1])).toEqual([1000, 1040]);
    expect(fake.detect).not.toHaveBeenCalled();
    expect(landmarkRuntime.getSeries('face:video')?.faceTracking?.mode).toBe('video');
  });
  it('keeps the previous result when cancelled during inference', async () => {
    await preciseFaceTracking.track(request('cancel'));
    const previous = landmarkRuntime.getSeries('face:cancel');
    fake.detect.mockImplementationOnce(() => { preciseFaceTracking.cancel(); return detected(); });
    await preciseFaceTracking.track(request('cancel'));
    expect(landmarkRuntime.getSeries('face:cancel')).toBe(previous);
    expect(fake.save).toHaveBeenCalledTimes(1);
    expect(useLandmarkTrackingStore.getState().summaries['face:cancel'].message).toContain('Cancelled');
  });
  it('does not publish stale source results or a result that could not be cached', async () => {
    fake.current.mockReturnValue(false);
    await preciseFaceTracking.track(request('changed'));
    expect(fake.save).not.toHaveBeenCalled();
    expect(landmarkRuntime.getSeries('face:changed')).toBeNull();
    fake.current.mockReturnValue(true);
    fake.save.mockRejectedValue(new Error('Quota exceeded'));
    await preciseFaceTracking.track(request('quota'));
    expect(landmarkRuntime.getSeries('face:quota')).toBeNull();
    expect(useLandmarkTrackingStore.getState().summaries['face:quota'].message).toBe('Quota exceeded');
  });
});
