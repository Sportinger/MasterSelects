// Fixed bind groups 0-2 of every path tracing pipeline that reads the scene (see ptBindings.ts).
// Requires PtCommon.wgsl. Pages: nodes and fiber segments live in two buffers when a scene exceeds
// the storage binding size; frame.limits.zw holds the first index of page 1.

@group(0) @binding(0) var<uniform> frame: PtFrame;
@group(0) @binding(1) var blueNoise: texture_2d<f32>;

@group(1) @binding(0) var<storage, read> nodePage0: array<PtWideNode>;
@group(1) @binding(1) var<storage, read> nodePage1: array<PtWideNode>;
@group(1) @binding(2) var<storage, read> fiberPage0: array<PtFiberSegment>;
@group(1) @binding(3) var<storage, read> fiberPage1: array<PtFiberSegment>;
@group(1) @binding(4) var<storage, read> objects: array<vec4f>;

@group(2) @binding(0) var<uniform> lights: array<PtLight, PT_MAX_LIGHTS>;
@group(2) @binding(1) var<uniform> materials: array<PtMaterial, PT_MAX_MATERIALS>;
@group(2) @binding(2) var environmentMap: texture_2d<f32>;
@group(2) @binding(3) var environmentAlias: texture_2d<f32>;
@group(2) @binding(4) var textureAtlas: texture_2d_array<f32>;
@group(2) @binding(5) var linearSampler: sampler;

fn ptNode(index: u32) -> PtWideNode {
  if (index < frame.limits.z) {
    return nodePage0[index];
  }
  return nodePage1[index - frame.limits.z];
}

fn ptFiber(index: u32) -> PtFiberSegment {
  if (index < frame.limits.w) {
    return fiberPage0[index];
  }
  return fiberPage1[index - frame.limits.w];
}

/** Instances lead the object pool, 8 vec4 each. */
fn ptInstance(index: u32) -> PtInstance {
  let b = index * 8u;
  return PtInstance(objects[b], objects[b + 1u], objects[b + 2u], objects[b + 3u], objects[b + 4u], objects[b + 5u],
    bitcast<vec4u>(objects[b + 6u]), bitcast<vec4u>(objects[b + 7u]));
}

fn ptVertex(record: u32) -> PtMeshVertex {
  return PtMeshVertex(objects[record * 2u], objects[record * 2u + 1u]);
}

fn ptTriangle(vec4Index: u32) -> PtTriangle {
  return PtTriangle(bitcast<vec4u>(objects[vec4Index]));
}

fn ptShape(vec4Index: u32) -> PtShape {
  return PtShape(objects[vec4Index], objects[vec4Index + 1u], objects[vec4Index + 2u], objects[vec4Index + 3u]);
}

fn ptBlueNoise(pixel: vec2u, frameIndex: u32) -> vec4f {
  let size = textureDimensions(blueNoise);
  // Cranley-Patterson rotation by the golden ratio decorrelates successive frames.
  let shifted = (pixel + vec2u(frameIndex * 13u, frameIndex * 41u)) % size;
  return fract(textureLoad(blueNoise, shifted, 0) + f32(frameIndex) * 0.61803398875);
}
