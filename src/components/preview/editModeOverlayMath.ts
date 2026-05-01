export interface OverlayPoint {
  x: number;
  y: number;
}

export interface LayerOverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  corners: {
    tl: OverlayPoint;
    tr: OverlayPoint;
    br: OverlayPoint;
    bl: OverlayPoint;
  };
}

interface CalculateLayerOverlayBoundsParams {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  position: { x: number; y: number };
  scale: { x: number; y: number };
  rotation: number;
}

export interface LayerUvProjectionParams {
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  position: { x: number; y: number; z?: number };
  scale: { x: number; y: number };
  rotation: number | { x?: number; y?: number; z?: number };
  perspective?: number;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value: number | undefined, fallback: number): number {
  const finite = finiteNumber(value, fallback);
  return finite > 0 ? finite : fallback;
}

function distance(a: OverlayPoint, b: OverlayPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function average(points: OverlayPoint[]): OverlayPoint {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function multiplyMatrix3(a: number[][], b: number[][]): number[][] {
  return [
    [
      a[0]![0]! * b[0]![0]! + a[0]![1]! * b[1]![0]! + a[0]![2]! * b[2]![0]!,
      a[0]![0]! * b[0]![1]! + a[0]![1]! * b[1]![1]! + a[0]![2]! * b[2]![1]!,
      a[0]![0]! * b[0]![2]! + a[0]![1]! * b[1]![2]! + a[0]![2]! * b[2]![2]!,
    ],
    [
      a[1]![0]! * b[0]![0]! + a[1]![1]! * b[1]![0]! + a[1]![2]! * b[2]![0]!,
      a[1]![0]! * b[0]![1]! + a[1]![1]! * b[1]![1]! + a[1]![2]! * b[2]![1]!,
      a[1]![0]! * b[0]![2]! + a[1]![1]! * b[1]![2]! + a[1]![2]! * b[2]![2]!,
    ],
    [
      a[2]![0]! * b[0]![0]! + a[2]![1]! * b[1]![0]! + a[2]![2]! * b[2]![0]!,
      a[2]![0]! * b[0]![1]! + a[2]![1]! * b[1]![1]! + a[2]![2]! * b[2]![1]!,
      a[2]![0]! * b[0]![2]! + a[2]![1]! * b[1]![2]! + a[2]![2]! * b[2]![2]!,
    ],
  ];
}

function transposeMatrix3(m: number[][]): number[][] {
  return [
    [m[0]![0]!, m[1]![0]!, m[2]![0]!],
    [m[0]![1]!, m[1]![1]!, m[2]![1]!],
    [m[0]![2]!, m[1]![2]!, m[2]![2]!],
  ];
}

function multiplyMatrixVector(m: number[][], v: [number, number, number]): [number, number, number] {
  return [
    m[0]![0]! * v[0] + m[0]![1]! * v[1] + m[0]![2]! * v[2],
    m[1]![0]! * v[0] + m[1]![1]! * v[1] + m[1]![2]! * v[2],
    m[2]![0]! * v[0] + m[2]![1]! * v[1] + m[2]![2]! * v[2],
  ];
}

function getRotationMatrix(rotation: number | { x?: number; y?: number; z?: number }): number[][] {
  const rotationX = typeof rotation === 'number' ? 0 : finiteNumber(rotation.x, 0);
  const rotationY = typeof rotation === 'number' ? 0 : finiteNumber(rotation.y, 0);
  const rotationZ = typeof rotation === 'number' ? rotation : finiteNumber(rotation.z, 0);
  const cx = Math.cos(-rotationX);
  const sx = Math.sin(-rotationX);
  const cy = Math.cos(-rotationY);
  const sy = Math.sin(-rotationY);
  const cz = Math.cos(rotationZ);
  const sz = Math.sin(rotationZ);
  const rx = [
    [1, 0, 0],
    [0, cx, -sx],
    [0, sx, cx],
  ];
  const ry = [
    [cy, 0, sy],
    [0, 1, 0],
    [-sy, 0, cy],
  ];
  const rz = [
    [cz, -sz, 0],
    [sz, cz, 0],
    [0, 0, 1],
  ];

  return multiplyMatrix3(rz, multiplyMatrix3(ry, rx));
}

export function projectLayerUvToCanvas(
  uv: OverlayPoint,
  params: LayerUvProjectionParams,
): OverlayPoint {
  const safeSourceWidth = positiveNumber(params.sourceWidth, params.outputWidth);
  const safeSourceHeight = positiveNumber(params.sourceHeight, params.outputHeight);
  const safeOutputWidth = positiveNumber(params.outputWidth, params.canvasWidth);
  const safeOutputHeight = positiveNumber(params.outputHeight, params.canvasHeight);
  const safeCanvasWidth = positiveNumber(params.canvasWidth, safeOutputWidth);
  const safeCanvasHeight = positiveNumber(params.canvasHeight, safeOutputHeight);
  const outputAspect = safeOutputWidth / safeOutputHeight;
  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const aspectRatio = sourceAspect / outputAspect;
  const posX = finiteNumber(params.position.x, 0);
  const posY = finiteNumber(params.position.y, 0);
  const posZ = finiteNumber(params.position.z, 0);
  const scaleX = finiteNumber(params.scale.x, 1);
  const scaleY = finiteNumber(params.scale.y, 1);
  const perspective = Math.max(finiteNumber(params.perspective, 2), 0.5);

  let correctedX = uv.x - 0.5 + posX;
  let correctedY = uv.y - 0.5 + posY;

  if (aspectRatio > 1) {
    correctedY /= aspectRatio;
  } else {
    correctedX *= aspectRatio;
  }

  const targetX = correctedX * scaleX;
  const targetY = (correctedY * scaleY) / outputAspect;
  const rotationMatrix = getRotationMatrix(params.rotation);
  const inverseRotationMatrix = transposeMatrix3(rotationMatrix);
  const inverseThirdRow = inverseRotationMatrix[2]!;
  const planeTerm = inverseThirdRow[0]! * targetX + inverseThirdRow[1]! * targetY;
  const denominator = inverseThirdRow[2]! - planeTerm / perspective;
  const rotatedZ = Math.abs(denominator) < 0.000001
    ? posZ
    : (posZ - planeTerm) / denominator;
  const perspectiveScale = 1 - rotatedZ / perspective;
  const rotatedPoint: [number, number, number] = [
    targetX * perspectiveScale,
    targetY * perspectiveScale,
    rotatedZ,
  ];
  const outputPoint = multiplyMatrixVector(inverseRotationMatrix, rotatedPoint);

  return {
    x: (0.5 + outputPoint[0]) * safeCanvasWidth,
    y: (0.5 + outputPoint[1] * outputAspect) * safeCanvasHeight,
  };
}

export function unprojectCanvasToLayerUv(
  canvasPoint: OverlayPoint,
  params: LayerUvProjectionParams,
): OverlayPoint {
  let guess: OverlayPoint = {
    x: canvasPoint.x / positiveNumber(params.canvasWidth, params.outputWidth),
    y: canvasPoint.y / positiveNumber(params.canvasHeight, params.outputHeight),
  };

  for (let i = 0; i < 10; i += 1) {
    const projected = projectLayerUvToCanvas(guess, params);
    const errorX = projected.x - canvasPoint.x;
    const errorY = projected.y - canvasPoint.y;
    if (Math.hypot(errorX, errorY) < 0.05) break;

    const epsilon = 0.0005;
    const projectedX = projectLayerUvToCanvas({ x: guess.x + epsilon, y: guess.y }, params);
    const projectedY = projectLayerUvToCanvas({ x: guess.x, y: guess.y + epsilon }, params);
    const j11 = (projectedX.x - projected.x) / epsilon;
    const j12 = (projectedY.x - projected.x) / epsilon;
    const j21 = (projectedX.y - projected.y) / epsilon;
    const j22 = (projectedY.y - projected.y) / epsilon;
    const determinant = j11 * j22 - j12 * j21;
    if (Math.abs(determinant) < 0.000001) break;

    const deltaX = (errorX * j22 - j12 * errorY) / determinant;
    const deltaY = (j11 * errorY - errorX * j21) / determinant;
    guess = {
      x: Math.max(-4, Math.min(5, guess.x - deltaX)),
      y: Math.max(-4, Math.min(5, guess.y - deltaY)),
    };
  }

  return guess;
}

export function calculateLayerOverlayBounds({
  sourceWidth,
  sourceHeight,
  outputWidth,
  outputHeight,
  canvasWidth,
  canvasHeight,
  position,
  scale,
  rotation,
}: CalculateLayerOverlayBoundsParams): LayerOverlayBounds {
  const safeSourceWidth = positiveNumber(sourceWidth, outputWidth);
  const safeSourceHeight = positiveNumber(sourceHeight, outputHeight);
  const safeOutputWidth = positiveNumber(outputWidth, canvasWidth);
  const safeOutputHeight = positiveNumber(outputHeight, canvasHeight);
  const safeCanvasWidth = positiveNumber(canvasWidth, safeOutputWidth);
  const safeCanvasHeight = positiveNumber(canvasHeight, safeOutputHeight);
  const sourceAspect = safeSourceWidth / safeSourceHeight;
  const outputAspect = safeOutputWidth / safeOutputHeight;
  const aspectRatio = sourceAspect / outputAspect;
  const posX = finiteNumber(position.x, 0);
  const posY = finiteNumber(position.y, 0);
  const scaleX = finiteNumber(scale.x, 1);
  const scaleY = finiteNumber(scale.y, 1);
  const rotationZ = finiteNumber(rotation, 0);
  const cosZ = Math.cos(-rotationZ);
  const sinZ = Math.sin(-rotationZ);

  const sourceToCanvas = (sampleX: number, sampleY: number): OverlayPoint => {
    let correctedX = sampleX - 0.5 + posX;
    let correctedY = sampleY - 0.5 + posY;

    if (aspectRatio > 1) {
      correctedY /= aspectRatio;
    } else {
      correctedX *= aspectRatio;
    }

    const scaledX = correctedX * scaleX;
    const scaledY = correctedY * scaleY;
    const rotatedX = scaledX;
    const rotatedY = scaledY / outputAspect;
    const unrotatedX = rotatedX * cosZ - rotatedY * sinZ;
    const unrotatedY = rotatedX * sinZ + rotatedY * cosZ;
    const outputX = unrotatedX;
    const outputY = unrotatedY * outputAspect;

    return {
      x: (0.5 + outputX) * safeCanvasWidth,
      y: (0.5 + outputY) * safeCanvasHeight,
    };
  };

  const tl = sourceToCanvas(0, 0);
  const tr = sourceToCanvas(1, 0);
  const br = sourceToCanvas(1, 1);
  const bl = sourceToCanvas(0, 1);
  const center = average([tl, tr, br, bl]);

  return {
    x: center.x,
    y: center.y,
    width: distance(tl, tr),
    height: distance(tl, bl),
    rotation: Math.atan2(tr.y - tl.y, tr.x - tl.x),
    corners: { tl, tr, br, bl },
  };
}

export function pointInLayerOverlayBounds(point: OverlayPoint, bounds: LayerOverlayBounds): boolean {
  const corners = [bounds.corners.tl, bounds.corners.tr, bounds.corners.br, bounds.corners.bl];
  let hasPositive = false;
  let hasNegative = false;

  for (let i = 0; i < corners.length; i += 1) {
    const current = corners[i]!;
    const next = corners[(i + 1) % corners.length]!;
    const cross = (next.x - current.x) * (point.y - current.y) - (next.y - current.y) * (point.x - current.x);

    if (cross > 0.000001) hasPositive = true;
    if (cross < -0.000001) hasNegative = true;
    if (hasPositive && hasNegative) return false;
  }

  return true;
}

export function getLayerOverlayHandles(bounds: LayerOverlayBounds): Record<string, OverlayPoint> {
  const { tl, tr, br, bl } = bounds.corners;

  return {
    tl,
    tr,
    br,
    bl,
    t: average([tl, tr]),
    r: average([tr, br]),
    b: average([bl, br]),
    l: average([tl, bl]),
  };
}

function normalizeDelta(point: OverlayPoint, fallback: OverlayPoint): OverlayPoint {
  const length = Math.hypot(point.x, point.y);
  if (length < 0.000001) {
    return fallback;
  }

  return {
    x: point.x / length,
    y: point.y / length,
  };
}

export function resolveScaleDeltaForHandle(
  bounds: LayerOverlayBounds,
  handle: string,
  canvasDelta: OverlayPoint,
): OverlayPoint {
  const handles = getLayerOverlayHandles(bounds);
  const xAxis = normalizeDelta({
    x: handles.r.x - bounds.x,
    y: handles.r.y - bounds.y,
  }, { x: 1, y: 0 });
  const yAxis = normalizeDelta({
    x: handles.b.x - bounds.x,
    y: handles.b.y - bounds.y,
  }, { x: 0, y: 1 });
  const projectedX = canvasDelta.x * xAxis.x + canvasDelta.y * xAxis.y;
  const projectedY = canvasDelta.x * yAxis.x + canvasDelta.y * yAxis.y;

  return {
    x: handle.includes('l') ? -projectedX : handle.includes('r') ? projectedX : 0,
    y: handle.includes('t') ? -projectedY : handle.includes('b') ? projectedY : 0,
  };
}

export function resolvePositionDeltaForCanvasDelta(
  baseBounds: LayerOverlayBounds,
  xPlusBounds: LayerOverlayBounds,
  yPlusBounds: LayerOverlayBounds,
  canvasDelta: OverlayPoint,
): OverlayPoint {
  const xBasis = {
    x: xPlusBounds.x - baseBounds.x,
    y: xPlusBounds.y - baseBounds.y,
  };
  const yBasis = {
    x: yPlusBounds.x - baseBounds.x,
    y: yPlusBounds.y - baseBounds.y,
  };
  const determinant = xBasis.x * yBasis.y - xBasis.y * yBasis.x;

  if (Math.abs(determinant) < 0.000001) {
    return { x: 0, y: 0 };
  }

  return {
    x: (canvasDelta.x * yBasis.y - yBasis.x * canvasDelta.y) / determinant,
    y: (xBasis.x * canvasDelta.y - xBasis.y * canvasDelta.x) / determinant,
  };
}

export function scaleLayerOverlayBounds(bounds: LayerOverlayBounds, scaleFactor: number, offset: OverlayPoint): LayerOverlayBounds {
  const scalePoint = (point: OverlayPoint): OverlayPoint => ({
    x: offset.x + point.x * scaleFactor,
    y: offset.y + point.y * scaleFactor,
  });

  const tl = scalePoint(bounds.corners.tl);
  const tr = scalePoint(bounds.corners.tr);
  const br = scalePoint(bounds.corners.br);
  const bl = scalePoint(bounds.corners.bl);
  const center = scalePoint({ x: bounds.x, y: bounds.y });

  return {
    x: center.x,
    y: center.y,
    width: distance(tl, tr),
    height: distance(tl, bl),
    rotation: bounds.rotation,
    corners: { tl, tr, br, bl },
  };
}
