import type { SceneCamera, SceneVector3 } from '../../../engine/scene/types';
import type { AxisPlaneDrag, DragState } from './sceneOverlayTypes';

function dotVector(a: SceneVector3, b: SceneVector3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function addVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function subtractVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scaleVector(vector: SceneVector3, scalar: number): SceneVector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function crossVector(a: SceneVector3, b: SceneVector3): SceneVector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function normalizeVector(vector: SceneVector3): SceneVector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.000001) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function rejectVector(vector: SceneVector3, axis: SceneVector3): SceneVector3 {
  return subtractVector(vector, scaleVector(axis, dotVector(vector, axis)));
}

function resolveScreenRay(
  client: { x: number; y: number },
  camera: SceneCamera,
  canvasRect: AxisPlaneDrag['canvasRect'],
): { origin: SceneVector3; direction: SceneVector3 } {
  const ndcX = ((client.x - canvasRect.left) / Math.max(1, canvasRect.width)) * 2 - 1;
  const ndcY = 1 - ((client.y - canvasRect.top) / Math.max(1, canvasRect.height)) * 2;
  const backward = normalizeVector(subtractVector(camera.cameraPosition, camera.cameraTarget));
  let right = normalizeVector(crossVector(camera.cameraUp, backward));
  if (Math.hypot(right.x, right.y, right.z) < 0.000001) {
    right = { x: 1, y: 0, z: 0 };
  }
  const up = normalizeVector(crossVector(backward, right));
  const aspect = camera.viewport.width / Math.max(1, camera.viewport.height);
  if (camera.projection === 'orthographic') {
    const height = Math.max(0.001, camera.orthographicScale ?? 2);
    const width = height * aspect;
    return {
      origin: addVector(
        camera.cameraPosition,
        addVector(
          scaleVector(right, ndcX * width * 0.5),
          scaleVector(up, ndcY * height * 0.5),
        ),
      ),
      direction: normalizeVector(scaleVector(backward, -1)),
    };
  }

  const fovRadians = (camera.fov * Math.PI) / 180;
  const tanHalfFov = Math.tan(fovRadians * 0.5);
  const direction = normalizeVector(addVector(
    scaleVector(backward, -1),
    addVector(
      scaleVector(right, ndcX * tanHalfFov * aspect),
      scaleVector(up, ndcY * tanHalfFov),
    ),
  ));

  return {
    origin: camera.cameraPosition,
    direction,
  };
}

function intersectRayWithPlane(
  ray: { origin: SceneVector3; direction: SceneVector3 },
  planePoint: SceneVector3,
  planeNormal: SceneVector3,
): SceneVector3 | null {
  const denominator = dotVector(ray.direction, planeNormal);
  if (Math.abs(denominator) < 0.00001) {
    return null;
  }

  const t = dotVector(subtractVector(planePoint, ray.origin), planeNormal) / denominator;
  if (!Number.isFinite(t)) {
    return null;
  }

  return addVector(ray.origin, scaleVector(ray.direction, t));
}

function resolveAxisDragPlaneNormal(axisVector: SceneVector3, camera: SceneCamera): SceneVector3 | null {
  const axis = normalizeVector(axisVector);
  if (Math.hypot(axis.x, axis.y, axis.z) < 0.000001) {
    return null;
  }

  const cameraForward = normalizeVector(subtractVector(camera.cameraTarget, camera.cameraPosition));
  let normal = normalizeVector(rejectVector(cameraForward, axis));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  normal = normalizeVector(rejectVector(camera.cameraUp, axis));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  normal = normalizeVector(crossVector(axis, { x: 0, y: 1, z: 0 }));
  if (Math.hypot(normal.x, normal.y, normal.z) >= 0.000001) {
    return normal;
  }

  return normalizeVector(crossVector(axis, { x: 1, y: 0, z: 0 }));
}

export function createAxisPlaneDrag(params: {
  client: { x: number; y: number };
  camera: SceneCamera;
  canvasRect: AxisPlaneDrag['canvasRect'];
  worldPosition: SceneVector3;
  axisVector: SceneVector3;
}): AxisPlaneDrag | undefined {
  const planeNormal = resolveAxisDragPlaneNormal(params.axisVector, params.camera);
  if (!planeNormal) return undefined;

  const startPoint = intersectRayWithPlane(
    resolveScreenRay(params.client, params.camera, params.canvasRect),
    params.worldPosition,
    planeNormal,
  );
  if (!startPoint) return undefined;

  return {
    camera: params.camera,
    canvasRect: params.canvasRect,
    planePoint: params.worldPosition,
    planeNormal,
    startPoint,
  };
}

export function resolveAxisPlaneDragUnits(
  drag: DragState,
  screenDelta: { x: number; y: number },
): number | null {
  if (!drag.axisPlaneDrag || !drag.rotationStartPointerClient || drag.axis === 'all') {
    return null;
  }

  const currentClient = {
    x: drag.rotationStartPointerClient.x + screenDelta.x,
    y: drag.rotationStartPointerClient.y + screenDelta.y,
  };
  const currentPoint = intersectRayWithPlane(
    resolveScreenRay(currentClient, drag.axisPlaneDrag.camera, drag.axisPlaneDrag.canvasRect),
    drag.axisPlaneDrag.planePoint,
    drag.axisPlaneDrag.planeNormal,
  );
  if (!currentPoint) return null;

  return dotVector(
    subtractVector(currentPoint, drag.axisPlaneDrag.startPoint),
    drag.axisVector,
  );
}
