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

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localUv: vec2f,
  @location(1) localNormal: vec3f,
  @location(2) sourceColor: vec4f,
  @location(3) height01: f32,
  @location(4) material: f32,
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

fn faceFrame(face: u32) -> mat3x3f {
  switch face {
    case 0u: { return mat3x3f(vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0)); }
    case 1u: { return mat3x3f(vec3f(0.0, -1.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(-1.0, 0.0, 0.0)); }
    case 2u: { return mat3x3f(vec3f(-1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0)); }
    case 3u: { return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), vec3f(0.0, -1.0, 0.0)); }
    case 4u: { return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), vec3f(0.0, 0.0, 1.0)); }
    default: { return mat3x3f(vec3f(1.0, 0.0, 0.0), vec3f(0.0, -1.0, 0.0), vec3f(0.0, 0.0, -1.0)); }
  }
}

@vertex
fn voxelVertexMain(
  @location(0) primitivePosition: vec3f,
  @location(1) primitiveNormal: vec3f,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
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

  var normalizedPosition = primitivePosition / 0.6;
  var normalizedNormal = primitiveNormal;
  if (voxel.texture.z > 0.5 && voxel.texture.z < 1.5) { normalizedPosition = primitivePosition / 0.7; }
  if (voxel.texture.z > 1.5) {
    // MeshPass cylinders are Y-up; relief primitives extrude along local Z.
    normalizedPosition = vec3f(primitivePosition.x / 0.5, primitivePosition.z / 0.5, primitivePosition.y / 0.6);
    normalizedNormal = vec3f(primitiveNormal.x, primitiveNormal.z, primitiveNormal.y);
  }
  let localPosition = center + normalizedPosition * halfSize * 2.0;
  var surfaceUv = vec2f(0.5);
  if (voxel.texture.z < 0.5) {
    // Preserve the legacy procedural cube's per-face 0..1 corner distance.
    // The shared primitive mesh intentionally has no authored UVs.
    let axis = abs(normalizedNormal);
    if (axis.x >= axis.y && axis.x >= axis.z) { surfaceUv = normalizedPosition.yz + vec2f(0.5); }
    else if (axis.y >= axis.z) { surfaceUv = normalizedPosition.xz + vec2f(0.5); }
    else { surfaceUv = normalizedPosition.xy + vec2f(0.5); }
  } else if (voxel.texture.z < 1.5) {
    surfaceUv = vec2f(atan2(normalizedPosition.y, normalizedPosition.x) / 6.28318530718 + 0.5, normalizedPosition.z + 0.5);
  } else {
    surfaceUv = vec2f(atan2(normalizedPosition.y, normalizedPosition.x) / 6.28318530718 + 0.5, normalizedPosition.z + 0.5);
  }

  var output: VertexOutput;
  output.position = voxel.viewProjection * voxel.world * vec4f(localPosition, 1.0);
  output.localUv = surfaceUv;
  output.localNormal = normalize(normalizedNormal / max(halfSize, vec3f(0.0001)));
  output.sourceColor = colorAtUv(sourceUv);
  output.height01 = height01;
  output.material = 1.0;
  return output;
}

@vertex
fn floorVertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let positions = array<vec2f, 6>(
    vec2f(-0.5, -0.5), vec2f(0.5, -0.5), vec2f(-0.5, 0.5),
    vec2f(-0.5, 0.5), vec2f(0.5, -0.5), vec2f(0.5, 0.5),
  );
  let uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0),
  );
  var output: VertexOutput;
  output.position = voxel.viewProjection * voxel.world * vec4f(positions[vertexIndex], 0.0, 1.0);
  output.localUv = uvs[vertexIndex];
  output.localNormal = vec3f(0.0, 0.0, 1.0);
  output.sourceColor = vec4f(0.0);
  output.height01 = 0.0;
  output.material = 0.0;
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  if (voxel.graphFlags.x < 0.5 || voxel.graphTintOpacity.a <= 0.0) { discard; }
  if (input.material < 0.5) {
    let floorColor = colorAtUv(input.localUv);
    // Transparent source pixels must not paint an opaque black floor over
    // whatever sits behind this layer in the scene.
    if (floorColor.a < 1.0 / 255.0) {
      discard;
    }
    return vec4f(floorColor.rgb * floorColor.a * clamp(voxel.shade.z, 0.0, 1.0) * voxel.height.w * voxel.graphTintOpacity.a, voxel.graphTintOpacity.a);
  }

  let radians = 3.14159265359 / 180.0;
  let azimuth = voxel.light.x * radians;
  let elevation = clamp(voxel.light.y, 1.0, 89.0) * radians;
  let lightDir = normalize(vec3f(
    cos(azimuth) * cos(elevation),
    -sin(azimuth) * cos(elevation),
    sin(elevation),
  ));
  let normal = normalize(input.localNormal);
  let diffuse = max(dot(normal, lightDir), 0.0);
  let faceBias = mix(0.68, 1.08, abs(normal.z));
  let lighting = clamp(voxel.light.z + diffuse * voxel.light.w, 0.0, 2.0) * faceBias;
  let sourceRgb = mix(vec3f(luminance(input.sourceColor.rgb)), input.sourceColor.rgb, clamp(voxel.shade.x, 0.0, 1.0));
  let edgeDistance = max(abs(input.localUv.x - 0.5), abs(input.localUv.y - 0.5)) * 2.0;
  let edge = smoothstep(0.86, 1.0, edgeDistance);
  var color = sourceRgb * lighting;
  color *= 1.0 - edge * clamp(voxel.shade.y, 0.0, 1.0) * 0.72;
  color += vec3f(input.height01 * 0.045);
  return vec4f(clamp(color, vec3f(0.0), vec3f(1.0)) * voxel.height.w * voxel.graphTintOpacity.a, voxel.graphTintOpacity.a);
}
