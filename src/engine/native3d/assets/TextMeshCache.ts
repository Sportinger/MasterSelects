import type { Text3DProperties } from '../../../types';
import {
  buildTextGeometry,
  createFallbackGeometry,
} from './textMeshCache/geometryAssembly';
import type { TextMeshGeometryData } from './textMeshCache/types';

export type { TextMeshGeometryData } from './textMeshCache/types';

export class TextMeshCache {
  private keys = new Set<string>();
  private geometries = new Map<string, TextMeshGeometryData>();

  getKey(props: Text3DProperties | undefined): string {
    if (!props) {
      return 'text3d:missing';
    }

    return JSON.stringify({
      text: props.text,
      fontFamily: props.fontFamily,
      fontWeight: props.fontWeight,
      size: props.size,
      depth: props.depth,
      letterSpacing: props.letterSpacing,
      lineHeight: props.lineHeight,
      textAlign: props.textAlign,
      curveSegments: props.curveSegments,
      bevelEnabled: props.bevelEnabled,
      bevelThickness: props.bevelThickness,
      bevelSize: props.bevelSize,
      bevelSegments: props.bevelSegments,
    });
  }

  touch(key: string): void {
    if (!key) {
      return;
    }
    this.keys.add(key);
  }

  has(key: string): boolean {
    return this.keys.has(key) || this.geometries.has(key);
  }

  getOrCreate(props: Text3DProperties | undefined): TextMeshGeometryData {
    const key = this.getKey(props);
    this.touch(key);
    const cached = this.geometries.get(key);
    if (cached) {
      return cached;
    }

    const geometry = props ? buildTextGeometry(props) : createFallbackGeometry();
    this.geometries.set(key, geometry);
    return geometry;
  }

  clear(): void {
    this.keys.clear();
    this.geometries.clear();
  }
}
