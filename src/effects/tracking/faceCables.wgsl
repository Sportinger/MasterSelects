struct Cable { bounds: vec4f, style: vec4f, color: vec4f, points: array<vec4f, 97>, shadowBounds: vec4f, shadowStyle: vec4f, shadowPoints: array<vec4f, 25> }
struct Params { display: vec4f, cables: array<Cable, 32> }
@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;

fn segmentDelta(p: vec2f, a: vec2f, b: vec2f) -> vec2f {
  let ab = b - a;
  return p - (a + ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0));
}
@fragment fn faceCablesFragment(input: VertexOutput) -> @location(0) vec4f {
  var result = textureSample(inputTex, texSampler, input.uv);
  let p = input.uv * params.display.xy;
  // Receive all shadows on the input image before drawing any cable on top.
  var shadowCoverage = 0.0;
  if (params.display.w > 0.0) {
    for (var cable = 0u; cable < min(u32(params.display.z), 32u); cable++) {
      let bounds = params.cables[cable].shadowBounds;
      if (params.cables[cable].shadowStyle.x < 0.5 || any(p < bounds.xy) || any(p > bounds.zw)) { continue; }
      for (var node = 0u; node < 24u; node++) {
        let a = params.cables[cable].shadowPoints[node];
        let b = params.cables[cable].shadowPoints[node + 1u];
        if (a.z < 0.0 || b.z < 0.0) { continue; }
        let ab = b.xy - a.xy;
        let t = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 0.00001), 0.0, 1.0);
        let r = mix(a.z, b.z, t); let blur = mix(a.w, b.w, t);
        let distance = length(segmentDelta(p, a.xy, b.xy));
        let coverage = (1.0 - smoothstep(max(0.0, r - blur), r + blur * 2.0, distance)) * r / (r + blur * 0.5);
        shadowCoverage = max(shadowCoverage, coverage);
      }
    }
    result = vec4f(result.rgb * (1.0 - shadowCoverage * params.display.w), result.a);
  }
  for (var cable = 0u; cable < min(u32(params.display.z), 32u); cable++) {
    let bounds = params.cables[cable].bounds;
    if (params.cables[cable].style.z < 0.5 || any(p < bounds.xy) || any(p > bounds.zw)) { continue; }
    var radius = max(params.cables[cable].style.x, 0.5);
    let flat = params.cables[cable].style.w > 0.5;
    var nearest = vec2f(100000.0); var shadowDistance = 100000.0;
    for (var node = 0u; node + 1u < u32(params.cables[cable].style.y); node++) {
      let a = params.cables[cable].points[node].xy; let b = params.cables[cable].points[node + 1u].xy;
      let delta = segmentDelta(p, a, b);
      if (dot(delta, delta) < dot(nearest, nearest)) {
        nearest = delta;
        let fraction = clamp(dot(p - a, b - a) / max(dot(b - a, b - a), 0.00001), 0.0, 1.0);
        radius = max(0.5, mix(params.cables[cable].points[node].z, params.cables[cable].points[node + 1u].z, fraction));
      }
      if (!flat) { shadowDistance = min(shadowDistance, length(segmentDelta(p - vec2f(radius * 0.7, radius), a, b)) / radius); }
    }
    let distance = length(nearest);
    if (flat) {
      let coverage = 1.0 - smoothstep(max(0.0, radius - 0.5), radius + 0.5, distance);
      result = vec4f(mix(result.rgb, params.cables[cable].color.rgb, coverage), result.a + coverage * (1.0 - result.a));
      continue;
    }
    let shadow = (1.0 - smoothstep(1.0, 2.1 + 1.0 / radius, shadowDistance)) * select(0.3, 0.0, params.display.w > 0.0);
    result = vec4f(result.rgb * (1.0 - shadow), result.a);
    let outline = 1.0 - smoothstep(radius + 0.2, radius + 1.5, distance);
    result = vec4f(mix(result.rgb, vec3f(0.025, 0.03, 0.035), outline), result.a + outline * (1.0 - result.a));
    let body = 1.0 - smoothstep(radius - 1.0, radius + 0.4, distance);
    let rounded = sqrt(max(0.0, 1.0 - pow(distance / radius, 2.0)));
    let light = dot(nearest / max(distance, 0.001), normalize(vec2f(-0.6, -0.8)));
    let sheen = pow(max(0.0, 0.55 * rounded + 0.65 * light), 12.0) * 0.65;
    let color = params.cables[cable].color.rgb * (0.35 + 0.65 * rounded + 0.14 * light) + vec3f(sheen);
    result = vec4f(mix(result.rgb, color, body), result.a + body * (1.0 - result.a));
    for (var end = 0u; end < 2u; end++) {
      if ((u32(params.cables[cable].color.a) & (1u << end)) == 0u) { continue; }
      let center = params.cables[cable].points[end * (u32(params.cables[cable].style.y) - 1u)].xy;
      let radius = max(0.5, params.cables[cable].points[end * (u32(params.cables[cable].style.y) - 1u)].z);
      let d = length(p - center);
      let outer = 1.0 - smoothstep(radius * 2.2, radius * 2.2 + 1.0, d);
      let ring = 1.0 - smoothstep(radius * 0.25, radius * 0.25 + 1.0, abs(d - radius * 1.65));
      let terminal = mix(vec3f(0.045, 0.06, 0.075), vec3f(0.7, 0.8, 0.85), ring);
      result = vec4f(mix(result.rgb, terminal, outer), result.a + outer * (1.0 - result.a));
    }
  }
  return result;
}
