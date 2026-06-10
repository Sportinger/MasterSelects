import type { SceneCamera, SceneVector3, SceneViewport } from '../../../engine/scene/types';
import type { ClipTransform } from "../../../types/timelineCore";
import type {
  PreviewSceneObject,
  SceneAxisScreenHandle,
  SceneGizmoAxis,
  SceneGizmoMode,
} from '../sceneObjectOverlayMath';

export type SceneGizmoDragAxis = SceneGizmoAxis | 'all';

export type ClipTransformPatch = Omit<Partial<ClipTransform>, 'position' | 'scale' | 'rotation'> & {
  position?: Partial<ClipTransform['position']>;
  scale?: Partial<ClipTransform['scale']>;
  rotation?: Partial<ClipTransform['rotation']>;
};

export type DisplayCameraWireframePath = {
  key: string;
  d: string;
  role: 'body' | 'frustum' | 'direction';
  selected: boolean;
};

export type DisplayWorldGridPath = {
  key: string;
  d: string;
  kind: 'minor' | 'major' | 'axis-x' | 'axis-y' | 'axis-z';
};

export type WorldGridPlane = 'xy' | 'yz' | 'xz';

export interface AxisPlaneDrag {
  camera: SceneCamera;
  canvasRect: { left: number; top: number; width: number; height: number };
  planePoint: SceneVector3;
  planeNormal: SceneVector3;
  startPoint: SceneVector3;
}

export interface DragState {
  clipId: string;
  mode: SceneGizmoMode;
  axis: SceneGizmoDragAxis;
  kind: PreviewSceneObject['kind'];
  transformSpace: PreviewSceneObject['transformSpace'];
  startTransform: ClipTransform;
  transient: boolean;
  direction: { x: number; y: number };
  axisVector: SceneVector3;
  pixelsPerUnit: number;
  freePixelsPerUnit: { x: number; y: number };
  axisPlaneDrag?: AxisPlaneDrag;
  rotationCenterClient?: { x: number; y: number };
  rotationStartPointerClient?: { x: number; y: number };
  rotationRingClientRect?: { left: number; top: number; width: number; height: number };
  rotationRingPoints?: ProjectedRotateRingPoint[];
  rotationStartRingAngle?: number;
  viewport: SceneViewport;
}

export interface DragRuntime {
  target: HTMLElement | null;
  hasPointerLock: boolean;
  accumulatedX: number;
  accumulatedY: number;
  lastClientX: number;
  lastClientY: number;
  rotationRingLastAngle: number | null;
  rotationRingAccumulatedRadians: number;
  rotationAngularLastAngle: number | null;
  rotationAngularAccumulatedRadians: number;
}

export interface DisplaySceneObject extends PreviewSceneObject {
  displayX: number;
  displayY: number;
}

export interface ProjectedRotateRingPoint {
  x: number;
  y: number;
  angleRadians: number;
}

export interface ProjectedRotateRing {
  axis: SceneGizmoAxis;
  handle: SceneAxisScreenHandle;
  path: string;
  points: ProjectedRotateRingPoint[];
}

export interface ObjectContextMenuState {
  x: number;
  y: number;
  object: PreviewSceneObject;
}
