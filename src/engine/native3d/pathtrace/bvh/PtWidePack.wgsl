// Packs a BLAS's Karras nodes (PtLbvh.wgsl: internal nodes 0 .. N-2, leaf j at N-1+j) into
// traversal nodes in a node page: one per internal node with both children's boxes; leaf children
// are referenced as PT_LEAF_BIT | primitive. A single-primitive BLAS gets one node whose right
// child is empty. Requires PtCommon.wgsl.

struct WidePackParams {
  count: u32,          // primitives of the BLAS
  offset: u32,         // first traversal node inside the page
  dispatchWidth: u32,
  pad: u32,
};

@group(0) @binding(0) var<uniform> packParams: WidePackParams;
@group(0) @binding(1) var<storage, read> karras: array<PtBvhNode>;
@group(0) @binding(2) var<storage, read_write> page: array<PtWideNode>;

/** A child of an internal node: a leaf becomes a direct primitive reference. */
fn packRef(index: u32) -> u32 {
  let node = karras[index];
  return select(index, node.left, (node.left & PT_LEAF_BIT) != 0u);
}

@compute @workgroup_size(256)
fn packWide(@builtin(global_invocation_id) id: vec3u) {
  let i = id.y * packParams.dispatchWidth + id.x;
  let internal = max(packParams.count, 1u) - 1u;
  if (i >= max(internal, 1u)) {
    return;
  }
  var out: PtWideNode;
  if (internal == 0u) {
    let leaf = karras[0];
    out.leftMin = leaf.boundsMin;
    out.leftMax = leaf.boundsMax;
    out.leftRef = leaf.left;
    out.rightMin = vec3f(PT_INFINITY);
    out.rightMax = vec3f(-PT_INFINITY);
    out.rightRef = PT_WIDE_EMPTY;
  } else {
    let node = karras[i];
    let a = karras[node.left];
    let b = karras[node.right];
    out.leftMin = a.boundsMin;
    out.leftMax = a.boundsMax;
    out.leftRef = packRef(node.left);
    out.rightMin = b.boundsMin;
    out.rightMax = b.boundsMax;
    out.rightRef = packRef(node.right);
  }
  out.pad0 = 0u;
  out.pad1 = 0u;
  page[packParams.offset + i] = out;
}
