export const DEFAULT_MODEL_COLOR = [0.5333, 0.5333, 0.5333, 1] as const;

export type ModelColor = readonly [number, number, number, number];

export interface ModelRuntimeTexture {
  image: ImageBitmap;
  width: number;
  height: number;
  mimeType?: string;
}

export interface ModelRuntimeBounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface ModelRuntimePreloadOptions {
  normalizationKey?: string;
  anchorUrl?: string;
  anchorFileName?: string;
}

export interface ModelRuntimePrimitive {
  vertices: Float32Array;
  indices: Uint32Array;
  baseColor: ModelColor;
  baseColorTexture?: ModelRuntimeTexture;
  unlit?: boolean;
}

export interface ModelRuntimeData {
  url: string;
  fileName?: string;
  format: 'obj' | 'gltf' | 'glb';
  primitives: ModelRuntimePrimitive[];
  sourceBounds?: ModelRuntimeBounds;
  normalizationKey?: string;
}

export interface ModelRuntimeRequest {
  url: string;
  fileName?: string;
}

export interface PendingPrimitive {
  positions: Float32Array;
  normals: Float32Array;
  texcoords?: Float32Array;
  indices: Uint32Array;
  baseColor: ModelColor;
  baseColorTexture?: ModelRuntimeTexture;
  unlit?: boolean;
}

export interface GltfBuffer {
  byteLength: number;
  uri?: string;
}

export interface GltfBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: 'SCALAR' | 'VEC2' | 'VEC3' | 'VEC4' | 'MAT4';
  normalized?: boolean;
}

export interface GltfPrimitive {
  attributes: Partial<Record<'POSITION' | 'NORMAL' | 'TEXCOORD_0', number>>;
  indices?: number;
  material?: number;
  mode?: number;
}

export interface GltfMesh {
  primitives: GltfPrimitive[];
}

export interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfScene {
  nodes?: number[];
}

export interface GltfMaterial {
  extensions?: {
    KHR_materials_unlit?: unknown;
  };
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: {
      index?: number;
    };
  };
}

export interface GltfImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

export interface GltfTexture {
  source?: number;
}

export interface GltfAsset {
  buffers?: GltfBuffer[];
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scenes?: GltfScene[];
  scene?: number;
  materials?: GltfMaterial[];
  images?: GltfImage[];
  textures?: GltfTexture[];
}
