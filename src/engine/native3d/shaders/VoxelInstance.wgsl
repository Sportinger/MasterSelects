// One voxel block of a voxel-relief layer: its center and half size in the layer's local space
// (extruding along +Z), its color and relief height. Shared by the raster pass (VoxelPass.wgsl)
// and the path tracer's box emission (pathtrace/scene/PtVoxelEmission.wgsl), so both place the
// same blocks. Requires scalarField.wgsl (evaluateScalarField).

struct VoxelUniforms {
  viewProjection: mat4x4f,
  world: mat4x4f,
  grid: vec4f,    // columns, rows, gap, footprint height
  height: vec4f,  // scale, base, contrast, opacity
  light: vec4f,   // angle, elevation, ambient, strength
  shade: vec4f,   // color mix, edge darkness, floor brightness, texture width
  texture: vec4f, // texture height, padding
  graphHeightUV: vec4f,
  graphColorUV: vec4f,
  graphTintOpacity: vec4f,
  graphFlags: vec4f,
  graphBoxSize: vec4f,
  graphField: array<vec4f, 32>,
}

@group(0) @binding(0) var<uniform> voxel: VoxelUniforms;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;

fn luminance(color: vec3f) -> f32 {
  return dot(color, vec3f(0.2126, 0.7152, 0.0722));
}

fn sourceAtUv(uv: vec2f) -> vec4f {
  // Native preview targets may upload a quality-scaled texture. Sampling it
  // with the media file's intrinsic dimensions reads out of bounds and leaves
  // only a narrow strip of voxels alive. Always address the bound texture.
  let dimensions = textureDimensions(sourceTexture);
  let width = max(dimensions.x, 1u);
  let height = max(dimensions.y, 1u);
  let x = min(u32(clamp(uv.x, 0.0, 1.0) * f32(width)), width - 1u);
  let y = min(u32(clamp(uv.y, 0.0, 1.0) * f32(height)), height - 1u);
  return textureLoad(sourceTexture, vec2u(x, y), 0);
}

fn colorAtUv(uv: vec2f) -> vec4f {
  let sampled = sourceAtUv(uv * voxel.graphColorUV.xy + voxel.graphColorUV.zw);
  return select(vec4f(voxel.graphTintOpacity.rgb, 1.0), vec4f(sampled.rgb * voxel.graphTintOpacity.rgb, sampled.a), voxel.graphFlags.y > 0.5);
}

struct VoxelBlock {
  center: vec3f,
  halfSize: vec3f,
  color: vec4f,
  height01: f32,
};

fn voxelBlock(instanceIndex: u32) -> VoxelBlock {
  let columns = u32(voxel.grid.x);
  let rows = u32(voxel.grid.y);
  let column = instanceIndex % columns;
  let row = instanceIndex / columns;
  let sourceUv = (vec2f(f32(column), f32(row)) + vec2f(0.5)) / voxel.grid.xy;
  let source = sourceAtUv(sourceUv * voxel.graphHeightUV.xy + voxel.graphHeightUV.zw);
  let brightness = pow(clamp(luminance(source.rgb), 0.0, 1.0), max(voxel.height.z, 0.001));
  let alphaScale = select(0.0, 1.0, source.a > 1.0 / 255.0);
  let height01 = brightness * source.a;
  // Center relief depth around the clip transform plane. A one-sided negative
  // extrusion looked like a voxel scene trapped behind a flat media window.
  var fieldHeight = max(voxel.height.y + height01 * voxel.height.x, 0.0) * alphaScale;
  if (voxel.graphFlags.z > 0.0) {
    fieldHeight = max(0.0, evaluateScalarField(luminance(source.rgb), voxel.graphField, u32(voxel.graphFlags.z), u32(voxel.graphFlags.w))) * source.a;
  }
  let blockHeight = fieldHeight * voxel.graphBoxSize.z * voxel.grid.w * 0.5;
  let fill = (1.0 - clamp(voxel.grid.z, 0.0, 0.42)) * alphaScale;
  let halfSize = vec3f(0.5 * fill * voxel.graphBoxSize.x / voxel.grid.x, 0.5 * fill * voxel.graphBoxSize.y / voxel.grid.y, blockHeight * 0.5);
  let center = vec3f(
    (f32(column) + 0.5) / voxel.grid.x - 0.5,
    0.5 - (f32(row) + 0.5) / voxel.grid.y,
    0.0,
  );

  return VoxelBlock(center, halfSize, colorAtUv(sourceUv), height01);
}
