export type CameraSolvingPhase =
  | 'loading-runtime'
  | 'extracting-features'
  | 'matching'
  | 'reconstructing'
  | 'writing-dataset'
  | 'completed'
  | 'cancelled'
  | 'error';

export interface CameraSolvingSnapshot {
  phase: CameraSolvingPhase;
  current: number;
  total: number;
  registeredImages: number;
  pointCount: number;
  elapsedMs: number;
  message: string;
}

export interface SolvedCameraModel {
  datasetName: string;
  registeredSourceIndices: number[];
  camerasText: string;
  imagesText: string;
  pointsText: string;
}

export interface CameraSolveSourceContext {
  sourceClipId?: string;
  sourceClipName?: string;
  clipStartTime?: number;
  clipDuration?: number;
  frameRate?: number;
  sampleTimes?: number[];
}

export interface CameraSolveDataset {
  id: string;
  createdAt: number;
  files: File[];
  model: SolvedCameraModel;
  source: CameraSolveSourceContext | null;
}

export type CameraSolvingWorkerRequest =
  | {
      type: 'start';
      files: File[];
      datasetName: string;
      maxImageSide: number;
    }
  | { type: 'cancel' };

export type CameraSolvingWorkerResponse =
  | { type: 'snapshot'; snapshot: CameraSolvingSnapshot }
  | { type: 'completed'; model: SolvedCameraModel }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

export interface CameraSolvingController {
  result: Promise<CameraSolveDataset>;
  cancel(): void;
}
