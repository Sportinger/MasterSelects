struct EdgeFillParams { opacity: f32, available: f32, canvasSpace: f32, seamRadius: f32, row0: vec4f, row1: vec4f };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: EdgeFillParams;
@group(0) @binding(5) var fillTex: texture_2d<u32>;

fn fillPixel(p: vec2i) -> vec4f {
  return unpack4x8unorm(textureLoad(fillTex, clamp(p, vec2i(0), vec2i(textureDimensions(fillTex)) - 1), 0).r);
}
fn fillAt(point: vec2f) -> vec4f {
  let coord = point * vec2f(textureDimensions(fillTex)) - 0.5;
  let base = vec2i(floor(coord));
  let f = fract(coord);
  return mix(mix(fillPixel(base), fillPixel(base + vec2i(1, 0)), f.x),
    mix(fillPixel(base + vec2i(0, 1)), fillPixel(base + vec2i(1, 1)), f.x), f.y);
}
fn sourceUv(point: vec2f) -> vec2f {
  var uv = point;
  if (params.canvasSpace > 0.5) { uv = vec2f(dot(params.row0.xyz, vec3f(uv, 1.0)), dot(params.row1.xyz, vec3f(uv, 1.0))); }
  return uv;
}
fn originalAt(point: vec2f) -> vec4f {
  let uv = sourceUv(point);
  let visible = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0));
  return textureSampleLevel(inputTex, texSampler, uv, 0.0) * select(0.0, 1.0, visible);
}
@fragment
fn aiEdgeFillFragment(input: VertexOutput) -> @location(0) vec4f {
  let source = originalAt(input.uv);
  if (params.available < 0.5 || source.a >= 1.0 || params.opacity <= 0.0) { return source; }
  let fill = fillAt(input.uv);
  // Seam Blend: near the photo, shift the fill's colour by how far the model's colours drift from the
  // photo's (photo minus fill, averaged over the photo pixels in a disc around this pixel). The fill keeps
  // its own detail. The shift is full next to the photo and gone at the Seam Blend distance: its strength
  // follows the distance to the nearest photo sample (so photo corners and wedges get it too) or the share
  // of the disc the photo covers, whichever is larger. Opaque photo pixels are never touched.
  var fillRgb = fill.rgb;
  let dims = vec2f(textureDimensions(inputTex));
  let aspect = dims.x / dims.y;
  let uv = sourceUv(input.uv);
  var outside = uv - clamp(uv, vec2f(0.0), vec2f(1.0));
  if (params.canvasSpace > 0.5) {
    let a = params.row0.x; let b = params.row0.y;
    let d = params.row1.x; let e = params.row1.y;
    // A degenerate (zero-area) placement must not divide by zero and turn the seam NaN.
    let det = a * e - b * d;
    outside = vec2f(e * outside.x - b * outside.y, a * outside.y - d * outside.x) / (select(-1.0, 1.0, det >= 0.0) * max(abs(det), 0.000001));
  }
  // Far outside the image footprint there cannot be an adjacent source edge.
  if (params.seamRadius > 0.0 && length(outside / vec2f(1.0, aspect)) <= params.seamRadius) {
    var drift = vec3f(0.0);
    var covered = 0.0;
    var total = 0.0;
    var nearest = 2.0;
    // Per-pixel turns of the sample angle and ring radius (interleaved gradient noise) turn the steps a fixed
    // pattern would leave, as the disc slides over the photo edge, into fine grain.
    let turn = fract(52.9829189 * fract(dot(input.position.xy, vec2f(0.06711056, 0.00583715))));
    let shift = fract(52.9829189 * fract(dot(input.position.xy + vec2f(17.0, 59.0), vec2f(0.06711056, 0.00583715))));
    let fillSize = vec2f(textureDimensions(fillTex));
    for (var ring = 1u; ring <= 6u; ring++) {
      let reach = (f32(ring) - 1.0 + max(shift, 0.05)) / 6.0;
      let radius = params.seamRadius * reach;
      for (var direction = 0u; direction < 8u; direction++) {
        // Every other ring turns by half a step, so the 48 samples cover the disc evenly.
        let angle = (f32(direction) + 0.5 * f32(ring & 1u) + turn) * 0.785398163;
        let point = input.uv + vec2f(cos(angle), sin(angle) * aspect) * radius;
        // Beyond the frame there is neither photo nor fill: such samples do not count.
        if (any(point < vec2f(0.0)) || any(point > vec2f(1.0))) { continue; }
        let edge = originalAt(point);
        total += 1.0;
        if (edge.a >= 0.999) {
          // The drift only carries low frequencies: the nearest fill pixel is enough (one read instead of four).
          drift += edge.rgb - fillPixel(vec2i(point * fillSize)).rgb;
          covered += 1.0;
          nearest = min(nearest, reach);
        }
      }
    }
    if (covered > 0.0) {
      // Beside a straight edge about half the disc is photo; at a corner less, but a photo sample is still close.
      let weight = max(smoothstep(0.0, 1.0, min(1.0, 2.0 * covered / total)), smoothstep(0.0, 1.0, 1.0 - nearest));
      fillRgb = clamp(fill.rgb + drift / covered * weight, vec3f(0.0), vec3f(1.0));
    }
  }
  let fillAlpha = fill.a * params.opacity * (1.0 - source.a);
  let alpha = source.a + fillAlpha;
  return vec4f((source.rgb * source.a + fillRgb * fillAlpha) / max(alpha, 0.00001), alpha);
}
