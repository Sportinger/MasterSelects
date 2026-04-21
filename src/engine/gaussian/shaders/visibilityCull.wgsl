// Frustum culling compute shader for gaussian splats.
// Uses a direct clip-space bounds test against projection * view.
// This is intentionally conservative and avoids matrix convention bugs.

@group(0) @binding(0) var<storage, read> splatData: array<f32>;

struct CullUniforms {
  viewProj: mat4x4f,
  world: mat4x4f,
  splatCount: u32,
  _pad0: u32,
  _pad1: u32,
  _pad2: u32,
}

@group(1) @binding(0) var<uniform> cull: CullUniforms;

@group(2) @binding(0) var<storage, read_write> visibleIndices: array<u32>;
@group(2) @binding(1) var<storage, read_write> counter: array<atomic<u32>>;

fn extractWorldScale(world: mat4x4f) -> vec3f {
  return vec3f(
    length(world[0].xyz),
    length(world[1].xyz),
    length(world[2].xyz),
  );
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= cull.splatCount) {
    return;
  }

  let base = idx * 14u;
  let pos = vec3f(
    splatData[base + 0u],
    splatData[base + 1u],
    splatData[base + 2u],
  );
  let scale = vec3f(
    splatData[base + 3u],
    splatData[base + 4u],
    splatData[base + 5u],
  );

  // Transform center into shared-scene world space, then clip space.
  let worldPos = cull.world * vec4f(pos, 1.0);
  let clip = cull.viewProj * worldPos;
  if (clip.w <= 0.0001) {
    return;
  }

  let ndc = clip.xyz / clip.w;

  // Conservative margin derived from the world-space scale.
  let worldScale = extractWorldScale(cull.world);
  let supportScale = scale * worldScale;
  let radius = 3.0 * max(supportScale.x, max(supportScale.y, supportScale.z));
  let margin = max(0.05, radius * 0.01);

  if (ndc.x < -1.0 - margin || ndc.x > 1.0 + margin) {
    return;
  }
  if (ndc.y < -1.0 - margin || ndc.y > 1.0 + margin) {
    return;
  }
  if (ndc.z < -margin || ndc.z > 1.0 + margin) {
    return;
  }

  let slot = atomicAdd(&counter[0], 1u);
  visibleIndices[slot] = idx;
}
