const MAX_APPEARANCES: u32 = 8u;
const MAX_GRADIENT_STOPS: u32 = 8u;
const MAX_REGULAR_VERTICES: u32 = 64u;
const MAX_PATH_VERTICES: u32 = 512u;
const PI: f32 = 3.141592653589793;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) localPoint: vec2f,
  @location(1) instanceOpacity: f32,
};

struct MotionUniforms {
  // shape width/height, output texture width/height
  data0: vec4f,
  // corner radius, shape type, appearance count, maximum stroke padding
  data1: vec4f,
  // polygon points/radius/corner radius, star points
  data2: vec4f,
  // star outer radius/inner radius/corner radius, unused
  data3: vec4f,
  // kind, visible, opacity, blend mode
  appearanceMeta: array<vec4f, 8>,
  // stroke width/alignment, gradient stop count/radial radius
  appearanceDetail: array<vec4f, 8>,
  // linear start/end or radial center
  appearanceGeometry: array<vec4f, 8>,
  // solid fill/stroke colors
  appearanceColor: array<vec4f, 8>,
  // Eight colors per appearance.
  gradientStopColors: array<vec4f, 64>,
  // Four stop offsets per vec4.
  gradientStopOffsets: array<vec4f, 16>,
  // trim start/end/offset, dash length
  data4: vec4f,
  // dash gap/offset, flattened point count, closed flag
  data5: vec4f,
};

@group(0) @binding(0) var<uniform> motion: MotionUniforms;
@group(0) @binding(1) var textureFill: texture_2d<f32>;
@group(0) @binding(2) var textureFillSampler: sampler;
@group(0) @binding(3) var<storage, read> pathVertices: array<vec4f>;

@vertex
fn vertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @location(0) instanceMatrix: vec4f,
  @location(1) instanceTransform: vec4f
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
  let drawSize = shapeSize + vec2f(max(0.0, motion.data1.w) * 2.0);
  let localPoint = (uv - vec2f(0.5)) * drawSize;
  let outputPoint = vec2f(
    instanceMatrix.x * localPoint.x + instanceMatrix.y * localPoint.y,
    instanceMatrix.z * localPoint.x + instanceMatrix.w * localPoint.y
  ) + instanceTransform.xy;

  var output: VertexOutput;
  output.position = vec4f(
    outputPoint.x / outputSize.x * 2.0,
    -outputPoint.y / outputSize.y * 2.0,
    0.0,
    1.0
  );
  output.localPoint = localPoint;
  output.instanceOpacity = instanceTransform.z;
  return output;
}

fn sdRoundBox(point: vec2f, halfSize: vec2f, radius: f32) -> f32 {
  let clampedRadius = min(max(radius, 0.0), min(halfSize.x, halfSize.y));
  let q = abs(point) - halfSize + vec2f(clampedRadius);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - clampedRadius;
}

fn sdEllipse(point: vec2f, radius: vec2f) -> f32 {
  let safeRadius = max(radius, vec2f(0.001));
  let scaled = point / safeRadius;
  return (length(scaled) - 1.0) * min(safeRadius.x, safeRadius.y);
}

fn regularVertex(
  index: u32,
  vertexCount: u32,
  outerRadius: f32,
  innerRadius: f32,
  isStar: bool
) -> vec2f {
  let angle = -PI * 0.5 + (f32(index) / f32(vertexCount)) * PI * 2.0;
  let useInner = isStar && index % 2u == 1u;
  let radius = select(outerRadius, innerRadius, useInner);
  return vec2f(cos(angle), sin(angle)) * radius;
}

fn sdRegularShape(
  point: vec2f,
  pointCountInput: f32,
  outerRadiusInput: f32,
  innerRadiusInput: f32,
  cornerRadiusInput: f32,
  isStar: bool
) -> f32 {
  let pointCount = u32(clamp(round(pointCountInput), 3.0, 32.0));
  let vertexCount = select(pointCount, pointCount * 2u, isStar);
  let cornerRadius = max(0.0, cornerRadiusInput);
  let outerRadius = max(1.0, outerRadiusInput - cornerRadius);
  let innerRadius = max(0.5, min(innerRadiusInput, outerRadiusInput) - cornerRadius);
  var previous = regularVertex(
    vertexCount - 1u,
    vertexCount,
    outerRadius,
    innerRadius,
    isStar
  );
  var minimumSquaredDistance = 1e20;
  var inside = false;

  for (var index = 0u; index < MAX_REGULAR_VERTICES; index += 1u) {
    if (index < vertexCount) {
      let current = regularVertex(
        index,
        vertexCount,
        outerRadius,
        innerRadius,
        isStar
      );
      let edge = previous - current;
      let toPoint = point - current;
      let projected = toPoint - edge * clamp(
        dot(toPoint, edge) / max(dot(edge, edge), 0.0001),
        0.0,
        1.0
      );
      minimumSquaredDistance = min(
        minimumSquaredDistance,
        dot(projected, projected)
      );

      let crosses = (current.y > point.y) != (previous.y > point.y);
      if (crosses) {
        let crossingX = (
          (previous.x - current.x) * (point.y - current.y)
          / (previous.y - current.y)
        ) + current.x;
        if (point.x < crossingX) {
          inside = !inside;
        }
      }
      previous = current;
    }
  }

  let distance = sqrt(max(minimumSquaredDistance, 0.0));
  return select(distance, -distance, inside) - cornerRadius;
}

fn sdPathShape(point: vec2f) -> vec2f {
  let count = u32(clamp(round(motion.data5.z), 0.0, f32(MAX_PATH_VERTICES)));
  let closed = motion.data5.w > 0.5;
  var minimumSquaredDistance = 1e20;
  var nearestArc = 0.0;
  var inside = false;

  for (var index = 0u; index < MAX_PATH_VERTICES; index += 1u) {
    if (index + 1u >= count) {
      break;
    }
    let start = pathVertices[index];
    let end = pathVertices[index + 1u];
    let edge = end.xy - start.xy;
    let edgeLengthSquared = max(dot(edge, edge), 0.0001);
    let t = clamp(dot(point - start.xy, edge) / edgeLengthSquared, 0.0, 1.0);
    let projected = point - (start.xy + edge * t);
    let squaredDistance = dot(projected, projected);
    if (squaredDistance < minimumSquaredDistance) {
      minimumSquaredDistance = squaredDistance;
      nearestArc = start.z + t * (end.z - start.z);
    }

    if (closed) {
      let crosses = (start.y > point.y) != (end.y > point.y);
      if (crosses) {
        let crossingX = (
          (end.x - start.x) * (point.y - start.y)
          / (end.y - start.y)
        ) + start.x;
        if (point.x < crossingX) {
          inside = !inside;
        }
      }
    }
  }

  let distance = sqrt(max(minimumSquaredDistance, 0.0));
  return vec2f(select(distance, -distance, closed && inside), nearestArc);
}

fn shapeDistance(localPoint: vec2f) -> f32 {
  let shapeSize = max(motion.data0.xy, vec2f(1.0));
  let halfSize = shapeSize * 0.5;
  let shapeType = motion.data1.y;
  if (shapeType < 0.5) {
    return sdRoundBox(localPoint, halfSize, motion.data1.x);
  }
  if (shapeType < 1.5) {
    return sdEllipse(localPoint, halfSize);
  }
  if (shapeType < 2.5) {
    return sdRegularShape(
      localPoint,
      motion.data2.x,
      motion.data2.y,
      motion.data2.y,
      motion.data2.z,
      false
    );
  }
  if (shapeType < 3.5) {
    return sdRegularShape(
      localPoint,
      motion.data2.w,
      motion.data3.x,
      motion.data3.y,
      motion.data3.z,
      true
    );
  }
  return sdPathShape(localPoint).x;
}

fn gradientOffset(flatIndex: u32) -> f32 {
  let packed = motion.gradientStopOffsets[flatIndex / 4u];
  let component = flatIndex % 4u;
  if (component == 0u) {
    return packed.x;
  }
  if (component == 1u) {
    return packed.y;
  }
  if (component == 2u) {
    return packed.z;
  }
  return packed.w;
}

fn sampleGradient(appearanceIndex: u32, amountInput: f32) -> vec4f {
  let stopCount = u32(clamp(
    round(motion.appearanceDetail[appearanceIndex].z),
    0.0,
    f32(MAX_GRADIENT_STOPS)
  ));
  if (stopCount == 0u) {
    return vec4f(0.0);
  }

  let baseIndex = appearanceIndex * MAX_GRADIENT_STOPS;
  let amount = clamp(amountInput, 0.0, 1.0);
  var previousOffset = gradientOffset(baseIndex);
  var previousColor = motion.gradientStopColors[baseIndex];
  var sampled = previousColor;
  var resolved = amount <= previousOffset;

  for (var stopIndex = 1u; stopIndex < MAX_GRADIENT_STOPS; stopIndex += 1u) {
    if (stopIndex < stopCount) {
      let flatIndex = baseIndex + stopIndex;
      let currentOffset = gradientOffset(flatIndex);
      let currentColor = motion.gradientStopColors[flatIndex];
      if (!resolved && amount <= currentOffset) {
        let span = max(currentOffset - previousOffset, 0.0001);
        sampled = mix(
          previousColor,
          currentColor,
          clamp((amount - previousOffset) / span, 0.0, 1.0)
        );
        resolved = true;
      }
      if (!resolved) {
        sampled = currentColor;
      }
      previousOffset = currentOffset;
      previousColor = currentColor;
    }
  }
  return sampled;
}

fn strokeCoverage(distance: f32, width: f32, alignment: f32, aa: f32) -> f32 {
  let centerBand = 1.0 - smoothstep(
    width * 0.5 - aa,
    width * 0.5 + aa,
    abs(distance)
  );
  let fillCoverage = 1.0 - smoothstep(-aa, aa, distance);
  let insideBand = fillCoverage * smoothstep(
    -width - aa,
    -width + aa,
    distance
  );
  let outsideBand = smoothstep(-aa, aa, distance) * (
    1.0 - smoothstep(width - aa, width + aa, distance)
  );
  if (alignment > 1.5) {
    return outsideBand;
  }
  if (alignment > 0.5) {
    return insideBand;
  }
  return centerBand;
}

fn sampleAppearance(
  appearanceIndex: u32,
  localPoint: vec2f,
  signedDistance: f32,
  nearestArc: f32,
  aa: f32
) -> vec4f {
  let itemMeta = motion.appearanceMeta[appearanceIndex];
  if (itemMeta.y < 0.5 || itemMeta.z <= 0.0) {
    return vec4f(0.0);
  }

  let kind = itemMeta.x;
  var coverage = 1.0 - smoothstep(-aa, aa, signedDistance);
  var color = motion.appearanceColor[appearanceIndex];

  // Appearance kinds: 0 color fill, 1 stroke, 2 linear gradient,
  // 3 radial gradient, 4 texture fill. Color fill (0) must stay on the
  // default color path; texture fill (4) must not fall into the gradient
  // branch.
  if (kind > 0.5 && kind < 1.5) {
    let detail = motion.appearanceDetail[appearanceIndex];
    coverage = strokeCoverage(
      signedDistance,
      max(0.0, detail.x),
      detail.y,
      aa
    );
    if (motion.data1.y >= 3.5) {
      let count = u32(clamp(round(motion.data5.z), 0.0, f32(MAX_PATH_VERTICES)));
      if (count >= 2u) {
        let totalLength = pathVertices[count - 1u].z;
        if (totalLength > 0.0) {
          var effectiveArc = nearestArc + motion.data4.z * totalLength;
          if (motion.data5.w > 0.5) {
            effectiveArc = fract(effectiveArc / totalLength) * totalLength;
          }
          let arcAa = max(fwidth(nearestArc), 1.0);
          let trimStart = motion.data4.x;
          let trimEnd = motion.data4.y;
          if (!(trimStart <= 0.0 && trimEnd >= 1.0)) {
            let windowStart = trimStart * totalLength;
            let windowEnd = trimEnd * totalLength;
            coverage *= smoothstep(
              windowStart - arcAa,
              windowStart + arcAa,
              effectiveArc
            ) * (1.0 - smoothstep(
              windowEnd - arcAa,
              windowEnd + arcAa,
              effectiveArc
            ));
          }

          let dashLength = motion.data4.w;
          if (dashLength > 0.0) {
            let period = dashLength + max(motion.data5.x, 0.0);
            let dashArc = effectiveArc + motion.data5.y;
            let bandPosition = dashArc - floor(dashArc / period) * period;
            coverage *= smoothstep(
              -arcAa,
              arcAa,
              bandPosition
            ) * (1.0 - smoothstep(
              dashLength - arcAa,
              dashLength + arcAa,
              bandPosition
            ));
          }
        }
      }
    }
  } else if (kind > 1.5 && kind < 3.5) {
    let shapeSize = max(motion.data0.xy, vec2f(1.0));
    let normalizedPoint = localPoint / shapeSize + vec2f(0.5);
    let geometry = motion.appearanceGeometry[appearanceIndex];
    var amount = 0.0;
    if (kind < 2.5) {
      let direction = geometry.zw - geometry.xy;
      amount = dot(normalizedPoint - geometry.xy, direction)
        / max(dot(direction, direction), 0.0001);
    } else if (kind < 3.5) {
      let radius = max(
        motion.appearanceDetail[appearanceIndex].w,
        0.0001
      );
      amount = distance(normalizedPoint, geometry.xy) / radius;
    }
    color = sampleGradient(appearanceIndex, amount);
  } else if (kind > 3.5) {
    let shapeSize = max(motion.data0.xy, vec2f(1.0));
    let detail = motion.appearanceDetail[appearanceIndex];
    let geometry = motion.appearanceGeometry[appearanceIndex];
    let scale = vec2f(
      select(geometry.z, 1.0, abs(geometry.z) < 0.0001),
      select(geometry.w, 1.0, abs(geometry.w) < 0.0001)
    );
    let normalizedPoint = localPoint / shapeSize + vec2f(0.5);
    let translated = (normalizedPoint - vec2f(0.5) - geometry.xy) / scale;
    let radians = -detail.w * PI / 180.0;
    let rotated = vec2f(
      translated.x * cos(radians) - translated.y * sin(radians),
      translated.x * sin(radians) + translated.y * cos(radians)
    ) + vec2f(0.5);
    let fitMode = detail.x;
    let shapeAspect = shapeSize.x / max(shapeSize.y, 0.0001);
    let textureAspect = max(detail.z, 0.0001);
    var uv = rotated;
    var textureCoverage = 1.0;
    if (fitMode > 4.5) {
      uv = fract(rotated);
    } else if (fitMode < 4.5) {
      // contain preserves the whole image; cover/fill crop to preserve aspect.
      let contain = fitMode < 1.5;
      let aspectScale = textureAspect / shapeAspect;
      var display = vec2f(1.0);
      if (textureAspect >= shapeAspect) {
        display = select(
          vec2f(aspectScale, 1.0),
          vec2f(1.0, 1.0 / aspectScale),
          contain
        );
      } else {
        display = select(
          vec2f(1.0, 1.0 / aspectScale),
          vec2f(aspectScale, 1.0),
          contain
        );
      }
      uv = (rotated - (vec2f(1.0) - display) * 0.5) / display;
      textureCoverage = select(
        0.0,
        1.0,
        uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0
      );
    } else {
      textureCoverage = select(
        0.0,
        1.0,
        uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0
      );
    }
    color = textureSample(textureFill, textureFillSampler, uv);
    coverage *= textureCoverage;
  }

  // Path v1 applies trim/dash to strokes only; open paths have no fill.
  if (
    motion.data1.y >= 3.5
    && motion.data5.w < 0.5
    && !(kind > 0.5 && kind < 1.5)
  ) {
    coverage = 0.0;
  }

  return vec4f(
    color.rgb,
    coverage * color.a * clamp(itemMeta.z, 0.0, 1.0)
  );
}

fn blendRgb(source: vec3f, backdrop: vec3f, mode: f32) -> vec3f {
  if (mode < 0.5) {
    return source;
  }
  if (mode < 1.5) {
    return source * backdrop;
  }
  if (mode < 2.5) {
    return vec3f(1.0) - (vec3f(1.0) - source) * (vec3f(1.0) - backdrop);
  }
  if (mode < 3.5) {
    return min(vec3f(1.0), source + backdrop);
  }
  if (mode < 4.5) {
    return select(
      vec3f(1.0) - 2.0 * (vec3f(1.0) - backdrop) * (vec3f(1.0) - source),
      2.0 * backdrop * source,
      backdrop <= vec3f(0.5)
    );
  }
  return abs(backdrop - source);
}

fn compositeAppearance(top: vec4f, bottom: vec4f, mode: f32) -> vec4f {
  let alpha = top.a + bottom.a * (1.0 - top.a);
  if (alpha <= 0.0001) {
    return vec4f(0.0);
  }
  let blended = blendRgb(top.rgb, bottom.rgb, mode);
  let premultiplied = (
    bottom.rgb * bottom.a * (1.0 - top.a)
    + top.rgb * top.a * (1.0 - bottom.a)
    + blended * top.a * bottom.a
  );
  return vec4f(premultiplied / alpha, alpha);
}

fn sampleShape(localPoint: vec2f, instanceOpacity: f32) -> vec4f {
  var distanceToShape = 0.0;
  var nearestArc = -1.0;
  if (motion.data1.y >= 3.5) {
    let pathDistance = sdPathShape(localPoint);
    distanceToShape = pathDistance.x;
    nearestArc = pathDistance.y;
  } else {
    distanceToShape = shapeDistance(localPoint);
  }
  let aa = max(fwidth(distanceToShape), 1.0);
  let appearanceCount = u32(clamp(
    round(motion.data1.z),
    0.0,
    f32(MAX_APPEARANCES)
  ));
  var result = vec4f(0.0);

  for (var index = 0u; index < MAX_APPEARANCES; index += 1u) {
    if (index < appearanceCount) {
      let appearance = sampleAppearance(
        index,
        localPoint,
        distanceToShape,
        nearestArc,
        aa
      );
      result = compositeAppearance(
        appearance,
        result,
        motion.appearanceMeta[index].w
      );
    }
  }

  result.a *= clamp(instanceOpacity, 0.0, 1.0);
  return result;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4f {
  return sampleShape(input.localPoint, input.instanceOpacity);
}
