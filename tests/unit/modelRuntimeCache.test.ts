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

function makeTriangleGltf(positions: Float32Array) {
  const buffer = positions.buffer.slice(
    positions.byteOffset,
    positions.byteOffset + positions.byteLength,
  );

  return {
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
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0 },
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
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
       0.5, -0.5, 0, 0, 0, 1, 0, 0,
      -0.5,  0.5, 0, 0, 0, 1, 0, 0,
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
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
       0.5, -0.5, 0, 0, 0, 1, 0, 0,
      -0.5,  0.5, 0, 0, 0, 1, 0, 0,
    ]));
  });

  it('preloads glTF base color textures and TEXCOORD_0 data', async () => {
    const cache = new ModelRuntimeCache();
    const positions = new Float32Array([
      0, 0, 0,
      2, 0, 0,
      0, 2, 0,
    ]);
    const texcoords = new Float32Array([
      0, 0,
      1, 0,
      0, 1,
    ]);
    const positionBuffer = positions.buffer.slice(
      positions.byteOffset,
      positions.byteOffset + positions.byteLength,
    );
    const texcoordBuffer = texcoords.buffer.slice(
      texcoords.byteOffset,
      texcoords.byteOffset + texcoords.byteLength,
    );
    const imageBitmap = {
      width: 2,
      height: 2,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    const createImageBitmapMock = vi.fn(async () => imageBitmap);
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);

    const gltf = {
      asset: { version: '2.0' },
      buffers: [
        {
          byteLength: positionBuffer.byteLength,
          uri: toDataUri(positionBuffer),
        },
        {
          byteLength: texcoordBuffer.byteLength,
          uri: toDataUri(texcoordBuffer),
        },
      ],
      bufferViews: [
        {
          buffer: 0,
          byteOffset: 0,
          byteLength: positionBuffer.byteLength,
        },
        {
          buffer: 1,
          byteOffset: 0,
          byteLength: texcoordBuffer.byteLength,
        },
      ],
      accessors: [
        {
          bufferView: 0,
          byteOffset: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
        },
        {
          bufferView: 1,
          byteOffset: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC2',
        },
      ],
      images: [{
        uri: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
      }],
      textures: [{
        source: 0,
      }],
      materials: [{
        pbrMetallicRoughness: {
          baseColorFactor: [0.5, 0.75, 1, 1],
          baseColorTexture: { index: 0 },
        },
      }],
      meshes: [{
        primitives: [{
          attributes: { POSITION: 0, TEXCOORD_0: 1 },
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

    const loaded = await cache.preload('https://example.com/textured.gltf', 'textured.gltf');

    expect(loaded).toBe(true);
    expect(createImageBitmapMock).toHaveBeenCalledTimes(1);
    const runtime = cache.get('https://example.com/textured.gltf');
    expect(runtime?.primitives[0]?.baseColor).toEqual([0.5, 0.75, 1, 1]);
    expect(runtime?.primitives[0]?.baseColorTexture).toMatchObject({
      image: imageBitmap,
      width: 2,
      height: 2,
      mimeType: 'image/png',
    });
    expect(runtime?.primitives[0]?.unlit).toBe(true);
    expect(runtime?.primitives[0]?.vertices).toEqual(new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
       0.5, -0.5, 0, 0, 0, 1, 1, 0,
      -0.5,  0.5, 0, 0, 0, 1, 0, 1,
    ]));
  });

  it('normalizes model sequence frames against the sequence anchor bounds', async () => {
    const cache = new ModelRuntimeCache();
    const anchorGltf = makeTriangleGltf(new Float32Array([
      10, 0, 0,
      12, 0, 0,
      10, 2, 0,
    ]));
    const secondGltf = makeTriangleGltf(new Float32Array([
      11, 0, 0,
      13, 0, 0,
      11, 2, 0,
    ]));
    const responses = new Map([
      ['https://example.com/frame000000.gltf', anchorGltf],
      ['https://example.com/frame000001.gltf', secondGltf],
    ]);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const gltf = responses.get(String(input));
      return {
        ok: !!gltf,
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(gltf ?? {})).buffer,
      };
    }) as typeof fetch);

    const loaded = await cache.preload(
      'https://example.com/frame000001.gltf',
      'frame000001.gltf',
      {
        normalizationKey: 'hero-sequence',
        anchorUrl: 'https://example.com/frame000000.gltf',
        anchorFileName: 'frame000000.gltf',
      },
    );

    expect(loaded).toBe(true);
    expect(cache.get('https://example.com/frame000000.gltf')?.primitives[0]?.vertices).toEqual(new Float32Array([
      -0.5, -0.5, 0, 0, 0, 1, 0, 0,
       0.5, -0.5, 0, 0, 0, 1, 0, 0,
      -0.5,  0.5, 0, 0, 0, 1, 0, 0,
    ]));
    expect(cache.get('https://example.com/frame000001.gltf')?.primitives[0]?.vertices).toEqual(new Float32Array([
       0.0, -0.5, 0, 0, 0, 1, 0, 0,
       1.0, -0.5, 0, 0, 0, 1, 0, 0,
       0.0,  0.5, 0, 0, 0, 1, 0, 0,
    ]));
  });
});
