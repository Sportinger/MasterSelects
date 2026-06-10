import {
  clonePoint,
  ensureWinding,
  isClockwise,
  pointInPolygon,
  pointsEqual,
} from './shapeMath';
import type { GlyphData, Point2D, TextShape } from './types';

function getGlyphOutline(glyph: GlyphData): string[] {
  if (glyph._cachedOutline) {
    return glyph._cachedOutline;
  }
  const outline = glyph.o ? glyph.o.split(' ') : [];
  glyph._cachedOutline = outline;
  return outline;
}

function sampleQuadraticBezier(
  start: Point2D,
  control: Point2D,
  end: Point2D,
  segments: number,
): Point2D[] {
  const points: Point2D[] = [];
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const mt = 1 - t;
    points.push({
      x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
      y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
    });
  }
  return points;
}

function sampleCubicBezier(
  start: Point2D,
  controlA: Point2D,
  controlB: Point2D,
  end: Point2D,
  segments: number,
): Point2D[] {
  const points: Point2D[] = [];
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const mt = 1 - t;
    points.push({
      x:
        mt * mt * mt * start.x +
        3 * mt * mt * t * controlA.x +
        3 * mt * t * t * controlB.x +
        t * t * t * end.x,
      y:
        mt * mt * mt * start.y +
        3 * mt * mt * t * controlA.y +
        3 * mt * t * t * controlB.y +
        t * t * t * end.y,
    });
  }
  return points;
}

export function buildGlyphContours(
  glyph: GlyphData,
  scale: number,
  curveSegments: number,
): Point2D[][] {
  if (!glyph.o) {
    return [];
  }

  const outline = getGlyphOutline(glyph);
  const contours: Point2D[][] = [];
  let currentContour: Point2D[] | null = null;

  for (let i = 0; i < outline.length; ) {
    const action = outline[i++];
    switch (action) {
      case 'm': {
        const x = (Number(outline[i++]) || 0) * scale;
        const y = (Number(outline[i++]) || 0) * scale;
        currentContour = [{ x, y }];
        contours.push(currentContour);
        break;
      }
      case 'l': {
        if (!currentContour) {
          break;
        }
        const x = (Number(outline[i++]) || 0) * scale;
        const y = (Number(outline[i++]) || 0) * scale;
        currentContour.push({ x, y });
        break;
      }
      case 'q': {
        if (!currentContour || currentContour.length === 0) {
          i += 4;
          break;
        }
        const end = {
          x: (Number(outline[i++]) || 0) * scale,
          y: (Number(outline[i++]) || 0) * scale,
        };
        const control = {
          x: (Number(outline[i++]) || 0) * scale,
          y: (Number(outline[i++]) || 0) * scale,
        };
        currentContour.push(
          ...sampleQuadraticBezier(
            currentContour[currentContour.length - 1] ?? { x: 0, y: 0 },
            control,
            end,
            curveSegments,
          ),
        );
        break;
      }
      case 'b': {
        if (!currentContour || currentContour.length === 0) {
          i += 6;
          break;
        }
        const end = {
          x: (Number(outline[i++]) || 0) * scale,
          y: (Number(outline[i++]) || 0) * scale,
        };
        const controlA = {
          x: (Number(outline[i++]) || 0) * scale,
          y: (Number(outline[i++]) || 0) * scale,
        };
        const controlB = {
          x: (Number(outline[i++]) || 0) * scale,
          y: (Number(outline[i++]) || 0) * scale,
        };
        currentContour.push(
          ...sampleCubicBezier(
            currentContour[currentContour.length - 1] ?? { x: 0, y: 0 },
            controlA,
            controlB,
            end,
            curveSegments,
          ),
        );
        break;
      }
      default:
        break;
    }
  }

  return contours
    .map((contour) => {
      const deduped: Point2D[] = [];
      for (const point of contour) {
        if (!deduped.length || !pointsEqual(point, deduped[deduped.length - 1]!)) {
          deduped.push(clonePoint(point));
        }
      }
      if (deduped.length > 2 && pointsEqual(deduped[0]!, deduped[deduped.length - 1]!)) {
        deduped.pop();
      }
      return deduped;
    })
    .filter((contour) => contour.length >= 3);
}

export function contoursToShapes(contours: Point2D[][]): TextShape[] {
  if (contours.length === 0) {
    return [];
  }
  if (contours.length === 1) {
    return [{
      contour: ensureWinding(contours[0]!, false),
      holes: [],
    }];
  }

  const holesFirst = !isClockwise(contours[0]!);
  const newShapes: Array<{ contour: Point2D[]; points: Point2D[] } | undefined> = [undefined];
  const newShapeHoles: Array<Array<{ contour: Point2D[]; point: Point2D }>> = [[]];
  let mainIndex = 0;

  for (const contour of contours) {
    const solid = isClockwise(contour);
    if (solid) {
      if (!holesFirst && newShapes[mainIndex]) {
        mainIndex += 1;
      }
      newShapes[mainIndex] = {
        contour: contour.map(clonePoint),
        points: contour.map(clonePoint),
      };
      if (holesFirst) {
        mainIndex += 1;
      }
      newShapeHoles[mainIndex] = [];
    } else {
      if (!newShapeHoles[mainIndex]) {
        newShapeHoles[mainIndex] = [];
      }
      newShapeHoles[mainIndex].push({
        contour: contour.map(clonePoint),
        point: clonePoint(contour[0]!),
      });
    }
  }

  if (!newShapes[0]) {
    return contours.map((contour) => ({
      contour: ensureWinding(contour, false),
      holes: [],
    }));
  }

  const betterShapeHoles: Point2D[][][] = Array.from(
    { length: newShapes.length },
    () => [],
  );

  for (let shapeIndex = 0; shapeIndex < newShapes.length; shapeIndex += 1) {
    const holes = newShapeHoles[shapeIndex] ?? [];
    for (const hole of holes) {
      let assignedIndex = shapeIndex;
      for (let targetIndex = 0; targetIndex < newShapes.length; targetIndex += 1) {
        const candidate = newShapes[targetIndex];
        if (!candidate) {
          continue;
        }
        if (pointInPolygon(hole.point, candidate.points)) {
          assignedIndex = targetIndex;
          break;
        }
      }
      betterShapeHoles[assignedIndex]?.push(hole.contour.map(clonePoint));
    }
  }

  const shapes: TextShape[] = [];
  for (let shapeIndex = 0; shapeIndex < newShapes.length; shapeIndex += 1) {
    const shape = newShapes[shapeIndex];
    if (!shape) {
      continue;
    }
    shapes.push({
      contour: ensureWinding(shape.contour, false),
      holes: (betterShapeHoles[shapeIndex] ?? []).map((hole) => ensureWinding(hole, true)),
    });
  }
  return shapes;
}
