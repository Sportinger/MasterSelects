export const FACE_ANALYSIS_MODEL_VERSION = 'yunet-2026may+sface-2021dec-v1';

export interface FaceModelCatalogEntry {
  id: 'yunet' | 'sface';
  displayName: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export const FACE_MODEL_CATALOG: readonly FaceModelCatalogEntry[] = [
  {
    id: 'yunet',
    displayName: 'YuNet 2026may',
    fileName: 'face_detection_yunet_2026may.onnx',
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/26cc381e4d2594bb9f47a26eb8fd96c94a13660d/models/face_detection_yunet/face_detection_yunet_2026may.onnx',
    sizeBytes: 229_738,
    sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
  },
  {
    id: 'sface',
    displayName: 'SFace 2021dec',
    fileName: 'face_recognition_sface_2021dec.onnx',
    url: 'https://huggingface.co/opencv/face_recognition_sface/resolve/3d7082438a6e4551e840c9b2bb60b71e8da4b524/face_recognition_sface_2021dec.onnx',
    sizeBytes: 38_696_353,
    sha256: '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79',
  },
] as const;
