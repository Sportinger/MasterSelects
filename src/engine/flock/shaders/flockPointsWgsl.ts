import { QUAD_CORNERS, RENDER_COMMON } from './flockRenderCommonWgsl';

/**
 * Point sprites, optionally lit as sphere impostors that receive the key
 * light's shadow map, plus the depth-only entry points that render points into
 * that shadow map. Sub-particles and pigment relief apply to both.
 */

export const FLOCK_POINTS_WGSL = /* wgsl */ `
${RENDER_COMMON}
${QUAD_CORNERS}

struct PointOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec4f,
  @location(2) viewDir: vec3f,
  @location(3) visibility: f32,
};

struct PointSample {
  visible: bool,
  simPos: vec3f,
  uv: vec2f,
  parent: u32,
  sizeRnd: f32,
};

fn pointSample(instIdx: u32) -> PointSample {
  var out: PointSample;
  let childCount = max(1u, u32(br.children));
  let ii = instIdx / childCount;
  let p = stateCur[ii];
  out.visible = isVisibleParticle(ii, p);
  if (!out.visible) { return out; }
  let child = childSample(ii, instIdx % childCount, p, interpolatedPos(ii));
  out.simPos = child.pos + reliefOffset(child.uv);
  out.uv = child.uv;
  out.parent = ii;
  out.sizeRnd = select(p.rnd, flockHash01(instIdx, 911u), childCount > 1u);
  return out;
}

fn pointsLit() -> bool {
  return br.shading < 0.5;
}

@vertex
fn vsPoints(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> PointOut {
  var out: PointOut;
  let s = pointSample(instIdx);
  if (!s.visible) { out.clip = HIDDEN; return out; }
  let p = stateCur[s.parent];
  let simPos = s.simPos;
  let clip = toClip(simPos);
  let corner = quadCorner(vi);
  let size = max(0.0, br.size * (1.0 + br.sizeVariance * (s.sizeRnd * 2.0 - 1.0)));
  var coverage = 1.0;
  if (br.sizeMode < 0.5) {
    let px = max(size, 1.0);
    coverage = min(1.0, size * size);
    out.clip = clip + vec4f(corner * px / rb.frame.viewport * clip.w, 0.0, 0.0);
  } else {
    let radius = size * 0.5 * rb.frame.worldUnitsPerSim;
    let world = toWorld(simPos) + (rb.frame.cameraRight * corner.x + rb.frame.cameraUp * corner.y) * radius;
    out.clip = rb.frame.viewProj * vec4f(world, 1.0);
    let projectedPx = radius * 2.0 * rb.frame.focalPx / max(clip.w, 1e-3);
    coverage = clamp(projectedPx * projectedPx, 0.02, 1.0);
  }
  out.uv = corner;
  out.color = vec4f(branchColorAt(p, simPos, s.uv), br.opacity * distanceFade(clip.w) * coverage);
  out.viewDir = normalize(rb.frame.cameraPos - toWorld(simPos));
  out.visibility = 1.0;
  if (pointsLit()) { out.visibility = shadowVisibility(simPos); }
  return out;
}

@fragment
fn fsPoints(in: PointOut) -> @location(0) vec4f {
  let d = length(in.uv);
  let shape = u32(br.shape);
  var a = 0.0;
  if (shape == 0u) { a = 1.0 - smoothstep(0.75, 1.0, d); }
  else if (shape == 1u) { a = min(1.0, 1.35 * exp(-2.4 * d * d)) * (1.0 - smoothstep(0.85, 1.0, d)); }
  else if (shape == 2u) { a = 1.0 - smoothstep(0.85, 1.0, max(abs(in.uv.x), abs(in.uv.y))); }
  else if (shape == 3u) { a = 1.0 - smoothstep(0.1, 0.22, abs(d - 0.72)); }
  else { let s = abs(in.uv.x * in.uv.y); a = (1.0 - smoothstep(0.02, 0.09, s)) * (1.0 - smoothstep(0.7, 1.0, d)); }
  var rgb = in.color.rgb;
  if (pointsLit()) {
    // Sphere impostor normal from the sprite coordinate.
    let nz = sqrt(max(0.0, 1.0 - min(d * d, 1.0)));
    let normal = normalize(rb.frame.cameraRight * in.uv.x + rb.frame.cameraUp * in.uv.y + in.viewDir * nz);
    rgb = litColor(rgb, normal, in.visibility);
  }
  let alpha = in.color.a * a;
  if (br.blend > 1.5) { if (a < 0.5) { discard; } return vec4f(rgb, 1.0); }
  if (alpha <= 0.002) { discard; }
  return vec4f(rgb * alpha, alpha);
}

struct ShadowOut {
  @builtin(position) clip: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vsPointsShadow(@builtin(vertex_index) vi: u32, @builtin(instance_index) instIdx: u32) -> ShadowOut {
  var out: ShadowOut;
  let s = pointSample(instIdx);
  if (!s.visible) { out.clip = HIDDEN; return out; }
  let clip = lightClip(s.simPos);
  let corner = quadCorner(vi);
  // Footprint in shadow-map texels, wide enough to close gaps between neighbors.
  let radius = 1.0 + br.size * 0.35;
  out.clip = clip + vec4f(corner * radius * 2.0 * rb.light.texel * clip.w, 0.0, 0.0);
  out.uv = corner;
  return out;
}

@fragment
fn fsPointsShadow(in: ShadowOut) {
  if (dot(in.uv, in.uv) > 1.0) { discard; }
}
`;
