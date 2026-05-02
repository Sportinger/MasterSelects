import type { Text3DProperties } from '../../../types';
import earcut from './lib/earcut.js';
import gentilisBold from './fonts/gentilis_bold.typeface.json';
import gentilisRegular from './fonts/gentilis_regular.typeface.json';
import helvetikerBold from './fonts/helvetiker_bold.typeface.json';
import helvetikerRegular from './fonts/helvetiker_regular.typeface.json';
import optimerBold from './fonts/optimer_bold.typeface.json';
import optimerRegular from './fonts/optimer_regular.typeface.json';

interface Point2D {
  x: number;
  y: number;
}

interface GlyphData {
  ha: number;
  o?: string;
  _cachedOutline?: string[];
}

interface FontData {
  glyphs: Record<string, GlyphData>;
  resolution: number;
  familyName: string;
}

interface TextShape {
  contour: Point2D[];
  holes: Point2D[][];
}

interface Bounds2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface LoopLayer {
  points: Point2D[];
  z: number;
  normalZ: number;
}

export interface TextMeshGeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  edgeIndices: Uint32Array;
}

const TEXT_3D_FONT_DATA: Record<
  Text3DProperties['fontFamily'],
  Record<Text3DProperties['fontWeight'], FontData>
> = {
  helvetiker: {
    regular: helvetikerRegular as FontData,
    bold: helvetikerBold as FontData,
  },
  optimer: {
    regular: optimerRegular as FontData,
    bold: optimerBold as FontData,
  },
  gentilis: {
    regular: gentilisRegular as FontData,
    bold: gentilisBold as FontData,
  },
};

const EPSILON = 1e-5;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= EPSILON;
}

function pointsEqual(a: Point2D, b: Point2D): boolean {
  return approxEqual(a.x, b.x) && approxEqual(a.y, b.y);
}

function clonePoint(point: Point2D): Point2D {
  return { x: point.x, y: point.y };
}

function polygonArea(points: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    area += (current?.x ?? 0) * (next?.y ?? 0) - (next?.x ?? 0) * (current?.y ?? 0);
  }
  return area * 0.5;
}

function isClockwise(points: Point2D[]): boolean {
  return polygonArea(points) < 0;
}

function ensureWinding(points: Point2D[], clockwise: boolean): Point2D[] {
  const normalized = points.map(clonePoint);
  if (normalized.length < 3) {
    return normalized;
  }
  return isClockwise(normalized) === clockwise ? normalized : normalized.reverse();
}

function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const intersects =
      ((a?.y ?? 0) > point.y) !== ((b?.y ?? 0) > point.y) &&
      point.x < (((b?.x ?? 0) - (a?.x ?? 0)) * (point.y - (a?.y ?? 0))) /
        (((b?.y ?? 0) - (a?.y ?? 0)) || 1e-9) +
        (a?.x ?? 0);
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function normalize2D(x: number, y: number): Point2D {
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function createFallbackGeometry(): TextMeshGeometryData {
  const vertices = new Float32Array([
    -0.0005, -0.0005, 0.0005, 0, 0, 1, 0, 0,
    0.0005, -0.0005, 0.0005, 0, 0, 1, 0, 0,
    0.0005, 0.0005, 0.0005, 0, 0, 1, 0, 0,
    -0.0005, 0.0005, 0.0005, 0, 0, 1, 0, 0,
    -0.0005, -0.0005, -0.0005, 0, 0, -1, 0, 0,
    0.0005, -0.0005, -0.0005, 0, 0, -1, 0, 0,
    0.0005, 0.0005, -0.0005, 0, 0, -1, 0, 0,
    -0.0005, 0.0005, -0.0005, 0, 0, -1, 0, 0,
  ]);
  const indices = new Uint32Array([
    0, 1, 2, 0, 2, 3,
    4, 6, 5, 4, 7, 6,
  ]);
  return {
    vertices,
    indices,
    edgeIndices: buildEdgeIndices(indices),
  };
}

function buildEdgeIndices(indices: Uint32Array): Uint32Array {
  const edges = new Set<string>();
  const result: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i] ?? 0, indices[i + 1] ?? 0, indices[i + 2] ?? 0];
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangle[edge];
      const b = triangle[(edge + 1) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) {
        continue;
      }
      edges.add(key);
      result.push(a, b);
    }
  }
  return new Uint32Array(result);
}

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

function buildGlyphContours(
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

function contoursToShapes(contours: Point2D[][]): TextShape[] {
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

function computeShapesBounds(shapes: TextShape[]): Bounds2D | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  const visit = (point: Point2D) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };

  for (const shape of shapes) {
    shape.contour.forEach(visit);
    shape.holes.forEach((hole) => hole.forEach(visit));
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function translateShapes(shapes: TextShape[], offsetX: number, offsetY: number): TextShape[] {
  return shapes.map((shape) => ({
    contour: shape.contour.map((point) => ({
      x: point.x + offsetX,
      y: point.y + offsetY,
    })),
    holes: shape.holes.map((hole) =>
      hole.map((point) => ({
        x: point.x + offsetX,
        y: point.y + offsetY,
      }))),
  }));
}

function getShapeInteriorNormal(loop: Point2D[], index: number): Point2D {
  const count = loop.length;
  const prev = loop[(index - 1 + count) % count]!;
  const current = loop[index]!;
  const next = loop[(index + 1) % count]!;
  const clockwise = isClockwise(loop);
  const prevEdge = normalize2D(current.x - prev.x, current.y - prev.y);
  const nextEdge = normalize2D(next.x - current.x, next.y - current.y);
  const prevInterior = clockwise
    ? { x: prevEdge.y, y: -prevEdge.x }
    : { x: -prevEdge.y, y: prevEdge.x };
  const nextInterior = clockwise
    ? { x: nextEdge.y, y: -nextEdge.x }
    : { x: -nextEdge.y, y: nextEdge.x };
  const combined = normalize2D(prevInterior.x + nextInterior.x, prevInterior.y + nextInterior.y);
  return combined;
}

function offsetLoop(loop: Point2D[], amount: number, isHole: boolean): Point2D[] {
  if (Math.abs(amount) <= EPSILON) {
    return loop.map(clonePoint);
  }

  return loop.map((point, index) => {
    const interior = getShapeInteriorNormal(loop, index);
    const shapeInward = isHole
      ? { x: -interior.x, y: -interior.y }
      : interior;
    return {
      x: point.x + shapeInward.x * amount,
      y: point.y + shapeInward.y * amount,
    };
  });
}

function buildLoopLayers(
  loop: Point2D[],
  isHole: boolean,
  props: Text3DProperties,
): LoopLayer[] {
  const halfDepth = props.depth * 0.5;
  const bevelEnabled =
    props.bevelEnabled &&
    props.bevelSize > EPSILON &&
    props.bevelThickness > EPSILON &&
    props.bevelSegments > 0;

  if (!bevelEnabled) {
    return [
      { points: loop.map(clonePoint), z: halfDepth, normalZ: 0 },
      { points: loop.map(clonePoint), z: -halfDepth, normalZ: 0 },
    ];
  }

  const bevelDepth = Math.min(props.bevelThickness, halfDepth);
  const steps = Math.max(1, Math.round(props.bevelSegments));
  const bodyFrontZ = halfDepth - bevelDepth;
  const bodyBackZ = -halfDepth + bevelDepth;
  const layers: LoopLayer[] = [{ points: loop.map(clonePoint), z: halfDepth, normalZ: 1 }];

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    layers.push({
      points: offsetLoop(loop, props.bevelSize * t, isHole),
      z: halfDepth - bevelDepth * t,
      normalZ: 1 - t,
    });
  }

  if (bodyBackZ < bodyFrontZ - EPSILON) {
    layers.push({
      points: offsetLoop(loop, props.bevelSize, isHole),
      z: bodyBackZ,
      normalZ: 0,
    });
  }

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    layers.push({
      points: offsetLoop(loop, props.bevelSize * (1 - t), isHole),
      z: bodyBackZ - bevelDepth * t,
      normalZ: -t,
    });
  }

  return layers;
}

function getShapeOutwardNormal(loop: Point2D[], index: number, isHole: boolean): Point2D {
  const interior = getShapeInteriorNormal(loop, index);
  return isHole
    ? interior
    : { x: -interior.x, y: -interior.y };
}

function addVertex(
  data: number[],
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
): number {
  const index = data.length / 8;
  data.push(x, y, z, nx, ny, nz, 0, 0);
  return index;
}

function addCapGeometry(
  vertexData: number[],
  indexData: number[],
  shape: TextShape,
  z: number,
  normalZ: number,
  reverse: boolean,
): void {
  const flatVertices: number[] = [];
  const holeIndices: number[] = [];
  const allLoops = [shape.contour, ...shape.holes];
  const loopBaseIndices: number[] = [];
  let vertexCount = 0;

  for (let loopIndex = 0; loopIndex < allLoops.length; loopIndex += 1) {
    const loop = allLoops[loopIndex]!;
    if (loopIndex > 0) {
      holeIndices.push(vertexCount);
    }
    loopBaseIndices.push(vertexCount);
    vertexCount += loop.length;
    for (const point of loop) {
      flatVertices.push(point.x, point.y);
    }
  }

  const baseIndices: number[] = [];
  for (const loop of allLoops) {
    for (const point of loop) {
      baseIndices.push(addVertex(vertexData, point.x, point.y, z, 0, 0, normalZ));
    }
  }

  const triangles = earcut(flatVertices, holeIndices, 2);
  for (let i = 0; i < triangles.length; i += 3) {
    const a = baseIndices[triangles[i] ?? 0]!;
    const b = baseIndices[triangles[i + 1] ?? 0]!;
    const c = baseIndices[triangles[i + 2] ?? 0]!;
    if (reverse) {
      indexData.push(c, b, a);
    } else {
      indexData.push(a, b, c);
    }
  }
}

function addSideGeometry(
  vertexData: number[],
  indexData: number[],
  loop: Point2D[],
  isHole: boolean,
  props: Text3DProperties,
): void {
  const layers = buildLoopLayers(loop, isHole, props);
  const layerIndices: number[][] = [];

  for (const layer of layers) {
    const indices: number[] = [];
    for (let i = 0; i < layer.points.length; i += 1) {
      const point = layer.points[i]!;
      const outward = getShapeOutwardNormal(loop, i, isHole);
      const normal = normalize2D(outward.x, outward.y);
      const zComponent = layer.normalZ;
      const length = Math.hypot(normal.x, normal.y, zComponent) || 1;
      indices.push(addVertex(
        vertexData,
        point.x,
        point.y,
        layer.z,
        normal.x / length,
        normal.y / length,
        zComponent / length,
      ));
    }
    layerIndices.push(indices);
  }

  for (let layerIndex = 0; layerIndex < layerIndices.length - 1; layerIndex += 1) {
    const current = layerIndices[layerIndex]!;
    const next = layerIndices[layerIndex + 1]!;
    for (let i = 0; i < current.length; i += 1) {
      const j = (i + 1) % current.length;
      const a = current[i]!;
      const b = current[j]!;
      const c = next[i]!;
      const d = next[j]!;
      indexData.push(a, c, d);
      indexData.push(a, d, b);
    }
  }
}

function buildTextGeometry(props: Text3DProperties): TextMeshGeometryData {
  const font = TEXT_3D_FONT_DATA[props.fontFamily][props.fontWeight];
  const fallback = createFallbackGeometry();
  if (!font) {
    return fallback;
  }

  const scale = props.size / font.resolution;
  const lines = (props.text || '3D Text').split(/\r?\n/);
  const letterSpacing = props.letterSpacing;
  const lineAdvance = props.size * props.lineHeight;
  const spaceAdvance = props.size * 0.35 + letterSpacing;
  let shapes: TextShape[] = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    const lineShapes: TextShape[] = [];
    let cursorX = 0;

    for (const character of line) {
      if (character === ' ') {
        cursorX += spaceAdvance;
        continue;
      }

      const glyph = font.glyphs[character] ?? font.glyphs['?'];
      if (!glyph) {
        continue;
      }

      const contours = buildGlyphContours(glyph, scale, Math.max(1, Math.round(props.curveSegments)));
      const glyphShapes = contoursToShapes(contours);
      const glyphBounds = computeShapesBounds(glyphShapes);
      const glyphMinX = glyphBounds?.minX ?? 0;
      const glyphWidth = glyphBounds ? glyphBounds.maxX - glyphBounds.minX : props.size * 0.4;

      lineShapes.push(
        ...translateShapes(glyphShapes, cursorX - glyphMinX, 0),
      );
      cursorX += glyphWidth + letterSpacing;
    }

    const trimmedLineWidth = cursorX > 0 ? cursorX - letterSpacing : 0;
    const alignOffsetX = props.textAlign === 'left'
      ? 0
      : props.textAlign === 'right'
        ? -trimmedLineWidth
        : -trimmedLineWidth * 0.5;

    shapes = shapes.concat(translateShapes(lineShapes, alignOffsetX, -lineIndex * lineAdvance));
  }

  const bounds = computeShapesBounds(shapes);
  if (!bounds) {
    return fallback;
  }

  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  shapes = translateShapes(shapes, -centerX, -centerY);

  const vertexData: number[] = [];
  const indexData: number[] = [];
  for (const shape of shapes) {
    addCapGeometry(vertexData, indexData, shape, props.depth * 0.5, 1, false);
    addCapGeometry(vertexData, indexData, shape, -props.depth * 0.5, -1, true);
    addSideGeometry(vertexData, indexData, shape.contour, false, props);
    for (const hole of shape.holes) {
      addSideGeometry(vertexData, indexData, hole, true, props);
    }
  }

  if (vertexData.length === 0 || indexData.length === 0) {
    return fallback;
  }

  const indices = new Uint32Array(indexData);
  return {
    vertices: new Float32Array(vertexData),
    indices,
    edgeIndices: buildEdgeIndices(indices),
  };
}

export class TextMeshCache {
  private keys = new Set<string>();
  private geometries = new Map<string, TextMeshGeometryData>();

  getKey(props: Text3DProperties | undefined): string {
    if (!props) {
      return 'text3d:missing';
    }

    return JSON.stringify({
      text: props.text,
      fontFamily: props.fontFamily,
      fontWeight: props.fontWeight,
      size: props.size,
      depth: props.depth,
      letterSpacing: props.letterSpacing,
      lineHeight: props.lineHeight,
      textAlign: props.textAlign,
      curveSegments: props.curveSegments,
      bevelEnabled: props.bevelEnabled,
      bevelThickness: props.bevelThickness,
      bevelSize: props.bevelSize,
      bevelSegments: props.bevelSegments,
    });
  }

  touch(key: string): void {
    if (!key) {
      return;
    }
    this.keys.add(key);
  }

  has(key: string): boolean {
    return this.keys.has(key) || this.geometries.has(key);
  }

  getOrCreate(props: Text3DProperties | undefined): TextMeshGeometryData {
    const key = this.getKey(props);
    this.touch(key);
    const cached = this.geometries.get(key);
    if (cached) {
      return cached;
    }

    const geometry = props ? buildTextGeometry(props) : createFallbackGeometry();
    this.geometries.set(key, geometry);
    return geometry;
  }

  clear(): void {
    this.keys.clear();
    this.geometries.clear();
  }
}
