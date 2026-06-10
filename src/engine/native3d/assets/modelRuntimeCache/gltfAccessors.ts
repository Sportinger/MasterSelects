import type { GltfAccessor, GltfAsset } from './types';

function getComponentSize(componentType: number): number {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      return 4;
  }
}

function getComponentCount(type: GltfAccessor['type']): number {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    case 'MAT4':
      return 16;
    default:
      return 1;
  }
}

function readComponent(
  view: DataView,
  byteOffset: number,
  componentType: number,
  normalized: boolean,
): number {
  switch (componentType) {
    case 5120: {
      const value = view.getInt8(byteOffset);
      return normalized ? Math.max(value / 127, -1) : value;
    }
    case 5121: {
      const value = view.getUint8(byteOffset);
      return normalized ? value / 255 : value;
    }
    case 5122: {
      const value = view.getInt16(byteOffset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    }
    case 5123: {
      const value = view.getUint16(byteOffset, true);
      return normalized ? value / 65535 : value;
    }
    case 5125:
      return view.getUint32(byteOffset, true);
    case 5126:
    default:
      return view.getFloat32(byteOffset, true);
  }
}

export function readAccessorFloats(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number,
): Float32Array | null {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView == null) {
    return null;
  }
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    return null;
  }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    return null;
  }

  const componentCount = getComponentCount(accessor.type);
  const componentSize = getComponentSize(accessor.componentType);
  const stride = bufferView.byteStride ?? componentCount * componentSize;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(buffer);
  const output = new Float32Array(accessor.count * componentCount);

  for (let i = 0; i < accessor.count; i += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      const byteOffset = baseOffset + i * stride + component * componentSize;
      output[i * componentCount + component] = readComponent(
        view,
        byteOffset,
        accessor.componentType,
        accessor.normalized === true,
      );
    }
  }

  return output;
}

function sequentialIndices(fallbackCount: number): Uint32Array {
  const sequential = new Uint32Array(fallbackCount);
  for (let i = 0; i < fallbackCount; i += 1) {
    sequential[i] = i;
  }
  return sequential;
}

export function readAccessorIndices(
  gltf: GltfAsset,
  buffers: ArrayBuffer[],
  accessorIndex: number | undefined,
  fallbackCount: number,
): Uint32Array {
  if (accessorIndex == null) {
    return sequentialIndices(fallbackCount);
  }

  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor || accessor.bufferView == null) {
    return sequentialIndices(fallbackCount);
  }
  const bufferView = gltf.bufferViews?.[accessor.bufferView];
  if (!bufferView) {
    return sequentialIndices(fallbackCount);
  }
  const buffer = buffers[bufferView.buffer];
  if (!buffer) {
    return sequentialIndices(fallbackCount);
  }

  const componentSize = getComponentSize(accessor.componentType);
  const stride = bufferView.byteStride ?? componentSize;
  const baseOffset = (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(buffer);
  const output = new Uint32Array(accessor.count);

  for (let i = 0; i < accessor.count; i += 1) {
    const byteOffset = baseOffset + i * stride;
    output[i] = Math.max(0, Math.trunc(readComponent(view, byteOffset, accessor.componentType, false)));
  }

  return output;
}
