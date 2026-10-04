// Voxel relief blocks for the path tracer (plan 3.7): each block placed by voxelBlock
// (VoxelInstance.wgsl, the raster's placement) becomes a box, or a sphere for sphere-shaped
// blocks, in the object pool, in the layer's local space (the instance carries the layer's world
// matrix). Records follow PtShape: box p0 (min, relative material) p1 (max, unorm4x8 color);
// sphere p0 (center, radius) p1.x relative material, p1.y color. Empty blocks get empty bounds.
// Requires scalarField.wgsl and VoxelInstance.wgsl (bindings 0 and 1 of group 0).

struct VoxelEmitParams {
  base: u32,       // first vec4 of the layer's records in the object pool
  count: u32,      // blocks (columns x rows)
  sphere: u32,     // 1: spheres
  dispatchWidth: u32,
};

@group(0) @binding(2) var<storage, read_write> voxelObjects: array<vec4f>;
@group(0) @binding(3) var<uniform> voxelEmit: VoxelEmitParams;

@compute @workgroup_size(256)
fn emitVoxels(@builtin(global_invocation_id) id: vec3u) {
  let i = id.y * voxelEmit.dispatchWidth + id.x;
  if (i >= voxelEmit.count) {
    return;
  }
  let block = voxelBlock(i);
  let at = voxelEmit.base + i * 4u;
  let visible = voxel.graphFlags.x > 0.5 && voxel.graphTintOpacity.a > 0.0 && all(block.halfSize > vec3f(1e-7)) && block.color.a > 0.0;
  let color = bitcast<f32>(pack4x8unorm(vec4f(mix(vec3f(luminance(block.color.rgb)), block.color.rgb, clamp(voxel.shade.x, 0.0, 1.0)), 1.0)));
  // Blocks extrude from the layer plane along +Z by their half height on both sides (raster convention).
  if (voxelEmit.sphere == 1u) {
    voxelObjects[at] = vec4f(block.center, select(0.0, min(block.halfSize.x, min(block.halfSize.y, block.halfSize.z)), visible));
    voxelObjects[at + 1u] = vec4f(0.0, color, 0.0, 0.0);
  } else {
    let lo = select(vec3f(1.0), block.center - block.halfSize, visible);
    let hi = select(vec3f(-1.0), block.center + block.halfSize, visible);
    voxelObjects[at] = vec4f(lo, 0.0);
    voxelObjects[at + 1u] = vec4f(hi, color);
  }
  voxelObjects[at + 2u] = vec4f(0.0);
  voxelObjects[at + 3u] = vec4f(0.0);
}
