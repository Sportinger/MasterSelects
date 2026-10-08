// Weave strands: every curve segment is expanded into camera-facing ribbons by vertex pulling,
// one instance per fiber. A Yarn Profile places plies on a ring around the curve and fibers on
// a ring around each ply; both angles follow arc length, so radius changes never spin the twist.
// The world-space width decides the projected pixel width; fibers thinner than one pixel keep one
// pixel of geometry and a deterministic hashed coverage instead, so dense yarns need no sorting,
// export reproduces the preview and zero-width strands draw nothing.
// Self-shadowing uses deep opacity maps (Kim & Neumann 2001, Yuksel & Keyser 2008): the same vertex
// stage renders the fibers from the shadowing light into a depth map and then additively into four
// opacity layers behind that depth; the main pass reads the opacity in front of each fragment.
// For a scene light, opaque meshes seen from the same light form an occluder depth map, so
// they shadow the strands too (the lookup is in StrandShadowSample.wgsl, prepended by StrandPass).
// Flyaway channels are extra instances per yarn: in a hashed window per curve cell one stray fiber
// arcs off the yarn surface and returns (loop) or ends at its peak (free end); elsewhere it is hidden.

/** A fiber must lie this many opacity layers behind another before it is shadowed by it, so fibers never shadow themselves. */
const SHADOW_BIAS: f32 = 0.35;

struct StrandUniforms {
  world: mat4x4f,
  view: mat4x4f,
  projection: mat4x4f,
  camera: vec4f,  // xyz: camera position (world)
  color: vec4f,   // rgb: fallback color, w: connected per-point color field
  params: vec4f,  // x: world fiber width, yz: viewport pixels, w: layer opacity
  light: vec4f,   // xyz: key light direction (world, toward the light), w: ambient
  yarn: vec4f,    // x: plies, y: fibers per ply, z: yarn radius (local), w: ply twist (turns per unit length)
  twist: vec4f,   // x: fiber twist, y: flyaway seed, z: spline subdivisions, w: 1 for 4x coverage
  fly: vec4f,     // x: flyaway cell length per channel, y: flyaway length, z: lift (yarn radii), w: free-end fraction
  ambient: vec4f, // rgb: ambient from environment lights, w: direct scene lights (-1: none, use the key light)
  lights: array<StrandLight, 4>,
  shadowMatrix: mat4x4f, // view-projection of the shadowing light (scene space)
  shadow: vec4f,         // x: 0 none, 1 key light, 2 + n scene light n; y: opacity layer spacing; z: opacity per fiber; w: strength
  shadowRange: vec4f,    // x: near, y: far, z: 1 perspective, 0 orthographic
  occluderMatrix: mat4x4f, // view-projection of the shadowing light for opaque meshes, near plane close to the light
  occluder: vec4f,         // x: 1 when meshes cast, y: near, z: far, w: depth bias (scene units)
  // Fiber Material look (strandLook.ts): R/TRT exponents and strengths, TT strength, R/TRT shifts,
  // per-point attributes flag, R coat tint, and per material the diffuse color (white for a Color Field).
  look: vec4f,
  look2: vec4f,
  coat: vec4f,
  materialColors: array<vec4f, 16>,
  // Environment irradiance / π (environmentIrradiance.ts): [c0 rgb, 1 when present], linear term per channel.
  irradiance: array<vec4f, 4>,
  material: vec4f,         // x: arc-length offset of flowing fiber detail
};

/** A point (kind 1) or panel (kind 2) scene light, packed like MeshPass lights. */
struct StrandLight {
  positionKind: vec4f,
  colorIntensity: vec4f,
  directionDiameter: vec4f,
};

@group(0) @binding(0) var<uniform> u: StrandUniforms;
// Three vec4 per point: (position, arc length), (rotation-minimizing normal, radius scale), (tangent, strand index).
@group(0) @binding(1) var<storage, read> points: array<vec4f>;
// First point index per segment; bit 31/30: the strand continues before/after the segment.
@group(0) @binding(2) var<storage, read> segments: array<u32>;
// Nearest fiber depth and four cumulative opacity layers seen from the shadowing light.
@group(0) @binding(3) var shadowDepth: texture_depth_2d;
@group(0) @binding(4) var shadowOpacity: texture_2d<f32>;
@group(0) @binding(5) var shadowSampler: sampler;
// Nearest opaque mesh depth seen from the shadowing light.
@group(0) @binding(6) var occluderDepth: texture_depth_2d;
// Fiber Material attributes per point: unorm4x8 color + roughness scale / 2, melanin << 16 | material.
@group(0) @binding(7) var<storage, read> pointAttributes: array<vec2u>;
@group(0) @binding(8) var<storage, read> pointColors: array<vec4f>;

/** Diffuse color and roughness scale shadeStrandPoint uses; entry points set them before shading. */
var<private> strandShadeColor: vec3f;
var<private> strandShadeRoughness: f32;

/** Per-point Fiber Material color and roughness scale between curve points `first` and `first + 1`. */
fn strandPointLook(first: u32, t: f32) -> vec4f {
  var color = u.color.rgb;
  if (u.color.w > 0.5) {
    color = mix(pointColors[first].rgb, pointColors[first + 1u].rgb, t);
  }
  if (u.look2.w < 0.5) {
    return vec4f(color, 1.0);
  }
  let a = pointAttributes[first];
  let b = pointAttributes[first + 1u];
  let colorA = unpack4x8unorm(a.x);
  let colorB = unpack4x8unorm(b.x);
  let tintA = u.materialColors[min(a.y & 0xffffu, 15u)].rgb;
  let tintB = u.materialColors[min(b.y & 0xffffu, 15u)].rgb;
  return vec4f(select(mix(colorA.rgb * tintA, colorB.rgb * tintB, t), color, u.color.w > 0.5), 2.0 * mix(colorA.a, colorB.a, t));
}

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) tangent: vec3f,
  @location(1) toCamera: vec3f,
  @location(2) across: f32,
  @location(3) coverage: f32,
  @location(4) @interpolate(flat) segment: u32,
  @location(5) widthAxis: vec3f,  // world direction of the ribbon's +across side
  @location(6) pixels: f32,       // projected fiber width
  @location(8) @interpolate(flat) pickPoint: u32,
  @location(9) pickT: f32,
  @location(10) @interpolate(flat) pickStrand: u32,
  @location(7) look: vec4f,       // per-point diffuse color and roughness scale
};

// The yarn geometry (hash3, flyaways, fiber points, Catmull-Rom) is in StrandFiberGeometry.wgsl,
// shared with the path tracer's fiber emission; these wrappers feed it this layer's uniforms.
fn strandFiberParams() -> StrandFiberParams {
  var twist = u.twist;
  twist.z = u.material.x;
  return StrandFiberParams(u.world, u.yarn, twist, u.fly);
}

/** The flyaway of `channel` in the curve cell holding arc length `s`: one per cell, at a hashed place. */
fn flyawayAt(strand: u32, channel: u32, s: f32) -> Flyaway {
  return strandFlyawayAt(strandFiberParams(), strand, channel, s);
}

/** World-space position of `fiber` at curve point `index` (see strandFiberPoint). */
fn fiberPoint(index: u32, fiber: u32, fly: Flyaway) -> vec3f {
  return strandFiberPoint(strandFiberParams(), index, fiber, fly);
}

fn toPixels(clip: vec4f) -> vec2f {
  return clip.xy / clip.w * 0.5 * u.params.yz;
}

@vertex
fn strandVertex(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) fiber: u32) -> VertexOutput {
  var out: VertexOutput;
  // Close-ups split every segment into spline pieces; each piece is two triangles.
  let subdivisions = max(u32(u.twist.z), 1u);
  let segment = vertexIndex / (6u * subdivisions);
  let piece = (vertexIndex / 6u) % subdivisions;
  let corner = vertexIndex % 6u;
  let packed = segments[segment];
  let first = packed & 0x3fffffffu;
  out.coverage = 0.0;
  out.position = vec4f(2.0, 2.0, 2.0, 1.0);
  // Instances past the yarn fibers are flyaway channels, drawn only where their window overlaps the segment.
  let yarnFibers = u32(max(u.yarn.x, 1.0)) * u32(max(u.yarn.y, 1.0));
  var fly: Flyaway;
  if (fiber >= yarnFibers) {
    let startArc = points[first * 3u].w + u.material.x;
    let endArc = points[(first + 1u) * 3u].w + u.material.x;
    fly = flyawayAt(u32(points[first * 3u + 2u].w), fiber - yarnFibers, 0.5 * (startArc + endArc));
    if (endArc <= fly.start || startArc >= fly.start + fly.length) {
      return out;
    }
  }
  let a = fiberPoint(first, fiber, fly);
  let b = fiberPoint(first + 1u, fiber, fly);
  // Neighbouring points shape the spline; at a joint both segments derive the same tangent.
  let before = select(a, fiberPoint(first - 1u, fiber, fly), (packed & 0x80000000u) != 0u);
  let after = select(b, fiberPoint(first + 2u, fiber, fly), (packed & 0x40000000u) != 0u);
  // Two triangles per segment: (a-, b-, a+) and (a+, b-, b+).
  let atB = corner == 1u || corner == 4u || corner == 5u;
  let side = select(-1.0, 1.0, corner == 2u || corner == 3u || corner == 5u);
  let t = (f32(piece) + select(0.0, 1.0, atB)) / f32(subdivisions);
  let p = catmullRom(before, a, b, after, t);
  // A yarn radius scale of zero hides the strand: fibers thin out with the radius they grow from.
  let scaleA = clamp(points[first * 3u + 1u].w, 0.0, 1.0);
  let scaleB = clamp(points[(first + 1u) * 3u + 1u].w, 0.0, 1.0);
  let widthScale = mix(scaleA, scaleB, t);
  let viewProjection = u.projection * u.view;
  let clipA = viewProjection * vec4f(a, 1.0);
  let clipB = viewProjection * vec4f(b, 1.0);
  // Visibility is decided per segment so all six vertices agree: a segment hidden at one end tapers
  // to zero coverage instead of stretching a triangle toward the parking position. Segments that
  // reach behind the near plane are skipped rather than clipped.
  if (max(scaleA, scaleB) <= 0.0 || u.params.w <= 0.0 || clipA.w <= 1e-5 || clipB.w <= 1e-5) {
    return out;
  }
  // Level of detail (stochastic simplification, Cook et al. 2007): where this segment's fibers are
  // thinner than a pixel, only a hashed share of them is drawn, each with proportionally more
  // coverage, so a distant yarn keeps its density with fewer and calmer fragments. The choice is
  // made per segment and per strand, never per vertex.
  let midClip = viewProjection * vec4f(0.5 * (a + b), 1.0);
  let segmentPixels = u.params.x * max(scaleA, scaleB) * abs(u.projection[1][1]) * 0.5 * u.params.z / max(midClip.w, 1e-5);
  let keep = select(clamp(segmentPixels, 1.0 / f32(yarnFibers + 4u), 1.0), 1.0, u.twist.w > 0.5);
  if (keep < 1.0 && hash3(u32(points[first * 3u + 2u].w), fiber, 0x5f3759dfu) >= keep) {
    return out;
  }
  let span = b - a;
  let spanTangent = select(vec3f(1.0, 0.0, 0.0), normalize(span), dot(span, span) > 1e-18);
  let derivative = catmullRomTangent(before, a, b, after, t);
  let tangent = select(spanTangent, normalize(derivative), dot(derivative, derivative) > 1e-18);
  out.pickPoint = first; out.pickT = t; out.pickStrand = u32(points[first * 3u + 2u].w);
  out.segment = segment ^ (fiber * 0x9e3779b9u);
  out.look = strandPointLook(first, t);
  out.across = side;
  out.tangent = tangent;
  out.toCamera = u.camera.xyz - p;
  let clip = viewProjection * vec4f(p, 1.0);
  let ahead = viewProjection * vec4f(p + tangent * 1e-3, 1.0);
  let toCamera = normalize(u.camera.xyz - p);
  let widthAxis = cross(tangent, toCamera);
  let widthDirection = select(vec3f(0.0, 1.0, 0.0), normalize(widthAxis), dot(widthAxis, widthAxis) > 1e-12);
  let edge = viewProjection * vec4f(p + widthDirection * u.params.x * widthScale, 1.0);
  let pixels = select(0.0, length(toPixels(edge) - toPixels(clip)), edge.w > 1e-5);
  out.coverage = clamp(pixels / keep, 0.0, 1.0) * u.params.w;
  let screen = select(toPixels(clipB) - toPixels(clipA), toPixels(ahead) - toPixels(clip), ahead.w > 1e-5);
  let direction = select(vec2f(1.0, 0.0), normalize(screen), dot(screen, screen) > 1e-12);
  let normal = vec2f(-direction.y, direction.x);
  // The world width axis that the ribbon's +across side projects onto, for the tube normal.
  let edgeScreen = toPixels(edge) - toPixels(clip);
  out.widthAxis = widthDirection * select(1.0, -1.0, dot(edgeScreen, normal) < 0.0);
  out.pixels = pixels;
  let offset = normal * side * max(pixels, 1.0) * 0.5 / (0.5 * u.params.yz);
  out.position = vec4f(clip.xy + offset * clip.w, clip.zw);
  return out;
}

/** Opaque meshes between the shadowing light and `p`, with a 2 × 2 percentage-closer filter. */
fn occluderVisibility(p: vec3f) -> f32 {
  if (u.occluder.x < 0.5) {
    return 1.0;
  }
  let clip = u.occluderMatrix * vec4f(p, 1.0);
  if (clip.w <= 1e-5) {
    return 1.0;
  }
  let ndc = clip.xyz / clip.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || ndc.z > 1.0) {
    return 1.0;
  }
  let range = vec4f(u.occluder.y, u.occluder.z, 1.0, 0.0);
  let distance = strandShadowLinearDepth(ndc.z, range) - u.occluder.w;
  let size = vec2i(textureDimensions(occluderDepth));
  let position = uv * vec2f(size) - 0.5;
  let origin = vec2i(floor(position));
  let f = position - floor(position);
  var lit = 0.0;
  for (var corner = 0; corner < 4; corner++) {
    let offset = vec2i(corner & 1, corner >> 1);
    let blocker = strandShadowLinearDepth(textureLoad(occluderDepth, clamp(origin + offset, vec2i(0), size - vec2i(1)), 0), range);
    let w = select(1.0 - f.x, f.x, offset.x == 1) * select(1.0 - f.y, f.y, offset.y == 1);
    lit += w * select(1.0, 0.0, blocker < distance);
  }
  return mix(1.0, lit, u.shadow.w);
}

// Share of the light blocked by fibers that still arrives scattered forward through them.
const DUAL_SCATTER_FORWARD: f32 = 0.6;

/**
 * Dual scattering (Zinke 2008), raster approximation: the deep opacity map gives how many fibers lie
 * between the light and `p`; the direct share passes them unscattered, the scattered share arrives
 * tinted by the fiber color once per two fibers. Bright yarn stays bright and saturated in its depth
 * instead of turning gray, as in the path tracer. Opaque meshes still block all of it.
 */
fn shadowScatter(p: vec3f) -> vec3f {
  let direct = strandShadowTransmittance(p, u.shadowMatrix, u.shadow.y, u.shadow.w, u.shadowRange, SHADOW_BIAS,
    shadowDepth, shadowOpacity, shadowSampler);
  let fibers = -log(max(direct, 1e-4)) / max(u.shadow.z, 0.01);
  let scattered = pow(clamp(strandShadeColor, vec3f(1e-3), vec3f(1.0)), vec3f(0.5 * fibers + 1.0)) * (1.0 - direct) * DUAL_SCATTER_FORWARD;
  return (vec3f(direct) + scattered) * occluderVisibility(p);
}

/**
 * Opacity pass: a fiber fragment adds its coverage to every layer whose far edge lies behind it,
 * so layer k holds the opacity up to k + 1 layer spacings behind the nearest fiber.
 */
@fragment
fn strandOpacityFragment(in: VertexOutput) -> @location(0) vec4f {
  let nearest = strandShadowLinearDepth(textureLoad(shadowDepth, vec2i(in.position.xy), 0), u.shadowRange);
  let layer = (strandShadowLinearDepth(in.position.z, u.shadowRange) - nearest) / u.shadow.y;
  return step(vec4f(layer), vec4f(1.0, 2.0, 3.0, 4.0)) * in.coverage * u.shadow.z;
}

/** Kajiya-Kay style highlight around a tangent tilted by `shift` along the fiber normal. */
fn specularLobe(tangent: vec3f, normal: vec3f, halfway: vec3f, shift: f32, exponent: f32) -> f32 {
  let shifted = normalize(tangent + normal * shift);
  let th = dot(shifted, halfway);
  return pow(sqrt(max(0.0, 1.0 - th * th)), exponent);
}

/**
 * One light on a fiber. Diffuse blends Kajiya-Kay (thin fibers) with wrapped Lambert on the
 * reconstructed cylinder normal (fibers several pixels wide), so close-ups read as round tubes.
 * Two shifted lobes follow Marschner 2003 / Karis 2016: R (white, toward the root) and TRT
 * (tinted, toward the tip); TT lets a light behind the fiber shine through it.
 */
fn shadeFiber(tangent: vec3f, normal: vec3f, view: vec3f, light: vec3f, tube: f32) -> vec3f {
  let tl = dot(tangent, light);
  let kajiya = sqrt(max(0.0, 1.0 - tl * tl));
  let wrapped = max(0.0, (dot(normal, light) + 0.35) / 1.35);
  let diffuse = mix(kajiya, wrapped, tube);
  let halfway = normalize(light + view);
  // Rougher points (Roughness Scale > 1) widen both lobes.
  let widen = 1.0 / max(strandShadeRoughness * strandShadeRoughness, 0.05);
  let r = specularLobe(tangent, normal, halfway, u.look2.y, u.look.x * widen);
  let trt = specularLobe(tangent, normal, halfway, u.look2.z, u.look.y * widen);
  let tt = pow(max(0.0, -dot(view, light)), 6.0) * kajiya;
  return strandShadeColor * (diffuse + u.look.w * trt + u.look2.x * tt) + u.look.z * r * u.coat.rgb;
}

/**
 * Environment irradiance at a fiber: the cylinder normal for wide fibers; thin fibers see the
 * average around their axis, where the linear term cancels.
 */
fn environmentAmbient(normal: vec3f, tube: f32) -> vec3f {
  if (u.irradiance[0].w < 0.5) {
    return vec3f(0.0);
  }
  let linear = vec3f(dot(u.irradiance[1].xyz, normal), dot(u.irradiance[2].xyz, normal), dot(u.irradiance[3].xyz, normal));
  return max(u.irradiance[0].rgb + linear * tube, vec3f(0.0));
}

/**
 * Lit color of a fiber at one point of its ribbon. `across` runs from -1 to 1 over the ribbon width,
 * `widthAxis` is the world direction of its +1 side and `pixels` the projected fiber width.
 */
fn shadeStrandPoint(tangentIn: vec3f, toCamera: vec3f, acrossIn: f32, widthAxis: vec3f, pixels: f32) -> vec3f {
  let tangent = normalize(tangentIn);
  let view = normalize(toCamera);
  // Cylinder normal across the ribbon: the width axis at the edges, facing the viewer in the middle.
  let across = clamp(acrossIn, -1.0, 1.0);
  let facingRaw = view - tangent * dot(view, tangent);
  let facing = select(view, normalize(facingRaw), dot(facingRaw, facingRaw) > 1e-12);
  let widthRaw = widthAxis - tangent * dot(widthAxis, tangent);
  let width = select(cross(tangent, facing), normalize(widthRaw), dot(widthRaw, widthRaw) > 1e-12);
  let profile = sqrt(max(0.0, 1.0 - across * across));
  let normal = normalize(width * across + facing * profile);
  let tube = smoothstep(1.5, 4.0, pixels);
  // Ambient darkens toward the silhouette of wide fibers, like occlusion between neighbours.
  let occlusion = mix(1.0, mix(0.55, 1.0, profile), tube);
  let position = u.camera.xyz - toCamera;
  let shadowed = i32(u.shadow.x + 0.5);
  if (u.ambient.w < 0.0) {
    let visibility = select(vec3f(1.0), shadowScatter(position), shadowed == 1);
    return u.light.w * strandShadeColor * occlusion
      + (1.0 - u.light.w) * visibility * shadeFiber(tangent, normal, view, normalize(u.light.xyz), tube);
  }
  // Scene lights, with the MeshPass falloff and panel direction.
  var rgb = (u.ambient.rgb + environmentAmbient(normal, tube)) * strandShadeColor * occlusion;
  let count = i32(u.ambient.w + 0.5);
  for (var index = 0; index < 4; index++) {
    if (index >= count) {
      break;
    }
    let light = u.lights[index];
    let toLight = light.positionKind.xyz - position;
    let distance = max(length(toLight), 0.001);
    let direction = toLight / distance;
    var attenuation = 1.0 / (1.0 + pow(distance / max(light.directionDiameter.w, 0.001), 2.0));
    if (light.positionKind.w > 1.5) {
      attenuation *= max(dot(-direction, normalize(light.directionDiameter.xyz)), 0.0);
    }
    let visibility = select(vec3f(1.0), shadowScatter(position), shadowed == index + 2);
    rgb += light.colorIntensity.rgb * light.colorIntensity.a * attenuation * visibility * shadeFiber(tangent, normal, view, direction, tube);
  }
  return min(rgb, vec3f(8.0));
}

@fragment
fn strandFragment(in: VertexOutput) -> @location(0) vec4f {
  if (u.twist.w < 0.5 && in.coverage < 1.0 && hash3(u32(in.position.x), u32(in.position.y), in.segment) >= in.coverage) {
    discard;
  }
  strandShadeColor = in.look.rgb;
  strandShadeRoughness = in.look.a;
  // 4x coverage turns alpha into the sample mask; hashed rendering is opaque per fragment.
  return vec4f(shadeStrandPoint(in.tangent, in.toCamera, in.across, in.widthAxis, in.pixels), select(1.0, in.coverage, u.twist.w > 0.5));
}
