// Gaussian Splat 2D rendering shader
// Vertex: instanced quads (4 verts each), reads splat data from storage buffer
// Fragment: evaluates 2D gaussian, outputs premultiplied alpha

// ── Uniforms ──────────────────────────────────────────────────────────────────
struct CameraUniforms {
  view:       mat4x4f,
  projection: mat4x4f,
  viewport:   vec2f,
  _pad:       vec2f,
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
  @location(2) conic:   vec3f,   // inverse 2D covariance (a, b, c)
  @location(3) offset:  vec2f,   // UV offset from splat center
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

// Project 3D covariance to 2D screen-space covariance via Jacobian
fn projectCovariance(
  cov3d: mat3x3f,
  meanCam: vec3f,
  focal: vec2f,
) -> vec3f {
  let tx = meanCam.x;
  let ty = meanCam.y;
  let tz = meanCam.z;

  // Clamp tz to avoid division by near-zero
  let tz2 = max(tz * tz, 0.0001);

  // Jacobian of perspective projection
  let J = mat3x3f(
    vec3f(focal.x / tz, 0.0,          0.0),
    vec3f(0.0,          focal.y / tz,  0.0),
    vec3f(-focal.x * tx / tz2, -focal.y * ty / tz2, 0.0),
  );

  let T = J * mat3x3f(
    vec3f(camera.view[0].x, camera.view[0].y, camera.view[0].z),
    vec3f(camera.view[1].x, camera.view[1].y, camera.view[1].z),
    vec3f(camera.view[2].x, camera.view[2].y, camera.view[2].z),
  );

  let cov2d = T * cov3d * transpose(T);

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

  // Compute 3D covariance
  let rot = quatToMat3(quat);
  let cov3d = buildCovariance3D(scale, rot);

  // Transform mean to camera space
  let meanWorld = vec4f(pos, 1.0);
  let meanCam4 = camera.view * meanWorld;
  let meanCam = meanCam4.xyz;

  // Right-handed view space: visible splats are in front of the camera at negative Z.
  // Reject splats that are behind the eye or so close that their support overlaps
  // the near plane heavily; those produce gigantic projected billboards and smear
  // over the full frame when flying through the cloud.
  let viewDepth = -meanCam.z;
  let supportRadius3d = 3.0 * max(scale.x, max(scale.y, scale.z));
  let minRenderableDepth = max(0.05, supportRadius3d);
  if (viewDepth <= minRenderableDepth) {
    out.position = vec4f(0.0, 0.0, 2.0, 1.0); // behind clip plane
    out.color = vec3f(0.0);
    out.opacity = 0.0;
    out.conic = vec3f(0.0);
    out.offset = vec2f(0.0);
    return out;
  }

  // Focal length from projection matrix
  let focal = vec2f(
    camera.projection[0][0] * camera.viewport.x * 0.5,
    camera.projection[1][1] * camera.viewport.y * 0.5,
  );

  // Project covariance to 2D
  let cov2d = projectCovariance(cov3d, meanCam, focal);
  let cr = conicAndRadius(cov2d);
  let conic = select(vec3f(0.01, 0.0, 0.01), cr.xyz, cr.w > 0.0);
  let radius = clamp(cr.w, 1.0, 512.0);

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

  // Scale offset by radius in NDC
  let ndcOffset = cornerOffset * radius / camera.viewport;

  out.position = vec4f(
    meanClip.xy / meanClip.w + ndcOffset * 2.0,
    meanClip.z / meanClip.w,
    1.0,
  );
  out.color = color;
  out.opacity = alpha;
  out.conic = conic;
  out.offset = cornerOffset * radius;

  return out;
}


// ── Fragment Shader ─────────────────────────────────────────────────────────
@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4f {
  let dx = in.offset.x;
  let dy = in.offset.y;

  // Evaluate 2D gaussian
  let power = -0.5 * (in.conic.x * dx * dx + 2.0 * in.conic.y * dx * dy + in.conic.z * dy * dy);

  // Outside the bell curve.
  if (power > 0.0) {
    discard;
  }

  let a = min(0.99, in.opacity * exp(power));

  if (a < 1.0 / 255.0) {
    discard;
  }

  // Premultiplied alpha output
  return vec4f(in.color * a, a);
}
