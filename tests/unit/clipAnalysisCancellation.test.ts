import { afterEach, expect, it, vi } from 'vitest';
import { analyzeClip, cancelAnalysis, isAnalysisRunning } from '../../src/services/clipAnalyzer';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), update: vi.fn(), error: vi.fn(), info: vi.fn(), clips: [] as unknown[] }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ error: mocks.error, info: mocks.info, warn: vi.fn(), debug: vi.fn() }) } }));
vi.mock('../../src/stores/timeline', () => ({ useTimelineStore: { getState: () => ({ clips: mocks.clips }) } }));
vi.mock('../../src/stores/mediaStore', () => ({ triggerTimelineSave: vi.fn() }));
vi.mock('../../src/services/faceAnalysis/FaceAnalysisRuntime', () => ({ getFaceAnalysisRuntime: () => ({ prepare: mocks.prepare }) }));
vi.mock('../../src/services/clipAnalysis/clipAnalysisState', () => ({
  updateClipAnalysis: mocks.update, updateMediaFileAnalysis: vi.fn(), propagateAnalysisToMediaFile: vi.fn(),
  clearClipAnalysis: vi.fn(), createStaleAnalysisRecoveryUpdate: vi.fn(),
}));

afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); });

it.each([
  { cancel: true, name: 'AbortError' },
  { cancel: false, name: 'Error' },
  { cancel: false, name: 'AbortError' },
])('distinguishes requested cancellation ($cancel) from $name', async ({ cancel, name }) => {
  vi.useFakeTimers();
  mocks.clips = [{ id: 'audit', file: new File(['video'], 'audit.mp4', { type: 'video/mp4' }), duration: 1, inPoint: 0, outPoint: 1 }];
  const video = document.createElement('video');
  vi.spyOn(document, 'createElement').mockImplementation(() => {
    queueMicrotask(() => video.dispatchEvent(new Event('loadedmetadata')));
    return video;
  });
  let reject!: (error: Error) => void;
  mocks.prepare.mockImplementation(({ signal }: { signal: AbortSignal }) => new Promise((_resolve, fail) => {
    reject = fail;
    signal.addEventListener('abort', () => fail(Object.assign(new Error('Face analysis was cancelled.'), { name: 'AbortError' })), { once: true });
  }));
  const pending = analyzeClip('audit', { force: true, target: 'faces' });
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
  if (cancel) cancelAnalysis();
  else reject(Object.assign(new Error('Model initialization failed'), { name }));
  await pending;
  expect(isAnalysisRunning()).toBe(false);
  if (cancel) {
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenLastCalledWith('audit', expect.objectContaining({ faceStatus: 'none', faceMessage: 'Face analysis cancelled.' }));
  } else {
    expect(mocks.error).toHaveBeenCalledWith('Analysis failed', expect.any(Error));
    expect(mocks.update).toHaveBeenLastCalledWith('audit', expect.objectContaining({ faceStatus: 'error', faceMessage: 'Model initialization failed' }));
  }
});
