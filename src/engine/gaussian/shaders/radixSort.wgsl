// GPU bitonic sort for gaussian splat depth ordering.
// Two kernels:
//   1. computeDepthKeys — transform splat positions to view-space depth, encode as u32
//   2. bitonicStep      — one step of bitonic merge sort on the keys + indices
//
// Bitonic sort is chosen over radix sort for simplicity:
//   - Single kernel for the sort steps (dispatched multiple times)
//   - Works well for up to ~1M elements on modern GPUs
//   - Sorts back-to-front for correct alpha compositing

// ── Shared types ──────────────────────────────────────────────────────────────

struct SortUniforms {
  viewMatrix: mat4x4f,
  worldMatrix: mat4x4f,
  visibleCount: u32,
  sortCount: u32,
  // Bitonic step params
  blockSize: u32,    // k in bitonic sort (doubles each outer step)
  subBlockSize: u32, // j in bitonic sort (halves each inner step)
}

// ── Kernel 1: Compute depth keys ─────────────────────────────────────────────

// Group 0: splat data (read-only)
@group(0) @binding(0) var<storage, read> splatData: array<f32>;

// Group 1: uniforms
@group(1) @binding(0) var<uniform> params: SortUniforms;

// Group 2: sort buffers (keys + indices)
@group(2) @binding(0) var<storage, read_write> keys: array<u32>;
@group(2) @binding(1) var<storage, read_write> indices: array<u32>;

// Float-to-sortable-u32 encoding.
// IEEE 754 floats can be compared as u32 after flipping:
//   - If sign bit is set (negative): flip all bits
//   - If sign bit is clear (positive): flip only sign bit
// This gives a monotonically increasing u32 for increasing float values.
// We then invert for back-to-front (far = small key, near = large key).
fn floatToSortKey(f: f32) -> u32 {
  let bits = bitcast<u32>(f);
  // Flip for signed comparison
  let mask = select(0x80000000u, 0xFFFFFFFFu, (bits & 0x80000000u) != 0u);
  let sortable = bits ^ mask;
  // Invert for back-to-front ordering (largest depth = smallest key = drawn first)
  return 0xFFFFFFFFu - sortable;
}

@compute @workgroup_size(256)
fn computeDepthKeys(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= params.sortCount) {
    return;
  }

  if (idx >= params.visibleCount) {
    // Pad the tail so non-power-of-two scenes still sort correctly.
    keys[idx] = 0xFFFFFFFFu;
    indices[idx] = 0u;
    return;
  }

  // Read the original splat index from the index buffer
  let splatIdx = indices[idx];
  let base = splatIdx * 14u;

  // Read splat position
  let pos = vec3f(splatData[base + 0u], splatData[base + 1u], splatData[base + 2u]);

  // Transform to shared-scene world space first, then into view space.
  let worldPos = params.worldMatrix * vec4f(pos, 1.0);
  let viewPos = params.viewMatrix * worldPos;
  // Visible points in our right-handed view have negative z.
  // Negate it so farther splats produce larger positive depths and sort first.
  let depth = -viewPos.z;

  // Convert to sortable key (back-to-front: far splats get smaller keys)
  keys[idx] = floatToSortKey(depth);
}


// ── Kernel 2: Bitonic sort step ───────────────────────────────────────────────
// Each dispatch performs one compare-and-swap step.
// The host dispatches log2(N)*(log2(N)+1)/2 times total.

@compute @workgroup_size(256)
fn bitonicStep(@builtin(global_invocation_id) gid: vec3u) {
  let idx = gid.x;
  if (idx >= params.sortCount) {
    return;
  }

  let j = params.subBlockSize;
  let k = params.blockSize;

  // Find the partner index for this element
  let partner = idx ^ j;

  // Only process if partner > idx (avoid duplicate swaps)
  if (partner <= idx) {
    return;
  }
  if (partner >= params.sortCount) {
    return;
  }

  // Determine sort direction: ascending within the block
  // Bitonic sort alternates direction at each block level
  let ascending = ((idx & k) == 0u);

  let keyA = keys[idx];
  let keyB = keys[partner];

  // Compare and swap
  let shouldSwap = select((keyA < keyB), (keyA > keyB), ascending);

  if (shouldSwap) {
    // Swap keys
    keys[idx] = keyB;
    keys[partner] = keyA;

    // Swap indices
    let idxA = indices[idx];
    let idxB = indices[partner];
    indices[idx] = idxB;
    indices[partner] = idxA;
  }
}
