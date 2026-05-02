import { describe, expect, it } from 'vitest';
import { TextMeshCache } from '../../src/engine/native3d/assets/TextMeshCache';
import type { Text3DProperties } from '../../src/types';

const defaultText3DProps: Text3DProperties = {
  text: '3D Text',
  fontFamily: 'helvetiker',
  fontWeight: 'bold',
  size: 0.42,
  depth: 0.14,
  color: '#ffffff',
  letterSpacing: 0.02,
  lineHeight: 1.15,
  textAlign: 'center',
  curveSegments: 10,
  bevelEnabled: false,
  bevelThickness: 0.02,
  bevelSize: 0.01,
  bevelSegments: 4,
};

describe('TextMeshCache', () => {
  it('emits vertices in the native mesh pipeline layout', () => {
    const geometry = new TextMeshCache().getOrCreate(defaultText3DProps);
    const vertexCount = geometry.vertices.length / 8;

    expect(geometry.vertices.length % 8).toBe(0);
    expect(vertexCount).toBeGreaterThan(0);
    expect(geometry.indices.length % 3).toBe(0);
    expect(Math.max(...geometry.indices)).toBeLessThan(vertexCount);
  });

  it('uses the same vertex stride for fallback geometry', () => {
    const geometry = new TextMeshCache().getOrCreate(undefined);
    const vertexCount = geometry.vertices.length / 8;

    expect(geometry.vertices.length % 8).toBe(0);
    expect(vertexCount).toBeGreaterThan(0);
    expect(Math.max(...geometry.indices)).toBeLessThan(vertexCount);
  });
});
