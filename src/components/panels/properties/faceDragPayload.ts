import type { DragEvent } from 'react';
import type { FaceCropSample } from './FaceCropThumbnail';

export type FaceDragPayload =
  | { kind: 'person'; personId: string }
  | { kind: 'appearance'; personId: string; timestamp: number }
  | {
      kind: 'review';
      candidateId: string;
      faceIds: string[];
      sample: FaceCropSample;
    };

const FACE_DRAG_TYPE = 'application/x-masterselects-face';

export function readFaceDrag(event: DragEvent): FaceDragPayload | null {
  try {
    return JSON.parse(event.dataTransfer.getData(FACE_DRAG_TYPE)) as FaceDragPayload;
  } catch {
    return null;
  }
}

export function writeFaceDrag(event: DragEvent, payload: FaceDragPayload): void {
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(FACE_DRAG_TYPE, JSON.stringify(payload));
}
