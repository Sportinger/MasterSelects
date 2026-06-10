import earcut from '../lib/earcut.js';
import { TEXT_3D_FONT_DATA } from './fontData';
import { buildGlyphContours, contoursToShapes } from './glyphs';
import {
  clonePoint,
  computeShapesBounds,
  EPSILON,
  isClockwise,
  normalize2D,
  translateShapes,
} from './shapeMath';
import type {
  LoopLayer,
  Point2D,
  TextMeshBuildProps,
  TextMeshGeometryData,
  TextShape,
} from './types';

export function createFallbackGeometry(): TextMeshGeometryData {
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
  props: TextMeshBuildProps,
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
  props: TextMeshBuildProps,
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

export function buildTextGeometry(props: TextMeshBuildProps): TextMeshGeometryData {
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
