import type {
  SceneCamera,
  SceneGizmoAxis,
  SceneGizmoMode,
  SceneLayer3DData,
  SceneVector3,
} from '../../scene/types';
import {
  SCENE_GIZMO_AXIS_SCREEN_LENGTH,
  SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS,
} from '../../scene/SceneGizmoConstants';
import shaderSource from '../shaders/GizmoPass.wgsl?raw';

type SceneGizmoLayer = Pick<SceneLayer3DData, 'clipId' | 'worldMatrix' | 'worldTransform'>;

type Vec2 = { x: number; y: number };
type Vec3 = { x: number; y: number; z: number };
type Vec4 = [number, number, number, number];

const VERTEX_FLOATS = 8;
const VERTEX_STRIDE_BYTES = VERTEX_FLOATS * 4;
const GIZMO_AXES: readonly SceneGizmoAxis[] = ['x', 'y', 'z'];
const AXIS_COLORS: Record<SceneGizmoAxis, readonly [number, number, number, number]> = {
  x: [1, 0.16, 0.12, 1],
  y: [0.2, 1, 0.32, 1],
  z: [0.22, 0.5, 1, 1],
};
const OUTLINE_COLOR = [0.015, 0.02, 0.03, 0.78] as const;
const RING_SEGMENTS = 96;
const AXIS_THICKNESS = 6.4;
const RING_THICKNESS = 5.1;
const OUTLINE_EXTRA_THICKNESS = 4.4;
const HOVER_THICKNESS_BOOST = 3.2;
const HOVER_OUTLINE_EXTRA_THICKNESS = 6.8;
const ORIENTATION_TICK_COLOR = [0.005, 0.007, 0.01, 0.92] as const;
const AXIS_TICK_OFFSETS = [0.34, 0.55, 0.76] as const;
const AXIS_TICK_LENGTH = 12;
const AXIS_TICK_THICKNESS = 2.3;
const RING_TICK_COUNT = 12;
const RING_TICK_LENGTH = 12;
const RING_TICK_THICKNESS = 2.2;

export class GizmoPass {
  private pipeline: GPURenderPipeline | null = null;

  initialize(device: GPUDevice, colorFormat: GPUTextureFormat): void {
    if (this.pipeline) return;

    const shaderModule = device.createShaderModule({
      code: shaderSource,
      label: 'native-scene-gizmo-shader',
    });

    this.pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: {
        module: shaderModule,
        entryPoint: 'vertexMain',
        buffers: [
          {
            arrayStride: VERTEX_STRIDE_BYTES,
            attributes: [
              { shaderLocation: 0, offset: 0, format: 'float32x4' },
              { shaderLocation: 1, offset: 16, format: 'float32x4' },
            ],
          },
        ],
      },
      fragment: {
        module: shaderModule,
        entryPoint: 'fragmentMain',
        targets: [
          {
            format: colorFormat,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
        cullMode: 'none',
      },
      label: 'native-scene-gizmo-pipeline',
    });
  }

  render(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sceneView: GPUTextureView,
    layer: SceneGizmoLayer | null,
    camera: SceneCamera,
    mode: SceneGizmoMode,
    hoveredAxis: SceneGizmoAxis | null | undefined,
    temporaryBuffers: GPUBuffer[],
  ): boolean {
    if (!layer?.worldTransform || !this.pipeline) {
      return true;
    }

    const vertices: number[] = [];
    const viewProjection = multiplyMat4(camera.projectionMatrix, camera.viewMatrix);
    const origin = layer.worldTransform.position;
    const basis = resolveAxisBasis(layer.worldMatrix);
    const worldPerPixel = resolveWorldPerPixel(origin, camera);

    if (mode === 'rotate') {
      this.appendRotationRings(vertices, viewProjection, camera.viewport, origin, basis, worldPerPixel, hoveredAxis ?? null);
    } else {
      this.appendAxisHandles(vertices, viewProjection, camera, origin, basis, worldPerPixel, mode, hoveredAxis ?? null);
    }

    if (vertices.length === 0) {
      return true;
    }

    const vertexData = new Float32Array(vertices);
    const vertexBuffer = device.createBuffer({
      size: vertexData.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      label: 'native-scene-gizmo-vertex-buffer',
    });
    temporaryBuffers.push(vertexBuffer);
    device.queue.writeBuffer(vertexBuffer, 0, vertexData.buffer, vertexData.byteOffset, vertexData.byteLength);

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: sceneView,
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: 'load',
          storeOp: 'store',
        },
      ],
      label: 'native-scene-gizmo-pass',
    });
    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, vertexBuffer);
    renderPass.draw(vertexData.length / VERTEX_FLOATS);
    renderPass.end();
    return true;
  }

  dispose(): void {
    this.pipeline = null;
  }

  private appendAxisHandles(
    vertices: number[],
    viewProjection: Float32Array,
    camera: SceneCamera,
    origin: SceneVector3,
    basis: Record<SceneGizmoAxis, Vec3>,
    worldPerPixel: number,
    mode: SceneGizmoMode,
    hoveredAxis: SceneGizmoAxis | null,
  ): void {
    const length = worldPerPixel * SCENE_GIZMO_AXIS_SCREEN_LENGTH;
    const arrowLength = worldPerPixel * 24;
    const arrowSpread = worldPerPixel * 12;
    const cameraForward = normalize({
      x: camera.cameraTarget.x - camera.cameraPosition.x,
      y: camera.cameraTarget.y - camera.cameraPosition.y,
      z: camera.cameraTarget.z - camera.cameraPosition.z,
    });

    for (const axis of getAxisDrawOrder(hoveredAxis)) {
      const axisVector = basis[axis];
      const end = add(origin, scale(axisVector, length));
      const thickness = resolveAxisThickness(AXIS_THICKNESS, axis, hoveredAxis);
      const color = resolveAxisColor(axis, hoveredAxis);
      const outlineExtra = resolveOutlineExtra(axis, hoveredAxis);
      const tickSide = resolveArrowSide(axisVector, cameraForward);
      addStyledSegment(vertices, viewProjection, camera.viewport, origin, end, thickness, color, outlineExtra);

      if (mode === 'move') {
        const side = tickSide;
        const base = add(end, scale(axisVector, -arrowLength));
        addStyledSegment(vertices, viewProjection, camera.viewport, add(base, scale(side, arrowSpread)), end, thickness, color, outlineExtra);
        addStyledSegment(vertices, viewProjection, camera.viewport, add(base, scale(side, -arrowSpread)), end, thickness, color, outlineExtra);
      } else {
        const sideA = normalize(cross(axisVector, { x: 0, y: 0, z: 1 }));
        const side = lengthOf(sideA) < 0.001 ? { x: 1, y: 0, z: 0 } : sideA;
        const sideB = normalize(cross(axisVector, side));
        const size = worldPerPixel * 13;
        const p1 = add(end, add(scale(side, -size), scale(sideB, -size)));
        const p2 = add(end, add(scale(side, size), scale(sideB, -size)));
        const p3 = add(end, add(scale(side, size), scale(sideB, size)));
        const p4 = add(end, add(scale(side, -size), scale(sideB, size)));
        addStyledSegment(vertices, viewProjection, camera.viewport, p1, p2, thickness, color, outlineExtra);
        addStyledSegment(vertices, viewProjection, camera.viewport, p2, p3, thickness, color, outlineExtra);
        addStyledSegment(vertices, viewProjection, camera.viewport, p3, p4, thickness, color, outlineExtra);
        addStyledSegment(vertices, viewProjection, camera.viewport, p4, p1, thickness, color, outlineExtra);
      }
      appendAxisOrientationTicks(
        vertices,
        viewProjection,
        camera.viewport,
        origin,
        axisVector,
        tickSide,
        length,
        worldPerPixel,
      );
    }
  }

  private appendRotationRings(
    vertices: number[],
    viewProjection: Float32Array,
    viewport: { width: number; height: number },
    origin: SceneVector3,
    basis: Record<SceneGizmoAxis, Vec3>,
    worldPerPixel: number,
    hoveredAxis: SceneGizmoAxis | null,
  ): void {
    const radius = worldPerPixel * SCENE_GIZMO_ROTATE_RING_SCREEN_RADIUS;
    const ringPlanes: Record<SceneGizmoAxis, [SceneGizmoAxis, SceneGizmoAxis]> = {
      x: ['y', 'z'],
      y: ['z', 'x'],
      z: ['x', 'y'],
    };

    for (const axis of getAxisDrawOrder(hoveredAxis)) {
      const [firstAxis, secondAxis] = ringPlanes[axis];
      const first = basis[firstAxis];
      const second = basis[secondAxis];
      const thickness = resolveAxisThickness(RING_THICKNESS, axis, hoveredAxis);
      const color = resolveAxisColor(axis, hoveredAxis);
      const outlineExtra = resolveOutlineExtra(axis, hoveredAxis);
      let previous: Vec3 | null = null;
      for (let i = 0; i <= RING_SEGMENTS; i += 1) {
        const angle = (i / RING_SEGMENTS) * Math.PI * 2;
        const point = add(origin, add(
          scale(first, Math.cos(angle) * radius),
          scale(second, Math.sin(angle) * radius),
        ));
        if (previous) {
          addStyledSegment(vertices, viewProjection, viewport, previous, point, thickness, color, outlineExtra);
        }
        previous = point;
      }
      appendRingOrientationTicks(vertices, viewProjection, viewport, origin, first, second, radius, worldPerPixel);
    }
  }
}

function appendAxisOrientationTicks(
  vertices: number[],
  viewProjection: Float32Array,
  viewport: { width: number; height: number },
  origin: Vec3,
  axisVector: Vec3,
  side: Vec3,
  axisLength: number,
  worldPerPixel: number,
): void {
  const halfTickLength = worldPerPixel * AXIS_TICK_LENGTH * 0.5;
  for (const offset of AXIS_TICK_OFFSETS) {
    const center = add(origin, scale(axisVector, axisLength * offset));
    addThickSegment(
      vertices,
      viewProjection,
      viewport,
      add(center, scale(side, -halfTickLength)),
      add(center, scale(side, halfTickLength)),
      AXIS_TICK_THICKNESS,
      ORIENTATION_TICK_COLOR,
    );
  }
}

function appendRingOrientationTicks(
  vertices: number[],
  viewProjection: Float32Array,
  viewport: { width: number; height: number },
  origin: Vec3,
  first: Vec3,
  second: Vec3,
  radius: number,
  worldPerPixel: number,
): void {
  const halfTickLength = worldPerPixel * RING_TICK_LENGTH * 0.5;
  for (let i = 0; i < RING_TICK_COUNT; i += 1) {
    const angle = (i / RING_TICK_COUNT) * Math.PI * 2;
    const radial = normalize(add(
      scale(first, Math.cos(angle)),
      scale(second, Math.sin(angle)),
    ));
    const center = add(origin, scale(radial, radius));
    addThickSegment(
      vertices,
      viewProjection,
      viewport,
      add(center, scale(radial, -halfTickLength)),
      add(center, scale(radial, halfTickLength)),
      RING_TICK_THICKNESS,
      ORIENTATION_TICK_COLOR,
    );
  }
}

function addStyledSegment(
  vertices: number[],
  viewProjection: Float32Array,
  viewport: { width: number; height: number },
  startWorld: Vec3,
  endWorld: Vec3,
  thicknessPx: number,
  color: readonly [number, number, number, number],
  outlineExtraThickness = OUTLINE_EXTRA_THICKNESS,
): void {
  addThickSegment(
    vertices,
    viewProjection,
    viewport,
    startWorld,
    endWorld,
    thicknessPx + outlineExtraThickness,
    OUTLINE_COLOR,
  );
  addThickSegment(vertices, viewProjection, viewport, startWorld, endWorld, thicknessPx, color);
}

function getAxisDrawOrder(hoveredAxis: SceneGizmoAxis | null): readonly SceneGizmoAxis[] {
  if (!hoveredAxis) {
    return GIZMO_AXES;
  }
  return [...GIZMO_AXES.filter((axis) => axis !== hoveredAxis), hoveredAxis];
}

function resolveAxisThickness(baseThickness: number, axis: SceneGizmoAxis, hoveredAxis: SceneGizmoAxis | null): number {
  return axis === hoveredAxis ? baseThickness + HOVER_THICKNESS_BOOST : baseThickness;
}

function resolveOutlineExtra(axis: SceneGizmoAxis, hoveredAxis: SceneGizmoAxis | null): number {
  return axis === hoveredAxis ? HOVER_OUTLINE_EXTRA_THICKNESS : OUTLINE_EXTRA_THICKNESS;
}

function resolveAxisColor(
  axis: SceneGizmoAxis,
  hoveredAxis: SceneGizmoAxis | null,
): readonly [number, number, number, number] {
  const color = AXIS_COLORS[axis];
  if (axis !== hoveredAxis) {
    return color;
  }

  return [
    color[0] + (1 - color[0]) * 0.48,
    color[1] + (1 - color[1]) * 0.48,
    color[2] + (1 - color[2]) * 0.48,
    1,
  ];
}

function addThickSegment(
  vertices: number[],
  viewProjection: Float32Array,
  viewport: { width: number; height: number },
  startWorld: Vec3,
  endWorld: Vec3,
  thicknessPx: number,
  color: readonly [number, number, number, number],
): void {
  const startClip = projectWorld(viewProjection, startWorld);
  const endClip = projectWorld(viewProjection, endWorld);
  if (!startClip || !endClip || startClip[3] <= 0 || endClip[3] <= 0) {
    return;
  }

  const startNdc = toNdc(startClip);
  const endNdc = toNdc(endClip);
  const dxPx = (endNdc.x - startNdc.x) * viewport.width * 0.5;
  const dyPx = (endNdc.y - startNdc.y) * viewport.height * 0.5;
  const lengthPx = Math.hypot(dxPx, dyPx);
  if (lengthPx < 0.5) {
    return;
  }

  const normalPx = { x: -dyPx / lengthPx, y: dxPx / lengthPx };
  const halfThickness = thicknessPx * 0.5;
  const offsetNdc = {
    x: (normalPx.x * halfThickness * 2) / Math.max(1, viewport.width),
    y: (normalPx.y * halfThickness * 2) / Math.max(1, viewport.height),
  };

  const startLeft = offsetClip(startNdc, startClip[3], offsetNdc);
  const startRight = offsetClip(startNdc, startClip[3], { x: -offsetNdc.x, y: -offsetNdc.y });
  const endLeft = offsetClip(endNdc, endClip[3], offsetNdc);
  const endRight = offsetClip(endNdc, endClip[3], { x: -offsetNdc.x, y: -offsetNdc.y });

  pushVertex(vertices, startLeft, color);
  pushVertex(vertices, startRight, color);
  pushVertex(vertices, endRight, color);
  pushVertex(vertices, startLeft, color);
  pushVertex(vertices, endRight, color);
  pushVertex(vertices, endLeft, color);
}

function pushVertex(
  vertices: number[],
  position: Vec4,
  color: readonly [number, number, number, number],
): void {
  vertices.push(position[0], position[1], position[2], position[3], color[0], color[1], color[2], color[3]);
}

function offsetClip(ndc: Vec3, w: number, offset: Vec2): Vec4 {
  return [
    (ndc.x + offset.x) * w,
    (ndc.y + offset.y) * w,
    ndc.z * w,
    w,
  ];
}

function toNdc(clip: Vec4): Vec3 {
  return {
    x: clip[0] / clip[3],
    y: clip[1] / clip[3],
    z: clip[2] / clip[3],
  };
}

function projectWorld(viewProjection: Float32Array, point: Vec3): Vec4 | null {
  const projected = multiplyMat4Vec4(viewProjection, [point.x, point.y, point.z, 1]);
  if (!projected.every(Number.isFinite) || Math.abs(projected[3]) < 0.000001) {
    return null;
  }
  return projected;
}

function resolveWorldPerPixel(origin: SceneVector3, camera: SceneCamera): number {
  if (camera.projection === 'orthographic') {
    return (camera.orthographicScale ?? 2) / Math.max(1, camera.viewport.height);
  }

  const distance = Math.max(
    0.01,
    Math.hypot(
      origin.x - camera.cameraPosition.x,
      origin.y - camera.cameraPosition.y,
      origin.z - camera.cameraPosition.z,
    ),
  );
  const fovRadians = (camera.fov * Math.PI) / 180;
  return (2 * distance * Math.tan(fovRadians * 0.5)) / Math.max(1, camera.viewport.height);
}

function resolveAxisBasis(worldMatrix: Float32Array): Record<SceneGizmoAxis, Vec3> {
  return {
    x: normalize({ x: worldMatrix[0] ?? 1, y: worldMatrix[1] ?? 0, z: worldMatrix[2] ?? 0 }),
    y: normalize({ x: worldMatrix[4] ?? 0, y: worldMatrix[5] ?? 1, z: worldMatrix[6] ?? 0 }),
    z: normalize({ x: worldMatrix[8] ?? 0, y: worldMatrix[9] ?? 0, z: worldMatrix[10] ?? 1 }),
  };
}

function resolveArrowSide(axis: Vec3, cameraForward: Vec3): Vec3 {
  const side = normalize(cross(axis, cameraForward));
  if (lengthOf(side) < 0.001) {
    return normalize(cross(axis, { x: 0, y: 1, z: 0 }));
  }
  return side;
}

function multiplyMat4(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function multiplyMat4Vec4(matrix: Float32Array, vector: Vec4): Vec4 {
  const [x, y, z, w] = vector;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(vector: Vec3, scalar: number): Vec3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function lengthOf(vector: Vec3): number {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalize(vector: Vec3): Vec3 {
  const length = lengthOf(vector);
  if (length < 0.000001) {
    return { x: 0, y: 0, z: 0 };
  }
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}
