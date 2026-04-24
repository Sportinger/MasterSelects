// Gaussian Splat 2D rendering shader
// Vertex: instanced quads (4 verts each), reads splat data from storage buffer
// Fragment: evaluates 2D gaussian, outputs premultiplied alpha

// ── Uniforms ──────────────────────────────────────────────────────────────────
struct CameraUniforms {
  view:       mat4x4f,
  projection: mat4x4f,
  viewport:   vec2f,
  _pad:       vec2f,
  world:      mat4x4f,
  layer:      vec4f, // x = clip/layer opacity multiplier
}

@group(1) @binding(0) var<uniform> camera: CameraUniforms;

// ── Splat storage buffer (14 floats per splat) ───────────────────────────────
@group(0) @binding(0) var<storage, read> splatData: array<f32>;

// ── Sorted index buffer (optional — identity if unsorted) ───────────────────
@group(0) @binding(1) var<storage, read> sortedIndices: array<u32>;

// ── Vertex output / Fragment input ───────────────────────────────────────────
struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color:   vec3f,
  @location(1) opacity: f32,
  @location(2) uv:      vec2f,   // normalized ellipse coordinates
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Build a 3x3 rotation matrix from a unit quaternion (w, x, y, z)
fn quatToMat3(q: vec4f) -> mat3x3f {
  let w = q.x; let x = q.y; let y = q.z; let z = q.w;

  let x2 = x + x; let y2 = y + y; let z2 = z + z;
  let xx = x * x2; let xy = x * y2; let xz = x * z2;
  let yy = y * y2; let yz = y * z2; let zz = z * z2;
  let wx = w * x2; let wy = w * y2; let wz = w * z2;

  return mat3x3f(
    vec3f(1.0 - (yy + zz), xy + wz,         xz - wy),
    vec3f(xy - wz,         1.0 - (xx + zz),  yz + wx),
    vec3f(xz + wy,         yz - wx,          1.0 - (xx + yy)),
  );
}

// Build 3D covariance: Sigma = R * diag(s^2) * R^T
fn buildCovariance3D(scale: vec3f, rot: mat3x3f) -> mat3x3f {
  let s = mat3x3f(
    vec3f(scale.x * scale.x, 0.0, 0.0),
    vec3f(0.0, scale.y * scale.y, 0.0),
    vec3f(0.0, 0.0, scale.z * scale.z),
  );
  // R * S * R^T
  let m = rot * s;
  return m * transpose(rot);
}

fn extractWorldLinear(world: mat4x4f) -> mat3x3f {
  return mat3x3f(
    world[0].xyz,
    world[1].xyz,
    world[2].xyz,
  );
}

fn getWorldScale(worldLinear: mat3x3f) -> vec3f {
  return vec3f(
    length(worldLinear[0]),
    length(worldLinear[1]),
    length(worldLinear[2]),
  );
}

// Project 3D covariance to 2D screen-space covariance via Jacobian
fn projectCovariance(
  cov3d: mat3x3f,
  meanCam: vec3f,
  focal: vec2f,
) -> vec3f {
  let safeZ = select(-0.0001, meanCam.z, abs(meanCam.z) > 0.0001);
  let jx = focal.x / safeZ;
  let jy = focal.y / safeZ;
  let j2x = -jx / safeZ * meanCam.x;
  let j2y = -jy / safeZ * meanCam.y;

  // PlayCanvas/SuperSplat layout: derivative terms live in the third row
  // of the column-major matrix, then projection is transpose(T) * cov * T.
  let J = mat3x3f(
    vec3f(jx, 0.0, j2x),
    vec3f(0.0, jy, j2y),
    vec3f(0.0, 0.0, 0.0),
  );

  let W = transpose(mat3x3f(
    vec3f(camera.view[0].x, camera.view[0].y, camera.view[0].z),
    vec3f(camera.view[1].x, camera.view[1].y, camera.view[1].z),
    vec3f(camera.view[2].x, camera.view[2].y, camera.view[2].z),
  ));

  let T = W * J;
  let cov2d = transpose(T) * cov3d * T;

  // Return upper-triangle of 2D covariance: (xx, xy, yy) with low-pass filter
  return vec3f(
    cov2d[0][0] + 0.3,
    cov2d[0][1],
    cov2d[1][1] + 0.3,
  );
}

// Compute the inverse (conic) of the 2D covariance and the radius
fn conicAndRadius(cov2d: vec3f) -> vec4f {
  let a = cov2d.x;
  let b = cov2d.y;
  let c = cov2d.z;
  let det = a * c - b * b;

  if (det <= 0.0) {
    return vec4f(0.0, 0.0, 0.0, 0.0);
  }

  let invDet = 1.0 / det;
  let conic = vec3f(c * invDet, -b * invDet, a * invDet);

  // Eigenvalues of the 2D covariance → radius at 3 sigma
  let mid = 0.5 * (a + c);
  let d = max(0.1, mid * mid - det);
  let lambda1 = mid + sqrt(d);
  let lambda2 = mid - sqrt(d);
  let maxLambda = max(lambda1, lambda2);
  let radius = ceil(3.0 * sqrt(maxLambda));

  return vec4f(conic, radius);
}

fn alphaClipScale(alpha: f32) -> f32 {
  return select(
    0.0,
    min(1.0, sqrt(log(255.0 * alpha)) * 0.5),
    alpha > 1.0 / 255.0,
  );
}

fn discardVertex() -> VertexOutput {
  var out: VertexOutput;
  out.position = vec4f(0.0, 0.0, 2.0, 1.0);
  out.color = vec3f(0.0);
  out.opacity = 0.0;
  out.uv = vec2f(2.0);
  return out;
}


// ── Vertex Shader (instanced quads) ─────────────────────────────────────────
@vertex
fn vs_main(
  @builtin(vertex_index)   vertexIndex:   u32,
  @builtin(instance_index) instanceIndex: u32,
) -> VertexOutput {
  var out: VertexOutput;

  // Look up actual splat index via sorted indirection buffer
  let splatIdx = sortedIndices[instanceIndex];

  // 14 floats per splat
  let base = splatIdx * 14u;

  // Read splat data
  let pos   = vec3f(splatData[base + 0u], splatData[base + 1u], splatData[base + 2u]);
  let scale = vec3f(splatData[base + 3u], splatData[base + 4u], splatData[base + 5u]);
  let quat  = vec4f(splatData[base + 6u], splatData[base + 7u], splatData[base + 8u], splatData[base + 9u]);
  let color = vec3f(splatData[base + 10u], splatData[base + 11u], splatData[base + 12u]);
  let alpha = splatData[base + 13u];
  let renderAlpha = alpha * clamp(camera.layer.x, 0.0, 1.0);

  // Transform splat-local data into world space via the scene layer transform.
  let rot = quatToMat3(quat);
  let covLocal = buildCovariance3D(scale, rot);
  let worldLinear = extractWorldLinear(camera.world);
  let covWorld = worldLinear * covLocal * transpose(worldLinear);

  // Transform mean to world and then to camera space.
  let meanWorld = camera.world * vec4f(pos, 1.0);
  let meanCam4 = camera.view * meanWorld;
  let meanCam = meanCam4.xyz;

  // Right-handed view space: visible splats are in front of the camera at negative Z.
  // Reject splats that are behind the eye or so close that their support overlaps
  // the near plane heavily; those produce gigantic projected billboards and smear
  // over the full frame when flying through the cloud.
  let viewDepth = -meanCam.z;
  let worldScale = getWorldScale(worldLinear);
  let supportScale = scale * worldScale;
  let supportRadius3d = 3.0 * max(supportScale.x, max(supportScale.y, supportScale.z));
  let minRenderableDepth = max(0.05, supportRadius3d);
  if (viewDepth <= minRenderableDepth) {
    return discardVertex();
  }

  // Focal length from projection matrix
  let focal = vec2f(
    camera.projection[0][0] * camera.viewport.x * 0.5,
    camera.projection[1][1] * camera.viewport.y * 0.5,
  );

  // Project covariance to 2D
  let cov2d = projectCovariance(covWorld, meanCam, focal);
  let diagonal1 = cov2d.x;
  let offDiagonal = cov2d.y;
  let diagonal2 = cov2d.z;
  let mid = 0.5 * (diagonal1 + diagonal2);
  let eigenRadius = length(vec2f((diagonal1 - diagonal2) * 0.5, offDiagonal));
  let lambda1 = mid + eigenRadius;
  let lambda2 = max(mid - eigenRadius, 0.1);

  if (!(lambda1 > 0.0) || !(lambda2 > 0.0) || !(renderAlpha > 1.0 / 255.0)) {
    return discardVertex();
  }

  let viewportMin = min(1024.0, min(camera.viewport.x, camera.viewport.y));
  let axis1Length = 2.0 * min(sqrt(2.0 * lambda1), viewportMin);
  let axis2Length = 2.0 * min(sqrt(2.0 * lambda2), viewportMin);
  if (axis1Length < 2.0 && axis2Length < 2.0) {
    return discardVertex();
  }

  let rawAxis1 = vec2f(offDiagonal, lambda1 - diagonal1);
  let rawAxis1LengthSq = dot(rawAxis1, rawAxis1);
  let safeAxis1 = rawAxis1 * inverseSqrt(max(rawAxis1LengthSq, 1e-10));
  let axis1 = select(vec2f(1.0, 0.0), safeAxis1, rawAxis1LengthSq > 1e-10);
  let axis2 = vec2f(axis1.y, -axis1.x);

  // Project mean to clip space
  let meanClip = camera.projection * meanCam4;

  // Quad corner offsets: [-1,-1], [1,-1], [-1,1], [1,1]
  let quadOffsets = array<vec2f, 4>(
    vec2f(-1.0, -1.0),
    vec2f( 1.0, -1.0),
    vec2f(-1.0,  1.0),
    vec2f( 1.0,  1.0),
  );

  let cornerOffset = quadOffsets[vertexIndex % 4u];
  let uv = cornerOffset * alphaClipScale(renderAlpha);
  let pixelOffset = uv.x * axis1Length * axis1 + uv.y * axis2Length * axis2;
  let ndcOffset = pixelOffset / camera.viewport * 2.0;

  out.position = vec4f(
    meanClip.xy / meanClip.w + ndcOffset,
    meanClip.z / meanClip.w,
    1.0,
  );
  out.color = color;
  out.opacity = renderAlpha;
  out.uv = uv;

  return out;
}


// ── Fragment Shader ─────────────────────────────────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let support = dot(in.uv, in.uv);
  if (support > 1.0) {
    discard;
  }

  let edgeExp = exp(-4.0);
  let normalizedFalloff = (exp(-4.0 * support) - edgeExp) / (1.0 - edgeExp);
  let a = min(0.99, in.opacity * normalizedFalloff);

  if (a < 1.0 / 255.0) {
    discard;
  }

  // Premultiplied alpha output
  return vec4f(in.color * a, a);
}
