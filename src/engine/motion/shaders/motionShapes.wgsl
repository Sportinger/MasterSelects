struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0)
  );

  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  var output: VertexOutput;
  output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
  output.uv = uvs[vertexIndex];
  return output;
}

struct MotionUniforms {
  // shape width/height, output texture width/height
  data0: vec4f,
  // corner radius, shape type, fill opacity, stroke opacity
  data1: vec4f,
  fillColor: vec4f,
  strokeColor: vec4f,
  // stroke width, stroke visible, stroke alignment, unused
  data2: vec4f,
};

@group(0) @binding(0) var<uniform> motion: MotionUniforms;

fn sdRoundBox(point: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let clampedRadius = min(radius, min(halfSize.x, halfSize.y));
  let q = abs(point) - halfSize + vec2f(clampedRadius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - clampedRadius;
}

fn sdEllipse(point: vec2f, radius: vec2f) -> f32 {
  let safeRadius = max(radius, vec2f(0.001));
  let scaled = point / safeRadius;
  return (length(scaled) - 1.0) * min(safeRadius.x, safeRadius.y);
}

fn over(top: vec4f, bottom: vec4f) -> vec4f {
  let alpha = top.a + bottom.a * (1.0 - top.a);
  let rgb = (top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a)) / max(alpha, 0.0001);
  return vec4f(rgb, alpha);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  let shapeSize = max(motion.data0.xy, vec2f(1.0));
  let outputSize = max(motion.data0.zw, vec2f(1.0));
  let cornerRadius = motion.data1.x;
  let shapeType = motion.data1.y;
  let fillOpacity = motion.data1.z;
  let strokeOpacity = motion.data1.w;
  let strokeWidth = max(0.0, motion.data2.x);
  let strokeVisible = motion.data2.y;
  let strokeAlignment = motion.data2.z;

  let point = (input.uv - vec2f(0.5)) * outputSize;
  let halfSize = shapeSize * 0.5;
  let distance = select(
    sdRoundBox(point, halfSize, cornerRadius),
    sdEllipse(point, halfSize),
    shapeType > 0.5
  );
  let aa = max(fwidth(distance), 1.0);

  let fillCoverage = 1.0 - smoothstep(-aa, aa, distance);
  let fillAlpha = fillCoverage * motion.fillColor.a * fillOpacity;
  let fill = vec4f(motion.fillColor.rgb, fillAlpha);

  let centerStroke = 1.0 - smoothstep(strokeWidth * 0.5 - aa, strokeWidth * 0.5 + aa, abs(distance));
  let insideBand = fillCoverage * smoothstep(-strokeWidth - aa, -strokeWidth + aa, distance);
  let outsideBand = smoothstep(-aa, aa, distance) * (1.0 - smoothstep(strokeWidth - aa, strokeWidth + aa, distance));
  let alignedStroke = select(centerStroke, insideBand, strokeAlignment > 0.5 && strokeAlignment < 1.5);
  let strokeCoverage = select(alignedStroke, outsideBand, strokeAlignment >= 1.5);
  let strokeAlpha = strokeCoverage * motion.strokeColor.a * strokeOpacity * strokeVisible;
  let stroke = vec4f(motion.strokeColor.rgb, strokeAlpha);

  return over(stroke, fill);
}
