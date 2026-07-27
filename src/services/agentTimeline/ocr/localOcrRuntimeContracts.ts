import type {
  OcrEngineAvailability,
  OcrFrameCandidate,
  OcrRecognizedRegion,
} from '../../../types/agentTimeline/ocr';

/** Ephemeral frame lease; decoded pixels never enter durable OCR DTOs. */
export interface OcrFrameLease {
  frame: Blob | ImageBitmap | VideoFrame;
  release: () => void;
}

export interface LocalOcrWorker {
  getAvailability: (signal?: AbortSignal) => Promise<OcrEngineAvailability>;
  recognize: (request: {
    frame: Blob | ImageBitmap | VideoFrame;
    candidate: OcrFrameCandidate;
    languages: readonly string[];
    signal: AbortSignal;
  }) => Promise<readonly OcrRecognizedRegion[]>;
}

export interface OcrFrameProvider {
  acquire: (candidate: OcrFrameCandidate, signal: AbortSignal) => Promise<OcrFrameLease>;
}
