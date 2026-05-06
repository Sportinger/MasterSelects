struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localPoint: vec2f,
  @location(1) instanceOpacity: f32,
};

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

fn strokePadding() -> f32 {
  let strokeWidth = max(0.0, motion.data2.x);
  let strokeVisible = motion.data2.y;
  let strokeAlignment = motion.data2.z;
  if (strokeVisible < 0.5) {
    return 0.0;
  }
  if (strokeAlignment >= 1.5) {
    return strokeWidth;
  }
  if (strokeAlignment > 0.5) {
    return 0.0;
  }
  return strokeWidth * 0.5;
}

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) instanceData: vec4f
) -> VertexOutput {
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0),
    vec2f(1.0, 1.0),
    vec2f(0.0, 0.0),
    vec2f(0.0, 0.0),
    vec2f(1.0, 1.0),
    vec2f(1.0, 0.0)
  );

  let uv = uvs[vertexIndex];
  let shapeSize = max(motion.data0.xy, vec2f(1.0));
  let outputSize = max(motion.data0.zw, vec2f(1.0));
  let drawSize = shapeSize + vec2f(strokePadding() * 2.0);
  let localPoint = (uv - vec2f(0.5)) * drawSize;
  let outputPoint = localPoint + instanceData.xy;

  var output: VertexOutput;
  output.position = vec4f(
    outputPoint.x / outputSize.x * 2.0,
    -outputPoint.y / outputSize.y * 2.0,
    0.0,
    1.0
  );
  output.localPoint = localPoint;
  output.instanceOpacity = instanceData.z;
  return output;
}

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

fn sampleShape(localPoint: vec2f, instanceOpacity: f32) -> vec4f {
  let shapeSize = max(motion.data0.xy, vec2f(1.0));
  let cornerRadius = motion.data1.x;
  let shapeType = motion.data1.y;
  let fillOpacity = motion.data1.z;
  let strokeOpacity = motion.data1.w;
  let strokeWidth = max(0.0, motion.data2.x);
  let strokeVisible = motion.data2.y;
  let strokeAlignment = motion.data2.z;

  let halfSize = shapeSize * 0.5;
  let distance = select(
    sdRoundBox(localPoint, halfSize, cornerRadius),
    sdEllipse(localPoint, halfSize),
    shapeType > 0.5
  );
  let aa = max(fwidth(distance), 1.0);

  let fillCoverage = 1.0 - smoothstep(-aa, aa, distance);
  let fillAlpha = fillCoverage * motion.fillColor.a * fillOpacity * instanceOpacity;
  let fill = vec4f(motion.fillColor.rgb, fillAlpha);

  let centerStroke = 1.0 - smoothstep(strokeWidth * 0.5 - aa, strokeWidth * 0.5 + aa, abs(distance));
  let insideBand = fillCoverage * smoothstep(-strokeWidth - aa, -strokeWidth + aa, distance);
  let outsideBand = smoothstep(-aa, aa, distance) * (1.0 - smoothstep(strokeWidth - aa, strokeWidth + aa, distance));
  let alignedStroke = select(centerStroke, insideBand, strokeAlignment > 0.5 && strokeAlignment < 1.5);
  let strokeCoverage = select(alignedStroke, outsideBand, strokeAlignment >= 1.5);
  let strokeAlpha = strokeCoverage * motion.strokeColor.a * strokeOpacity * strokeVisible * instanceOpacity;
  let stroke = vec4f(motion.strokeColor.rgb, strokeAlpha);

  return over(stroke, fill);
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return sampleShape(input.localPoint, input.instanceOpacity);
}
