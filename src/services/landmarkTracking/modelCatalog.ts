import type { LandmarkKind } from './types';

export interface LandmarkModelDescriptor {
  kind: LandmarkKind;
  name: string;
  url: string;
  license: 'Apache-2.0';
}
export const LANDMARK_MODELS: Record<LandmarkKind, LandmarkModelDescriptor> = {
  hand: {
    kind: 'hand',
    name: 'MediaPipe Hand Landmarker',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    license: 'Apache-2.0',
  },
  face: {
    kind: 'face',
    name: 'MediaPipe Face Landmarker',
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    license: 'Apache-2.0',
  },
  pose: {
    kind: 'pose',
    name: 'MediaPipe Pose Landmarker Lite',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    license: 'Apache-2.0',
  },
};

const MODEL_CACHE = 'masterselects-landmark-models-v1';

export async function loadLandmarkModel(kind: LandmarkKind): Promise<Uint8Array<ArrayBuffer>> {
  const descriptor = LANDMARK_MODELS[kind];
  const cache = typeof caches === 'undefined' ? null : await caches.open(MODEL_CACHE);
  let response = await cache?.match(descriptor.url);
  if (!response) {
    response = await fetch(descriptor.url);
    if (!response.ok) throw new Error(`${descriptor.name} download failed (${response.status})`);
    await cache?.put(descriptor.url, response.clone());
  }
  return new Uint8Array(await response.arrayBuffer());
}
