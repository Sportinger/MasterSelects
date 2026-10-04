import { describe, expect, it } from 'vitest';
import commonSource from '../../src/engine/native3d/pathtrace/contracts/PtCommon.wgsl?raw';
import sceneBindings from '../../src/engine/native3d/pathtrace/contracts/PtSceneBindings.wgsl?raw';
import { PT_LAYOUTS, PT_WGSL_TYPE_INFO, ptStruct, type PtFieldType } from '../../src/engine/native3d/pathtrace/contracts/ptLayouts';
import { composePtShader, PT_LIGHTS_BYTES, PT_MATERIALS_BYTES } from '../../src/engine/native3d/pathtrace/contracts/ptBindings';

/** Struct declarations of a WGSL source: name -> ordered (field, type). */
function wgslStructs(source: string): Map<string, Array<[string, string]>> {
  const structs = new Map<string, Array<[string, string]>>();
  const stripped = source.replace(/\/\/[^\n]*/g, '');
  for (const match of stripped.matchAll(/struct\s+(\w+)\s*\{([^}]*)\}/g)) {
    const fields = match[2].split(',').map(field => field.trim()).filter(Boolean).map(field => {
      const [name, type] = field.split(':').map(part => part.trim());
      return [name, type] as [string, string];
    });
    structs.set(match[1], fields);
  }
  return structs;
}

describe('path tracing layouts', () => {
  const structs = wgslStructs(commonSource);

  it('mirrors every TS layout in PtCommon.wgsl with the same fields, types and offsets', () => {
    for (const layout of PT_LAYOUTS) {
      const fields = structs.get(layout.name);
      expect(fields, layout.name).toBeDefined();
      for (const [, type] of fields!) expect(Object.keys(PT_WGSL_TYPE_INFO), `${layout.name}: ${type}`).toContain(type);
      const derived = ptStruct(layout.name, fields!.map(([name, type]) => [name, type as PtFieldType]));
      expect(derived).toEqual(layout);
    }
  });

  it('keeps the records at the sizes the buffers and shaders assume', () => {
    const size = (name: string) => PT_LAYOUTS.find(layout => layout.name === name)!.size;
    expect(size('PtFiberSegment')).toBe(48);
    expect(size('PtBvhNode')).toBe(32);
    expect(size('PtWideNode')).toBe(64);
    expect(size('PtInstance')).toBe(128);
    expect(size('PtMeshVertex')).toBe(32);
    expect(size('PtShape')).toBe(64);
    expect(size('PtGBufferTexel')).toBe(32);
    expect(size('PtReservoir')).toBe(32);
    expect(size('PtCacheEntry')).toBe(32);
    // Both uniform arrays fit the WebGPU default uniform binding size.
    expect(PT_LIGHTS_BYTES).toBeLessThanOrEqual(65536);
    expect(PT_MATERIALS_BYTES).toBeLessThanOrEqual(65536);
  });

  it('places vec3 fields on 16-byte boundaries like WGSL', () => {
    const node = PT_LAYOUTS.find(layout => layout.name === 'PtBvhNode')!;
    expect(node.fields.map(field => field.offset)).toEqual([0, 12, 16, 28]);
  });

  it('composes modules only when every called interface is defined with its contract signature', () => {
    const tracer = 'fn pt_trace_closest(ray: PtRay) -> PtHit { var hit: PtHit; return hit; }';
    expect(() => composePtShader('ok', [commonSource, sceneBindings, tracer, 'fn main() { let h = pt_trace_closest(PtRay()); }'])).not.toThrow();
    expect(() => composePtShader('missing', [commonSource, 'fn main() { let h = pt_trace_closest(PtRay()); }'])).toThrow(/without a module/);
    expect(() => composePtShader('mismatch', [commonSource, 'fn pt_trace_closest(ray: PtRay) -> f32 { return 0.0; }'])).toThrow(/contract/);
  });
});
