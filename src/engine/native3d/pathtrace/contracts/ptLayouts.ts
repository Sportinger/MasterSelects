/**
 * Byte layouts of every path tracing record that crosses the CPU/GPU boundary or is shared between
 * passes. `PtCommon.wgsl` declares the same structs; `ptLayouts.test.ts` derives their offsets with
 * the WGSL layout rules and compares them with these tables, so the two can never drift apart.
 *
 * Buffer conventions (bind groups are fixed for every path tracing pipeline, see ptBindings.ts):
 * - group 0 Frame: `PtFrame` uniform, blue noise texture.
 * - group 1 Scene/BVH: BVH node pages, fiber segment pages and the object pool. The object pool is
 *   an `array<vec4f>` holding instances (8 vec4), mesh vertices (2), triangles (1, as u32) and
 *   shapes (4: quad, sphere, box); records are addressed in vec4 units.
 * - group 2 Lights/Materials: `PtLight` and `PtMaterial` uniform arrays, environment map, its alias
 *   table and the texture atlas.
 * - group 3 Outputs: pass specific (accumulation, G-buffer, reservoirs, radiance cache, AOVs).
 * Nodes and fiber segments may span two buffers ("pages") when a scene exceeds the device's
 * storage binding size; `PtFrame.limits.zw` holds the first index of page 1.
 */

export type PtFieldType = 'f32' | 'u32' | 'i32' | 'vec2f' | 'vec3f' | 'vec4f' | 'vec2u' | 'vec4u' | 'mat4x4f';
export interface PtField { name: string; type: PtFieldType; offset: number }
export interface PtStructLayout { name: string; size: number; fields: readonly PtField[] }

/** Size and alignment of WGSL host-shareable types (WGSL spec, "Alignment and Size"). */
export const PT_WGSL_TYPE_INFO: Record<PtFieldType, { size: number; align: number }> = {
  f32: { size: 4, align: 4 }, u32: { size: 4, align: 4 }, i32: { size: 4, align: 4 },
  vec2f: { size: 8, align: 8 }, vec2u: { size: 8, align: 8 },
  vec3f: { size: 12, align: 16 }, vec4f: { size: 16, align: 16 }, vec4u: { size: 16, align: 16 },
  mat4x4f: { size: 64, align: 16 },
};

/** Builds a layout from ordered fields with the WGSL alignment rules (the struct rounds to its largest alignment). */
export function ptStruct(name: string, fields: ReadonlyArray<[string, PtFieldType]>): PtStructLayout {
  let offset = 0, align = 4;
  const placed = fields.map(([fieldName, type]) => {
    const info = PT_WGSL_TYPE_INFO[type];
    offset = Math.ceil(offset / info.align) * info.align;
    const field = { name: fieldName, type, offset };
    offset += info.size;
    align = Math.max(align, info.align);
    return field;
  });
  return { name, size: Math.ceil(offset / align) * align, fields: placed };
}

export const ptOffset = (layout: PtStructLayout, field: string): number => {
  const found = layout.fields.find(item => item.name === field);
  if (!found) throw new Error(`${layout.name} has no field ${field}`);
  return found.offset;
};

/**
 * One linear piece of a fiber: a round cone between two spheres (center, radius), in scene space.
 * `material`: bits 0-15 material index, bits 16-23 `PT_FIBER_FLAG_*`. `attr0/1`: unorm4x8 color
 * (absolute when the material has a color field, white otherwise) and roughness scale / 2 at both
 * ends; `melanin`: unorm2x16 melanin / PT_MELANIN_RANGE at both ends.
 */
export const PT_FIBER_SEGMENT = ptStruct('PtFiberSegment', [
  ['a', 'vec4f'], ['b', 'vec4f'], ['material', 'u32'], ['attr0', 'u32'], ['attr1', 'u32'], ['melanin', 'u32'],
]);
export const PT_FIBER_FLAG_FLYAWAY = 1 << 16;
/** The segment was dropped by the preview level of detail; its bounds are empty. */
export const PT_FIBER_FLAG_HIDDEN = 1 << 17;
export const PT_MELANIN_RANGE = 8;
export const PT_ROUGHNESS_SCALE_RANGE = 2;

/** BVH node: leaves store `PT_LEAF_BIT | primitive` in `left` and the primitive count in `right`. */
export const PT_BVH_NODE = ptStruct('PtBvhNode', [
  ['boundsMin', 'vec3f'], ['left', 'u32'], ['boundsMax', 'vec3f'], ['right', 'u32'],
]);
export const PT_LEAF_BIT = 0x80000000;

/**
 * Traversal node in the node pages: the boxes of both children in the parent, so one load visits a
 * node. A child reference is a local internal node index, `PT_LEAF_BIT | primitive`, or
 * `PT_WIDE_EMPTY` (the missing second child of a single-primitive BLAS). Packed from the LBVH's
 * Karras nodes (internal nodes keep their indices; leaves are referenced directly).
 */
export const PT_WIDE_NODE = ptStruct('PtWideNode', [
  ['leftMin', 'vec3f'], ['leftRef', 'u32'], ['leftMax', 'vec3f'], ['rightRef', 'u32'],
  ['rightMin', 'vec3f'], ['pad0', 'u32'], ['rightMax', 'vec3f'], ['pad1', 'u32'],
]);
export const PT_WIDE_EMPTY = 0xffffffff;
/** Traversal nodes of a BLAS over `count` primitives. */
export const ptWideNodeCount = (count: number) => Math.max(1, count - 1);

/** Primitive kinds of a BLAS; every instance holds one kind. */
export const PT_PRIMITIVE = { fiber: 0, triangle: 1, quad: 2, sphere: 3, box: 4 } as const;
export type PtPrimitiveKind = typeof PT_PRIMITIVE[keyof typeof PT_PRIMITIVE];

/**
 * TLAS leaf: world/object transforms as 3x4 rows, the BLAS (`nodeOffset` = root node index in the
 * node pages), its primitives (`primOffset`: fiber index, or vec4 index in the object pool) and
 * `materialBase` added to primitive material ids. `info.x` flags, `.y` primitive count, `.z` layer
 * index, `.w` stable object id (temporal reuse, material keys).
 */
export const PT_INSTANCE = ptStruct('PtInstance', [
  ['worldToObject0', 'vec4f'], ['worldToObject1', 'vec4f'], ['worldToObject2', 'vec4f'],
  ['objectToWorld0', 'vec4f'], ['objectToWorld1', 'vec4f'], ['objectToWorld2', 'vec4f'],
  ['refs', 'vec4u'], ['info', 'vec4u'],
]);
export const PT_INSTANCE_VEC4 = PT_INSTANCE.size / 16;
export const PT_INSTANCE_FLAG_CASTS_SHADOW = 1;
export const PT_INSTANCE_FLAG_VISIBLE_TO_CAMERA = 2;
export const PT_INSTANCE_FLAG_ALPHA = 4;
export const PT_INSTANCE_FLAG_DOUBLE_SIDED = 8;

/** Mesh vertex in object space; `position.w` and `normal.w` hold the texture coordinate. */
export const PT_MESH_VERTEX = ptStruct('PtMeshVertex', [['position', 'vec4f'], ['normal', 'vec4f']]);
/** Triangle: absolute vertex record indices (vec4 index / 2) and the material index. */
export const PT_TRIANGLE = ptStruct('PtTriangle', [['indices', 'vec4u']]);

/**
 * Analytic shape, 4 vec4 in the object pool:
 * - quad: p0 origin (xyz, material as bits), p1 edge U, p2 edge V, p3 atlas rect (u0, v0, u1, v1);
 * - sphere: p0 center + radius, p1.x material bits, p1.y unorm4x8 color;
 * - box: p0 min (xyz, material bits), p1 max (xyz, unorm4x8 color bits).
 */
export const PT_SHAPE = ptStruct('PtShape', [['p0', 'vec4f'], ['p1', 'vec4f'], ['p2', 'vec4f'], ['p3', 'vec4f']]);

/**
 * Light: `positionKind.w` is `PT_LIGHT` kind; `radiance.w` sphere radius, rect area or environment
 * map flag; `axisU`/`axisV` rect half extents (U, V) or the distant light direction (toward the
 * light) with its cone cosine; `axisU.w` casts shadows; `axisV.w` inclusive selection CDF.
 */
export const PT_LIGHT = ptStruct('PtLight', [['positionKind', 'vec4f'], ['radiance', 'vec4f'], ['axisU', 'vec4f'], ['axisV', 'vec4f']]);
export const PT_LIGHT_KIND = { sphere: 1, rect: 2, environment: 3, distant: 4 } as const;
export const PT_MAX_LIGHTS = 256;

/**
 * Material union, `header.x` kind (`PT_MATERIAL_KIND`), `.y` flags, `.z` atlas layer (-1 none),
 * `.w` opacity. Fiber: c0 color + beta_m, c1 beta_n, alpha (radians), IOR, absorption mode
 * (0 color, 1 melanin), c2 coat tint + melanin, c3 melanin redness, matte, fuzz. Surface: c0 base
 * color + roughness, c1 metallic, unlit, c2 emission (premultiplied by strength) + emission from
 * texture, c3 atlas rect.
 */
export const PT_MATERIAL = ptStruct('PtMaterial', [['header', 'vec4f'], ['c0', 'vec4f'], ['c1', 'vec4f'], ['c2', 'vec4f'], ['c3', 'vec4f']]);
export const PT_MATERIAL_KIND = { fiber: 1, surface: 2 } as const;
export const PT_MATERIAL_FLAG = { colorField: 1, melaninField: 2, roughnessField: 4, flyawayFuzz: 8, primitiveColor: 16 } as const;
export const PT_MAX_MATERIALS = 512;

/** Frame uniforms; see `writePtFrame` in runtime/ptFrameUniforms.ts for the meaning of each lane. */
export const PT_FRAME = ptStruct('PtFrame', [
  ['viewProjection', 'mat4x4f'], ['inverseViewProjection', 'mat4x4f'], ['previousViewProjection', 'mat4x4f'],
  ['cameraPosition', 'vec4f'], ['cameraRight', 'vec4f'], ['cameraUp', 'vec4f'], ['cameraForward', 'vec4f'],
  ['lens', 'vec4f'], ['size', 'vec4f'], ['jitterTime', 'vec4f'], ['counters', 'vec4u'], ['limits', 'vec4u'],
  ['scene', 'vec4u'], ['environment', 'vec4f'], ['region', 'vec4f'], ['previousCamera', 'vec4f'], ['sampling', 'vec4f'],
]);

/**
 * G-buffer texel (primary hits): linear view depth (0 = miss), oct-encoded shading normal and fiber
 * tangent (0 when not a fiber), unorm4x8 albedo + coverage, stable material key, motion vector
 * (half2, render pixels toward the previous frame), unorm2x16 roughness + metallic, flags.
 */
export const PT_GBUFFER = ptStruct('PtGBufferTexel', [
  ['depth', 'f32'], ['normal', 'u32'], ['tangent', 'u32'], ['albedo', 'u32'],
  ['materialKey', 'u32'], ['motion', 'u32'], ['surface', 'u32'], ['flags', 'u32'],
]);
export const PT_GBUFFER_FLAG = { hit: 1, fiber: 2, emissive: 4, alpha: 8 } as const;

/** Closest hit as recorded by wavefront passes. */
export const PT_HIT_RECORD = ptStruct('PtHitRecord', [
  ['t', 'f32'], ['instance', 'u32'], ['primitive', 'u32'], ['kind', 'u32'], ['uv', 'vec2f'], ['pad', 'vec2f'],
]);

/** ReSTIR DI reservoir: light sample (point on the light or direction, W) and (wSum, M, light, target pdf). */
export const PT_RESERVOIR = ptStruct('PtReservoir', [['sample', 'vec4f'], ['state', 'vec4f']]);

/** SHaRC entry: key checksum, last frame touched, fixed point radiance accumulators, resolved radiance (half). */
export const PT_CACHE_ENTRY = ptStruct('PtCacheEntry', [
  ['checksum', 'u32'], ['frame', 'u32'], ['red', 'u32'], ['green', 'u32'], ['blue', 'u32'], ['count', 'u32'],
  ['resolvedRG', 'u32'], ['resolvedBA', 'u32'],
]);
/** Fixed point scale of the cache accumulators. */
export const PT_CACHE_RADIANCE_SCALE = 1024;

export const PT_LAYOUTS: readonly PtStructLayout[] = [
  PT_FIBER_SEGMENT, PT_BVH_NODE, PT_WIDE_NODE, PT_INSTANCE, PT_MESH_VERTEX, PT_TRIANGLE, PT_SHAPE, PT_LIGHT, PT_MATERIAL,
  PT_FRAME, PT_GBUFFER, PT_HIT_RECORD, PT_RESERVOIR, PT_CACHE_ENTRY,
];

/** WGSL `pack4x8unorm`. */
export function packUnorm4x8(x: number, y: number, z: number, w: number): number {
  const q = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255);
  return (q(x) | (q(y) << 8) | (q(z) << 16) | (q(w) << 24)) >>> 0;
}

/** WGSL `pack2x16unorm`. */
export function packUnorm2x16(x: number, y: number): number {
  const q = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 65535);
  return (q(x) | (q(y) << 16)) >>> 0;
}

const floatView = new Float32Array(1), intView = new Uint32Array(floatView.buffer);
/** The bits of a float32, for u32 lanes stored in float arrays (`bitcast<u32>` in WGSL). */
export function floatBits(value: number): number { floatView[0] = value; return intView[0]; }
export function bitsFloat(bits: number): number { intView[0] = bits >>> 0; return floatView[0]; }
