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

    const rotatedX = correctedX;
    const rotatedY = correctedY / outputAspect;
    const unrotatedX = rotatedX * cosZ - rotatedY * sinZ;
    const unrotatedY = rotatedX * sinZ + rotatedY * cosZ;
    const outputX = unrotatedX * scaleX;
    const outputY = unrotatedY * scaleY * outputAspect;

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
