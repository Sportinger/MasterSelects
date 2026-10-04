// Raster voxel relief: instanced blocks placed by voxelBlock (VoxelInstance.wgsl), plus the floor.
// Requires scalarField.wgsl and VoxelInstance.wgsl.

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localUv: vec2f,
  @location(1) localNormal: vec3f,
  @location(2) sourceColor: vec4f,
  @location(3) height01: f32,
  @location(4) material: f32,
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
  let block = voxelBlock(instanceIndex);
  let center = block.center;
  let halfSize = block.halfSize;
  let height01 = block.height01;

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
  output.sourceColor = block.color;
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
