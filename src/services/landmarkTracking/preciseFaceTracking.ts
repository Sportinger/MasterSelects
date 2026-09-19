import wasmLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import wasmBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import { openSurfaceFrames, surfaceFrameIndex } from '../planarTracking/surfaceFrameReader';
import { loadLandmarkModel } from './modelCatalog';
import { saveLandmarkSidecar } from './landmarkSidecar';
import { landmarkRuntime } from './landmarkRuntime';
import { faceTrackKey } from './preciseFaceSampling';
import { useLandmarkTrackingStore } from '../../stores/landmarkTrackingStore';
import type { LandmarkFrame, LandmarkSeries } from './types';

interface FaceTrackingRequest {
  mode?: 'independent' | 'video';
  clipId: string;
  sourceId: string;
  url: string;
  file?: Blob;
  from: number;
  to: number;
  isCurrent: () => boolean;
}

class PreciseFaceTracking {
  private controller: AbortController | null = null;
  cancel() { this.controller?.abort(); }

  async track(request: FaceTrackingRequest): Promise<void> {
    if (this.controller) throw new Error('Another precise face track is running.');
    if (!Number.isFinite(request.from) || !Number.isFinite(request.to) || request.to <= request.from) {
      throw new Error('Select a non-empty video range.');
    }
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;
    const key = faceTrackKey(request.clipId);
    const store = useLandmarkTrackingStore.getState();
    const previous = landmarkRuntime.getSeries(key);
    store.setSummary(key, { status: 'loading', progress: 0, frameCount: 0, message: 'Loading face model' });
    let reader: Awaited<ReturnType<typeof openSurfaceFrames>> | undefined;
    let detector: import('@mediapipe/tasks-vision').FaceLandmarker | undefined;
    try {
      const { FaceLandmarker } = await import('@mediapipe/tasks-vision');
      const mode = request.mode ?? 'independent';
      const modelAssetBuffer = await loadLandmarkModel('face');
      signal.throwIfAborted();
      detector = await FaceLandmarker.createFromOptions(
        { wasmLoaderPath: wasmLoaderUrl, wasmBinaryPath: wasmBinaryUrl },
        { baseOptions: { modelAssetBuffer, delegate: 'CPU' }, runningMode: mode === 'independent' ? 'IMAGE' : 'VIDEO', numFaces: 1,
          outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6 },
      );
      reader = await openSurfaceFrames(request.url, signal, request.file);
      const first = Math.max(0, surfaceFrameIndex(reader.frames, request.from));
      const last = surfaceFrameIndex(reader.frames, request.to - 1e-6);
      if (last < first) throw new Error('No source frames in this range.');
      const total = last - first + 1;
      // Fail visibly rather than silently downsample/truncate an expensive track.
      if (total > 18_000) throw new Error('Track at most 18,000 source frames at once. Trim the clip first.');
      const frames: LandmarkFrame[] = [];
      let detectedFrames = 0;
      store.setSummary(key, { status: 'tracking', message: `Tracking ${total} source frames` });
      for await (const decoded of reader.readRange(reader.frames[first].time, reader.frames[last].time, total)) {
        signal.throwIfAborted();
        // Offline analysis must be able to avoid the video graph's temporal landmark filter.
        const result = mode === 'independent' ? detector.detect(decoded.pixels)
          : detector.detectForVideo(decoded.pixels, Math.max(0, decoded.time) * 1000);
        const face = result.faceLandmarks[0];
        const valid = face?.length === 478 && face.every(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
        if (valid) detectedFrames++;
        frames.push({ time: decoded.time, duration: decoded.duration, hands: [], poses: [],
          faces: valid ? [face.map(p => ({ x: p.x, y: p.y, z: p.z }))] : [],
          faceBlendshapes: valid ? Object.fromEntries((result.faceBlendshapes[0]?.categories ?? []).map(c => [c.categoryName, c.score])) : undefined,
          faceTransform: valid ? result.facialTransformationMatrixes[0]?.data : undefined,
        });
        store.setSummary(key, { progress: frames.length / total, frameCount: frames.length });
        // Yield between synchronous CPU inferences so cancel and preview controls remain usable.
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      signal.throwIfAborted();
      if (!request.isCurrent()) throw new Error('The clip source or trim changed. Track again.');
      const contour = (name: string, color: string, edges: { start: number; end: number }[]) => ({
        name, color, edges: edges.map(e => [e.start, e.end] as [number, number]),
      });
      const series: LandmarkSeries = { version: 1, clipId: key, sourceId: request.sourceId,
        createdAt: Date.now(), sampleInterval: (request.to - request.from) / total, frames,
        faceTracking: { mode, sourceStart: request.from, sourceEnd: Math.min(request.to, frames.at(-1)!.time + frames.at(-1)!.duration!), detectedFrames,
          contours: [
            contour('Lips', '#ff76ac', FaceLandmarker.FACE_LANDMARKS_LIPS),
            contour('Eyes', '#69e6ff', [...FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE]),
            contour('Irises', '#ffffff', [...FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS]),
            contour('Brows', '#ffc76a', [...FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, ...FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW]),
            contour('Outline', '#84ffb0', FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
          ] },
      };
      store.setSummary(key, { message: 'Saving face tracking' });
      await saveLandmarkSidecar(series, signal);
      landmarkRuntime.setSeries(series);
      store.setReady(series);
      store.setFaceOverlay(request.clipId, true);
      store.setSummary(key, { message: `${detectedFrames}/${total} frames with face · 478 points` });
    } catch (error) {
      if (previous) store.setReady(previous);
      store.setSummary(key, { status: previous ? 'ready' : signal.aborted ? 'idle' : 'error',
        message: signal.aborted ? 'Cancelled; previous result kept.' : error instanceof Error ? error.message : 'Face tracking failed.' });
    } finally {
      reader?.close();
      detector?.close();
      this.controller = null;
    }
  }
}

const hot = import.meta.hot?.data as { preciseFaceTracking?: PreciseFaceTracking } | undefined;
export const preciseFaceTracking = hot?.preciseFaceTracking ?? new PreciseFaceTracking();
if (import.meta.hot) import.meta.hot.dispose(data => { data.preciseFaceTracking = preciseFaceTracking; });
