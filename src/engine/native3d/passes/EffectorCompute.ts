import { resolveSceneEffectorAxis } from '../../scene/SceneEffectorUtils';
import type { SceneLayer3DData, SceneSplatEffectorRuntimeData, SceneVector3 } from '../../scene/types';
import shaderSource from '../shaders/SplatEffectorCompute.wgsl?raw';

const WORKGROUP_SIZE = 256;
const MAX_SPLAT_EFFECTORS = 8;
const EPSILON = 0.0001;
const SETTINGS_BUFFER_SIZE = MAX_SPLAT_EFFECTORS * 64 + 16;

export interface LocalSplatEffectorData {
  position: SceneVector3;
  axis: SceneVector3;
  radius: number;
  strength: number;
  falloff: number;
  speed: number;
  seed: number;
  time: number;
  mode: number;
}

export class EffectorCompute {
  private pipeline: GPUComputePipeline | null = null;
  private settingsBuffer: GPUBuffer | null = null;
  private dataBindGroupLayout: GPUBindGroupLayout | null = null;
  private settingsBindGroupLayout: GPUBindGroupLayout | null = null;
  private settingsBindGroup: GPUBindGroup | null = null;
  private _initialized = false;

  get isInitialized(): boolean {
    return this._initialized;
  }

  resolveEffectorsForLayer(
    layer: Pick<SceneLayer3DData, 'kind' | 'threeDEffectorsEnabled'>,
    effectors: SceneSplatEffectorRuntimeData[],
  ): SceneSplatEffectorRuntimeData[] {
    if (layer.kind === 'plane' || layer.threeDEffectorsEnabled === false) {
      return [];
    }
    return effectors;
  }

  prepareLocalSplatEffectors(
    worldMatrix: Float32Array,
    effectors: SceneSplatEffectorRuntimeData[],
  ): LocalSplatEffectorData[] {
    if (effectors.length === 0) {
      return [];
    }

    const inverseWorldMatrix = this.invertAffineMat4(worldMatrix);
    if (!inverseWorldMatrix) {
      return [];
    }

    const scaleNormalizer = Math.max(
      Math.hypot(worldMatrix[0] ?? 0, worldMatrix[1] ?? 0, worldMatrix[2] ?? 0),
      Math.hypot(worldMatrix[4] ?? 0, worldMatrix[5] ?? 0, worldMatrix[6] ?? 0),
      Math.hypot(worldMatrix[8] ?? 0, worldMatrix[9] ?? 0, worldMatrix[10] ?? 0),
      EPSILON,
    );

    return effectors
      .slice(0, MAX_SPLAT_EFFECTORS)
      .map((effector) => {
        const worldAxis = resolveSceneEffectorAxis(effector.rotation);
        return {
          position: this.transformPoint(inverseWorldMatrix, effector.position),
          axis: this.normalizeVec3(
            this.transformDirection(inverseWorldMatrix, worldAxis),
            { x: 0, y: 0, z: 1 },
          ),
          radius: Math.max(Math.abs(effector.radius) / scaleNormalizer, EPSILON),
          strength: (Math.max(0, effector.strength) * 0.01) / scaleNormalizer,
          falloff: Math.max(0.001, effector.falloff),
          speed: Math.max(0, effector.speed),
          seed: effector.seed,
          time: effector.time,
          mode: this.getEffectorModeId(effector.mode),
        };
      });
  }

  initialize(device: GPUDevice): void {
    if (this._initialized) {
      return;
    }

    const shaderModule = device.createShaderModule({
      code: shaderSource,
      label: 'native-splat-effector-compute-shader',
    });

    this.dataBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
      ],
      label: 'native-splat-effector-data-bind-group-layout',
    });

    this.settingsBindGroupLayout = device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'uniform' },
        },
      ],
      label: 'native-splat-effector-settings-bind-group-layout',
    });

    const pipelineLayout = device.createPipelineLayout({
      bindGroupLayouts: [this.dataBindGroupLayout, this.settingsBindGroupLayout],
      label: 'native-splat-effector-compute-pipeline-layout',
    });

    this.pipeline = device.createComputePipeline({
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
      label: 'native-splat-effector-compute-pipeline',
    });

    this.settingsBuffer = device.createBuffer({
      size: SETTINGS_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      label: 'native-splat-effector-settings-uniform',
    });

    this.settingsBindGroup = device.createBindGroup({
      layout: this.settingsBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.settingsBuffer } }],
      label: 'native-splat-effector-settings-bind-group',
    });

    this._initialized = true;
  }

  execute(
    device: GPUDevice,
    commandEncoder: GPUCommandEncoder,
    sourceBuffer: GPUBuffer,
    outputBuffer: GPUBuffer,
    splatCount: number,
    effectors: LocalSplatEffectorData[],
  ): void {
    if (
      !this._initialized ||
      !this.pipeline ||
      !this.settingsBuffer ||
      !this.dataBindGroupLayout ||
      !this.settingsBindGroup ||
      splatCount <= 0 ||
      effectors.length === 0
    ) {
      return;
    }

    const data = new ArrayBuffer(SETTINGS_BUFFER_SIZE);
    const f32 = new Float32Array(data);
    const u32 = new Uint32Array(data);
    for (let i = 0; i < effectors.length && i < MAX_SPLAT_EFFECTORS; i += 1) {
      const effector = effectors[i];
      const offset = i * 16;
      f32[offset + 0] = effector.position.x;
      f32[offset + 1] = effector.position.y;
      f32[offset + 2] = effector.position.z;
      f32[offset + 3] = effector.radius;
      f32[offset + 4] = effector.axis.x;
      f32[offset + 5] = effector.axis.y;
      f32[offset + 6] = effector.axis.z;
      f32[offset + 7] = effector.strength;
      f32[offset + 8] = effector.falloff;
      f32[offset + 9] = effector.speed;
      f32[offset + 10] = effector.seed;
      f32[offset + 11] = effector.mode;
      f32[offset + 12] = effector.time;
    }
    u32[MAX_SPLAT_EFFECTORS * 16] = Math.min(effectors.length, MAX_SPLAT_EFFECTORS);
    u32[MAX_SPLAT_EFFECTORS * 16 + 1] = splatCount;
    device.queue.writeBuffer(this.settingsBuffer, 0, data);

    const dataBindGroup = device.createBindGroup({
      layout: this.dataBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: sourceBuffer } },
        { binding: 1, resource: { buffer: outputBuffer } },
      ],
      label: 'native-splat-effector-data-bind-group',
    });

    const workgroups = Math.ceil(splatCount / WORKGROUP_SIZE);
    const pass = commandEncoder.beginComputePass({ label: 'native-splat-effector-compute-pass' });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, dataBindGroup);
    pass.setBindGroup(1, this.settingsBindGroup);
    pass.dispatchWorkgroups(workgroups);
    pass.end();
  }

  dispose(): void {
    this.settingsBuffer?.destroy();
    this.settingsBuffer = null;
    this.pipeline = null;
    this.dataBindGroupLayout = null;
    this.settingsBindGroupLayout = null;
    this.settingsBindGroup = null;
    this._initialized = false;
  }

  private getEffectorModeId(mode: SceneSplatEffectorRuntimeData['mode']): number {
    switch (mode) {
      case 'attract':
        return 1;
      case 'swirl':
        return 2;
      case 'noise':
        return 3;
      case 'repel':
      default:
        return 0;
    }
  }

  private transformPoint(matrix: Float32Array, point: SceneVector3): SceneVector3 {
    return {
      x: (matrix[0] ?? 0) * point.x + (matrix[4] ?? 0) * point.y + (matrix[8] ?? 0) * point.z + (matrix[12] ?? 0),
      y: (matrix[1] ?? 0) * point.x + (matrix[5] ?? 0) * point.y + (matrix[9] ?? 0) * point.z + (matrix[13] ?? 0),
      z: (matrix[2] ?? 0) * point.x + (matrix[6] ?? 0) * point.y + (matrix[10] ?? 0) * point.z + (matrix[14] ?? 0),
    };
  }

  private transformDirection(matrix: Float32Array, direction: SceneVector3): SceneVector3 {
    return {
      x: (matrix[0] ?? 0) * direction.x + (matrix[4] ?? 0) * direction.y + (matrix[8] ?? 0) * direction.z,
      y: (matrix[1] ?? 0) * direction.x + (matrix[5] ?? 0) * direction.y + (matrix[9] ?? 0) * direction.z,
      z: (matrix[2] ?? 0) * direction.x + (matrix[6] ?? 0) * direction.y + (matrix[10] ?? 0) * direction.z,
    };
  }

  private normalizeVec3(value: SceneVector3, fallback: SceneVector3): SceneVector3 {
    const length = Math.hypot(value.x, value.y, value.z);
    if (length < EPSILON) {
      return { ...fallback };
    }
    return {
      x: value.x / length,
      y: value.y / length,
      z: value.z / length,
    };
  }

  private invertAffineMat4(matrix: Float32Array): Float32Array | null {
    const a00 = matrix[0] ?? 0;
    const a01 = matrix[4] ?? 0;
    const a02 = matrix[8] ?? 0;
    const a10 = matrix[1] ?? 0;
    const a11 = matrix[5] ?? 0;
    const a12 = matrix[9] ?? 0;
    const a20 = matrix[2] ?? 0;
    const a21 = matrix[6] ?? 0;
    const a22 = matrix[10] ?? 0;

    const b01 = a22 * a11 - a12 * a21;
    const b11 = -a22 * a10 + a12 * a20;
    const b21 = a21 * a10 - a11 * a20;
    const determinant = a00 * b01 + a01 * b11 + a02 * b21;
    if (Math.abs(determinant) < EPSILON) {
      return null;
    }

    const inverseDeterminant = 1 / determinant;
    const inv00 = b01 * inverseDeterminant;
    const inv01 = (-a22 * a01 + a02 * a21) * inverseDeterminant;
    const inv02 = (a12 * a01 - a02 * a11) * inverseDeterminant;
    const inv10 = b11 * inverseDeterminant;
    const inv11 = (a22 * a00 - a02 * a20) * inverseDeterminant;
    const inv12 = (-a12 * a00 + a02 * a10) * inverseDeterminant;
    const inv20 = b21 * inverseDeterminant;
    const inv21 = (-a21 * a00 + a01 * a20) * inverseDeterminant;
    const inv22 = (a11 * a00 - a01 * a10) * inverseDeterminant;
    const tx = matrix[12] ?? 0;
    const ty = matrix[13] ?? 0;
    const tz = matrix[14] ?? 0;

    const result = new Float32Array(16);
    result[0] = inv00;
    result[1] = inv10;
    result[2] = inv20;
    result[3] = 0;
    result[4] = inv01;
    result[5] = inv11;
    result[6] = inv21;
    result[7] = 0;
    result[8] = inv02;
    result[9] = inv12;
    result[10] = inv22;
    result[11] = 0;
    result[12] = -(inv00 * tx + inv01 * ty + inv02 * tz);
    result[13] = -(inv10 * tx + inv11 * ty + inv12 * tz);
    result[14] = -(inv20 * tx + inv21 * ty + inv22 * tz);
    result[15] = 1;
    return result;
  }
}
