struct EdgeFillParams { opacity: f32, available: f32, canvasSpace: f32, seamRadius: f32, row0: vec4f, row1: vec4f };
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: EdgeFillParams;
@group(0) @binding(5) var fillTex: texture_2d<u32>;

fn fillPixel(p: vec2i) -> vec4f {
  return unpack4x8unorm(textureLoad(fillTex, clamp(p, vec2i(0), vec2i(textureDimensions(fillTex)) - 1), 0).r);
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
  let coord = input.uv * vec2f(textureDimensions(fillTex)) - 0.5;
  let base = vec2i(floor(coord));
  let f = fract(coord);
  let fill = mix(mix(fillPixel(base), fillPixel(base + vec2i(1, 0)), f.x),
    mix(fillPixel(base + vec2i(0, 1)), fillPixel(base + vec2i(1, 1)), f.x), f.y);
  // Match the adjacent original color only outside its opaque silhouette.
  // Stop at the first ring with valid samples; no generated pixels overwrite opaque source pixels.
  var fillRgb = fill.rgb;
  let dims = vec2f(textureDimensions(inputTex));
  let aspect = dims.x / dims.y;
  let uv = sourceUv(input.uv);
  var outside = uv - clamp(uv, vec2f(0.0), vec2f(1.0));
  if (params.canvasSpace > 0.5) {
    let a = params.row0.x; let b = params.row0.y;
    let d = params.row1.x; let e = params.row1.y;
    outside = vec2f(e * outside.x - b * outside.y, a * outside.y - d * outside.x) / (a * e - b * d);
  }
  // Far outside the image footprint there cannot be an adjacent source edge.
  if (params.seamRadius > 0.0 && length(outside / vec2f(1.0, aspect)) <= params.seamRadius) {
    for (var ring = 1u; ring <= 4u; ring++) {
      let radius = params.seamRadius * f32(ring) / 4.0;
      var edgeSum = vec3f(0.0);
      var edgeCount = 0.0;
      for (var direction = 0u; direction < 8u; direction++) {
        let angle = f32(direction) * 0.785398163;
        let edge = originalAt(input.uv + vec2f(cos(angle), sin(angle) * aspect) * radius);
        if (edge.a >= 0.999) { edgeSum += edge.rgb; edgeCount += 1.0; }
      }
      if (edgeCount > 0.0) {
        fillRgb = mix(fill.rgb, edgeSum / edgeCount, 1.0 - smoothstep(0.0, params.seamRadius, radius));
        break;
      }
    }
  }
  let fillAlpha = fill.a * params.opacity * (1.0 - source.a);
  let alpha = source.a + fillAlpha;
  return vec4f((source.rgb * source.a + fillRgb * fillAlpha) / max(alpha, 0.00001), alpha);
}
