import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelRuntimeCache } from '../../src/engine/native3d/assets/ModelRuntimeCache';

vi.mock('../../src/services/logger', () => ({
  Logger: {
    create: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    })),
  },
}));

function toDataUri(buffer: ArrayBuffer): string {
  const bytes = Buffer.from(new Uint8Array(buffer));
  return `data:application/octet-stream;base64,${bytes.toString('base64')}`;
}

describe('ModelRuntimeCache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('preloads OBJ runtimes with centering, normalization, and computed normals', async () => {
    const cache = new ModelRuntimeCache();
    const obj = [
      'v 0 0 0',
      'v 2 0 0',
      'v 0 2 0',
      'f 1 2 3',
    ].join('\n');

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      text: async () => obj,
    })) as typeof fetch);

    const loaded = await cache.preload('https://example.com/triangle.obj', 'triangle.obj');

    expect(loaded).toBe(true);
    const runtime = cache.get('https://example.com/triangle.obj');
    expect(runtime).toMatchObject({
      format: 'obj',
      fileName: 'triangle.obj',
    });
    expect(runtime?.primitives).toHaveLength(1);
    expect(runtime?.primitives[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(runtime?.primitives[0]?.vertices).toEqual(new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1,
       0.5, -0.5, 0, 0, 0, 1,
      -0.5,  0.5, 0, 0, 0, 1,
    ]));
  });

  it('preloads glTF runtimes with embedded buffers and preserves baseColorFactor', async () => {
    const cache = new ModelRuntimeCache();
    const positions = new Float32Array([
      0, 0, 0,
      2, 0, 0,
      0, 2, 0,
    ]);
    const buffer = positions.buffer.slice(
      positions.byteOffset,
      positions.byteOffset + positions.byteLength,
    );
    const gltf = {
      asset: { version: '2.0' },
      buffers: [{
        byteLength: buffer.byteLength,
        uri: toDataUri(buffer),
      }],
      bufferViews: [{
        buffer: 0,
        byteOffset: 0,
        byteLength: buffer.byteLength,
      }],
      accessors: [{
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: 3,
        type: 'VEC3',
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorFactor: [0.2, 0.4, 0.6, 0.8],
        },
      }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0 },
          material: 0,
        }],
      }],
      nodes: [{
        mesh: 0,
      }],
      scenes: [{
        nodes: [0],
      }],
      scene: 0,
    };

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(gltf)).buffer,
    })) as typeof fetch);

    const loaded = await cache.preload('https://example.com/triangle.gltf', 'triangle.gltf');

    expect(loaded).toBe(true);
    const runtime = cache.get('https://example.com/triangle.gltf');
    expect(runtime).toMatchObject({
      format: 'gltf',
      fileName: 'triangle.gltf',
    });
    expect(runtime?.primitives).toHaveLength(1);
    expect(runtime?.primitives[0]?.baseColor).toEqual([0.2, 0.4, 0.6, 0.8]);
    expect(runtime?.primitives[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(runtime?.primitives[0]?.vertices).toEqual(new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1,
       0.5, -0.5, 0, 0, 0, 1,
      -0.5,  0.5, 0, 0, 0, 1,
    ]));
  });
});
