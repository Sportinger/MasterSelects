import { lookAt, perspective } from '../../src/engine/scene/cameraUtils/projectionMatrices';
import { createDefaultWeaveGraph, geometryParameterReader } from '../../src/services/operators/geometry/weaveGraph';
import { buildStrandsLayerSources } from '../../src/services/operators/geometry/strandsLayerSource';
import { compileGeometryGraph, type GeometryProgram } from '../../src/services/operators/geometry/geometryProgram';
import { DEFAULT_LIGHT_CLIP_SETTINGS, type LightClipSettings } from '../../src/types/light';
import type { SceneCamera, SceneLayer3DData, SceneLightLayer, ScenePrimitiveLayer, SceneStrandLayer } from '../../src/engine/scene/types';
import type { Effect } from '../../src/types/effects';
import type { EffectOperatorGraph, OperatorValue } from '../../src/types/operatorGraph';

/**
 * Reference scenes of the path tracing plan, shared by the check pages:
 * - Standard Weave: the default Weave graph at 6 s with the fixed key light (no light clips);
 * - Knit Form: knitted fabric lit by a panel light in front of a navy background;
 * - Reef Knot: a reef knot resting on a floor, lit by an HDRI environment.
 */
export interface ReferenceScene {
  id: 'standard-weave' | 'knit-form' | 'reef-knot';
  label: string;
  layers: SceneLayer3DData[];
  camera: SceneCamera;
  /** Straight sRGB background the transparent scene is shown over. */
  background: [number, number, number];
}

export const IDENTITY = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function referenceCamera(width: number, height: number, eye: [number, number, number], target: [number, number, number] = [0, 0, 0],
  fov = 50): SceneCamera {
  return { viewMatrix: lookAt(...eye, ...target, 0, 1, 0), projectionMatrix: perspective(fov * Math.PI / 180, width / height, 0.05, 100),
    cameraPosition: { x: eye[0], y: eye[1], z: eye[2] }, cameraTarget: { x: target[0], y: target[1], z: target[2] }, cameraUp: { x: 0, y: 1, z: 0 },
    viewport: { width, height }, projection: 'perspective', fov, near: 0.05, far: 100 };
}

const strands = (id: string, program: GeometryProgram, width: number, height: number): SceneStrandLayer => ({ kind: 'strands', layerId: id, clipId: id,
  opacity: 1, blendMode: 'normal', sourceWidth: width, sourceHeight: height, worldMatrix: IDENTITY, strands: { clipId: id, effectId: id, program } });

function light(id: string, settings: Partial<LightClipSettings>, world: Float32Array): SceneLightLayer {
  return { kind: 'light', layerId: id, clipId: id, opacity: 1, blendMode: 'normal', sourceWidth: 1, sourceHeight: 1, worldMatrix: world,
    lightSettings: { ...DEFAULT_LIGHT_CLIP_SETTINGS, ...settings } };
}

/** Column-major translation, then rotation about X (radians), then uniform scale. */
function placed(x: number, y: number, z: number, rotateX = 0, scale = 1): Float32Array {
  const c = Math.cos(rotateX), s = Math.sin(rotateX);
  return Float32Array.from([scale, 0, 0, 0, 0, c * scale, s * scale, 0, 0, -s * scale, c * scale, 0, x, y, z, 1]);
}

/** A panel at `position` whose -Z axis (its emitting side) faces `target`. */
function panelFacing(position: [number, number, number], target: [number, number, number]): Float32Array {
  const back = position.map((value, axis) => value - target[axis]);
  const length = Math.hypot(...back);
  const z = back.map(value => value / length);
  const x = [z[2], 0, -z[0]].map(value => value / (Math.hypot(z[2], z[0]) || 1));
  const y = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
  return Float32Array.from([...x, 0, ...y, 0, ...z, 0, ...position, 1]);
}

function yarnGraph(generator: string, constants: Record<string, OperatorValue>, yarn: Record<string, OperatorValue>, color: string): EffectOperatorGraph {
  return { version: 1, schemaVersion: 1, domain: 'geometry', layout: {},
    nodes: [
      { id: 'source', operator: generator, operatorVersion: 1, bindings: {}, constants },
      { id: 'yarn', operator: 'geometry.yarn-profile', operatorVersion: 1, bindings: {}, constants: yarn },
      { id: 'flyaways', operator: 'geometry.flyaways', operatorVersion: 1, bindings: {}, constants: { density: 3, length: 0.06, lift: 2, hair: 0.35, seed: 3 } },
      { id: 'render', operator: 'render.strands', operatorVersion: 1, bindings: {}, constants: { width: 0.003, color } },
      { id: 'output', operator: 'scene.output', operatorVersion: 1, bindings: {} },
    ],
    edges: [{ id: 'a', from: 'source', output: 'curves', to: 'yarn', input: 'curves' }, { id: 'b', from: 'yarn', output: 'curves', to: 'flyaways', input: 'curves' },
      { id: 'c', from: 'flyaways', output: 'curves', to: 'render', input: 'curves' }, { id: 'd', from: 'render', output: 'scene', to: 'output', input: 'scene' }] };
}

/** Radiance HDR (RGBE, flat scanlines) of a sky gradient with a warm sun; `width` x `width / 2` equirectangular. */
export function proceduralSkyHdr(width = 256): Blob {
  const height = width / 2;
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
  const pixels = new Uint8Array(width * height * 4);
  const sun = [Math.cos(0.7) * Math.cos(2.2), Math.sin(0.7), Math.cos(0.7) * Math.sin(2.2)];
  for (let row = 0; row < height; row++) {
    const theta = (row + 0.5) / height * Math.PI;
    for (let column = 0; column < width; column++) {
      const phi = (column + 0.5) / width * 2 * Math.PI;
      const dir = [Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)];
      const up = Math.max(0, dir[1]);
      const sky = dir[1] >= 0 ? [0.35 + 0.4 * (1 - up), 0.5 + 0.3 * (1 - up), 0.9] : [0.18, 0.16, 0.14];
      const cosSun = dir[0] * sun[0] + dir[1] * sun[1] + dir[2] * sun[2];
      const glow = cosSun > 0.995 ? 400 : Math.pow(Math.max(0, cosSun), 64) * 6;
      const rgb = [sky[0] + glow, sky[1] + glow * 0.85, sky[2] + glow * 0.6];
      const max = Math.max(...rgb);
      const exponent = max > 1e-32 ? Math.ceil(Math.log2(max)) : -128;
      const scale = 256 / 2 ** exponent;
      const index = (row * width + column) * 4;
      pixels.set([...rgb.map(value => Math.min(255, Math.floor(value * scale))), exponent + 128], index);
    }
  }
  return new Blob([header, pixels], { type: 'image/vnd.radiance' });
}

export function referenceScenes(width: number, height: number, hdrUrl: string): ReferenceScene[] {
  const weaveEffect: Effect = { id: 'fx-weave', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
  const weave = buildStrandsLayerSources({ id: 'ref-weave', effects: [weaveEffect], startTime: 0, inPoint: 0, outPoint: 10, duration: 10 }, 6, [])[0].source.strands.program;
  const knit = compileGeometryGraph(yarnGraph('geometry.knit', { stitches: 20, rows: 14, resolution: 24 },
    { plies: 3, fibers: 6, radius: 0.026, plyTwist: 6, fiberTwist: -12 }, '#f2efe8'), geometryParameterReader({}));
  const knot = compileGeometryGraph(yarnGraph('geometry.knot', { shape: 'reef', size: 0.8, depth: 0.12, points: 420 },
    { plies: 3, fibers: 5, radius: 0.045, plyTwist: 4, fiberTwist: -9 }, '#d9c4a0'), geometryParameterReader({}));
  const floor: ScenePrimitiveLayer = { kind: 'primitive', meshType: 'plane', layerId: 'floor', clipId: 'floor', opacity: 1, blendMode: 'normal',
    sourceWidth: width, sourceHeight: height, worldMatrix: placed(0, -0.22, 0, -Math.PI / 2, 4) };
  return [
    { id: 'standard-weave', label: 'Standard-Weave, Key-Light', background: [0.07, 0.08, 0.1],
      layers: [strands('weave', weave, width, height)], camera: referenceCamera(width, height, [0, -0.35, 1.25]) },
    { id: 'knit-form', label: 'Knit Form, Panel-Licht, Navy', background: [0.05, 0.09, 0.22],
      layers: [strands('knit', knit, width, height), light('panel', { kind: 'panel', intensity: 2.2, diameter: 1.5 }, panelFacing([1.2, 1.4, 2.2], [0, 0, 0]))],
      camera: referenceCamera(width, height, [0.25, -0.15, 2.3]) },
    { id: 'reef-knot', label: 'Kreuzknoten auf Boden, HDRI', background: [0.12, 0.12, 0.12],
      layers: [strands('knot', knot, width, height), floor,
        light('environment', { kind: 'environment', intensity: 1, environmentMapUrl: hdrUrl, environmentMapFileName: 'sky.hdr' }, IDENTITY)],
      camera: referenceCamera(width, height, [0.4, 0.9, 1.7], [0, -0.1, 0]) },
  ];
}
