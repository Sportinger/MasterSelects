import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import type { DenseTerrainMesh, TerrainReconstruction } from '../../../types/terrainTracking';
import './TrackingGeometryPreview.css';

const MAX_DRAWN_TRIANGLES = 14_000;
const MAX_DRAWN_POINTS = 18_000;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 8;

export interface TrackingGeometryPreviewProps {
  terrain: TerrainReconstruction;
  width: number;
  height: number;
}

export interface TrackingGeometrySource {
  positions: readonly number[];
  indices: readonly number[];
  kind: 'reconstruction' | 'footstep-patch' | 'sparse';
}

interface OrbitView {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

interface Bounds {
  center: [number, number, number];
  radius: number;
}

interface DragState {
  pointerId: number;
  mode: 'rotate' | 'pan';
  x: number;
  y: number;
  view: OrbitView;
}

const DEFAULT_VIEW: OrbitView = {
  yaw: -0.65,
  pitch: -0.55,
  zoom: 1,
  panX: 0,
  panY: 0,
};

/** Return retained CPU arrays directly. Repeated patch references are drawn once. */
export function collectTrackingGeometrySources(
  terrain: TerrainReconstruction,
): TrackingGeometrySource[] {
  const sources: TrackingGeometrySource[] = [];
  const seen = new Set<DenseTerrainMesh>();
  const appendMesh = (mesh: DenseTerrainMesh | undefined, kind: TrackingGeometrySource['kind']) => {
    if (!mesh || seen.has(mesh) || mesh.positions.length < 3) return;
    seen.add(mesh);
    sources.push({ positions: mesh.positions, indices: mesh.indices, kind });
  };

  appendMesh(terrain.denseMesh, 'reconstruction');
  for (const footstep of terrain.footsteps ?? []) {
    appendMesh(footstep.mesh, 'footstep-patch');
  }

  if (sources.length === 0 && terrain.vertices.length > 0) {
    const positions = new Array<number>(terrain.vertices.length * 3);
    for (let index = 0; index < terrain.vertices.length; index += 1) {
      const point = terrain.vertices[index]!.position;
      positions[index * 3] = point[0];
      positions[index * 3 + 1] = point[1];
      positions[index * 3 + 2] = point[2];
    }
    sources.push({ positions, indices: terrain.triangles, kind: 'sparse' });
  }

  return sources;
}

export function getTriangleSampleStep(indexCount: number): number {
  const triangleCount = Math.floor(indexCount / 3);
  return Math.max(1, Math.ceil(triangleCount / MAX_DRAWN_TRIANGLES));
}

function getBounds(sources: readonly TrackingGeometrySource[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const source of sources) {
    for (let index = 0; index + 2 < source.positions.length; index += 3) {
      const x = source.positions[index]!;
      const y = source.positions[index + 1]!;
      const z = source.positions[index + 2]!;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
  }
  if (!Number.isFinite(minX)) return { center: [0, 0, 0], radius: 1 };
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];
  const radius = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2;
  return { center, radius: Math.max(radius, 0.0001) };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function drawGeometry(
  context: CanvasRenderingContext2D,
  sources: readonly TrackingGeometrySource[],
  bounds: Bounds,
  view: OrbitView,
  width: number,
  height: number,
): void {
  context.clearRect(0, 0, width, height);
  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, '#151a20');
  background.addColorStop(1, '#0b0e12');
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  if (sources.length === 0) {
    context.fillStyle = 'rgba(225, 233, 242, 0.62)';
    context.font = '12px system-ui, sans-serif';
    context.textAlign = 'center';
    context.fillText('No reconstruction geometry', width / 2, height / 2);
    return;
  }

  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);
  const cameraDistance = bounds.radius * 3.4;
  const focalLength = Math.min(width, height) * 0.92 * view.zoom;
  const project = (positions: readonly number[], pointIndex: number): [number, number] | null => {
    const offset = pointIndex * 3;
    const x = positions[offset]! - bounds.center[0];
    const y = positions[offset + 1]! - bounds.center[1];
    const z = positions[offset + 2]! - bounds.center[2];
    if (![x, y, z].every(Number.isFinite)) return null;
    const yawX = cosYaw * x - sinYaw * z;
    const yawZ = sinYaw * x + cosYaw * z;
    const pitchY = cosPitch * y - sinPitch * yawZ;
    const pitchZ = sinPitch * y + cosPitch * yawZ;
    const depth = cameraDistance + pitchZ;
    if (depth <= bounds.radius * 0.05) return null;
    const scale = focalLength / depth;
    return [width / 2 + view.panX + yawX * scale, height / 2 + view.panY + pitchY * scale];
  };

  const colors = ['rgba(93, 176, 255, 0.62)', 'rgba(255, 184, 94, 0.72)', 'rgba(112, 224, 177, 0.66)'];
  const triangleCounts = sources.map((source) => Math.floor(source.indices.length / 3));
  const totalTriangles = triangleCounts.reduce((total, count) => total + count, 0);
  const triangulatedSourceCount = triangleCounts.filter((count) => count > 0).length;
  const proportionalBudget = Math.max(0, MAX_DRAWN_TRIANGLES - triangulatedSourceCount);
  sources.forEach((source, sourceIndex) => {
    context.beginPath();
    context.strokeStyle = source.kind === 'footstep-patch'
      ? colors[1]!
      : source.kind === 'sparse'
        ? colors[2]!
        : colors[sourceIndex % colors.length]!;
    context.lineWidth = source.kind === 'footstep-patch' ? 1.15 : 0.7;

    const triangleCount = triangleCounts[sourceIndex]!;
    const sourceBudget = triangleCount > 0
      ? 1 + Math.floor(proportionalBudget * triangleCount / Math.max(1, totalTriangles))
      : 0;
    const step = Math.max(1, Math.ceil(triangleCount / Math.max(1, sourceBudget)));
    let trianglesDrawn = 0;
    for (let triangle = 0; triangle < triangleCount && trianglesDrawn < sourceBudget; triangle += step) {
      const offset = triangle * 3;
      const a = project(source.positions, source.indices[offset]!);
      const b = project(source.positions, source.indices[offset + 1]!);
      const c = project(source.positions, source.indices[offset + 2]!);
      if (!a || !b || !c) continue;
      context.moveTo(a[0], a[1]);
      context.lineTo(b[0], b[1]);
      context.lineTo(c[0], c[1]);
      context.closePath();
      trianglesDrawn += 1;
    }
    context.stroke();

    if (triangleCount === 0) {
      const pointCount = Math.floor(source.positions.length / 3);
      const pointStep = Math.max(1, Math.ceil(pointCount / MAX_DRAWN_POINTS));
      context.fillStyle = context.strokeStyle;
      for (let pointIndex = 0; pointIndex < pointCount; pointIndex += pointStep) {
        const point = project(source.positions, pointIndex);
        if (point) context.fillRect(point[0] - 1, point[1] - 1, 2, 2);
      }
    }
  });
}

function copyView(view: OrbitView): OrbitView {
  return { ...view };
}

export function TrackingGeometryPreview({ terrain, width, height }: TrackingGeometryPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [view, setView] = useState<OrbitView>(DEFAULT_VIEW);
  const sources = useMemo(() => collectTrackingGeometrySources(terrain), [terrain]);
  const bounds = useMemo(() => getBounds(sources), [sources]);
  const cssWidth = Math.max(1, Math.round(width));
  const cssHeight = Math.max(1, Math.round(height));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pixelRatio = clamp(window.devicePixelRatio || 1, 1, 2);
    const backingWidth = Math.max(1, Math.round(cssWidth * pixelRatio));
    const backingHeight = Math.max(1, Math.round(cssHeight * pixelRatio));
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawGeometry(context, sources, bounds, view, cssWidth, cssHeight);
  }, [bounds, cssHeight, cssWidth, sources, view]);

  useEffect(() => () => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = 1;
      canvas.height = 1;
    }
  }, []);

  const reset = useCallback(() => setView(DEFAULT_VIEW), []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      mode: event.shiftKey || event.button === 1 ? 'pan' : 'rotate',
      x: event.clientX,
      y: event.clientY,
      view: copyView(view),
    };
  }, [view]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.x;
    const deltaY = event.clientY - drag.y;
    setView(drag.mode === 'pan'
      ? { ...drag.view, panX: drag.view.panX + deltaX, panY: drag.view.panY + deltaY }
      : {
          ...drag.view,
          yaw: drag.view.yaw + deltaX * 0.008,
          pitch: clamp(drag.view.pitch + deltaY * 0.008, -Math.PI * 0.48, Math.PI * 0.48),
        });
  }, []);

  const endPointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    setView((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
  }, []);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key === 'Home' || key === '0') {
      event.preventDefault();
      reset();
      return;
    }
    if (key === '+' || key === '=') {
      event.preventDefault();
      setView((current) => ({ ...current, zoom: clamp(current.zoom * 1.15, MIN_ZOOM, MAX_ZOOM) }));
      return;
    }
    if (key === '-' || key === '_') {
      event.preventDefault();
      setView((current) => ({ ...current, zoom: clamp(current.zoom / 1.15, MIN_ZOOM, MAX_ZOOM) }));
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) return;
    event.preventDefault();
    const horizontal = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
    const vertical = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
    setView((current) => event.shiftKey
      ? { ...current, panX: current.panX + horizontal * 10, panY: current.panY + vertical * 10 }
      : {
          ...current,
          yaw: current.yaw + horizontal * 0.08,
          pitch: clamp(current.pitch + vertical * 0.08, -Math.PI * 0.48, Math.PI * 0.48),
        });
  }, [reset]);

  const triangleCount = sources.reduce((total, source) => total + Math.floor(source.indices.length / 3), 0);
  const patchCount = sources.filter((source) => source.kind === 'footstep-patch').length;
  const description = sources.length === 0
    ? 'No geometry'
    : `${triangleCount.toLocaleString()} triangles${patchCount ? ` · ${patchCount} patches` : ''} · coarse wireframe · no texture`;

  return (
    <div
      className="tracking-geometry-preview"
      style={{ width: cssWidth, height: cssHeight }}
      tabIndex={0}
      role="application"
      aria-label="Tracking geometry preview. Drag to rotate, Shift-drag to pan, scroll to zoom. Arrow keys rotate; Shift plus arrow keys pan; Home resets."
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPointerDrag}
      onPointerCancel={endPointerDrag}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
    >
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="tracking-geometry-preview__status">{description}</span>
      <button
        type="button"
        className="tracking-geometry-preview__reset"
        aria-label="Reset tracking geometry view"
        title="Reset view (Home)"
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
        }}
        onClick={(event) => {
          event.stopPropagation();
          reset();
        }}
      >
        Reset
      </button>
    </div>
  );
}
