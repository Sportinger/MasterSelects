// Voxel Relief - brightness-driven block extrusion with temporal feedback.

struct VoxelReliefParams {
  columns: f32,
  heightScale: f32,
  baseHeight: f32,
  gap: f32,
  tilt: f32,
  yaw: f32,
  perspective: f32,
  heightContrast: f32,
  ambient: f32,
  lightStrength: f32,
  temporalBlend: f32,
  colorMix: f32,
  width: f32,
  height: f32,
  maxSteps: f32,
  reset: f32,
  lightAngle: f32,
  lightElevation: f32,
  floorBrightness: f32,
  edgeDarkness: f32,
  distance: f32,
  centerX: f32,
  centerY: f32,
  roll: f32,
  lightFollow: f32,
  limitToVideo: f32,
  pad1: f32,
  pad2: f32,
  graphHeightUV: vec4f,
  graphColorUV: vec4f,
  graphTintOpacity: vec4f,
  graphFlags: vec4f,
  graphBoxSize: vec4f,
  graphField: array<vec4f, 32>,
};

struct VoxelCell {
  center: vec2f,
  halfSize: vec3f,
  height: f32,
  color: vec4f,
  material: f32,
};

struct VoxelMapSample {
  dist: f32,
  cell: VoxelCell,
};

struct VoxelRay {
  origin: vec3f,
  direction: vec3f,
};

struct VoxelHit {
  hit: f32,
  position: vec3f,
  travel: f32,
  sample: VoxelMapSample,
};

struct VoxelScreenCell {
  center: vec2f,
  local: vec2f,
  color: vec4f,
  blockHeight: f32,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: VoxelReliefParams;
@group(0) @binding(3) var feedbackTex: texture_2d<f32>;

fn voxelHeightTexture(uv: vec2f) -> vec4f {
  return textureSampleLevel(inputTex, texSampler, clamp(uv * params.graphHeightUV.xy + params.graphHeightUV.zw, vec2f(0.0), vec2f(1.0)), 0.0);
}

fn voxelColorTexture(uv: vec2f) -> vec4f {
  let sampled = textureSampleLevel(inputTex, texSampler, clamp(uv * params.graphColorUV.xy + params.graphColorUV.zw, vec2f(0.0), vec2f(1.0)), 0.0);
  return select(vec4f(params.graphTintOpacity.rgb, 1.0), vec4f(sampled.rgb * params.graphTintOpacity.rgb, sampled.a), params.graphFlags.y > 0.5);
}

fn voxelFieldSize() -> vec2f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  return vec2f(aspect, 1.0);
}

fn voxelSourceUv(fieldUv: vec2f) -> vec2f {
  // The orbit camera uses a conventional +Y-up world, while source textures
  // use +V-down image coordinates. Keep the image upright on the voxel plane.
  return vec2f(fieldUv.x, 1.0 - fieldUv.y);
}

fn voxelCellSize(fieldSize: vec2f) -> f32 {
  return fieldSize.x / clamp(params.columns, 4.0, 240.0);
}

fn voxelSdBox(p: vec3f, halfSize: vec3f) -> f32 {
  let q = abs(p) - halfSize;
  return length(max(q, vec3f(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

fn voxelRadians(degrees: f32) -> f32 {
  return degrees * PI / 180.0;
}

fn voxelEmptyCell() -> VoxelCell {
  var cell: VoxelCell;
  cell.center = vec2f(0.0);
  cell.halfSize = vec3f(0.0);
  cell.height = 0.0;
  cell.color = vec4f(0.0);
  cell.material = 0.0;
  return cell;
}

fn voxelScreenCellSize() -> vec2f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  let cellX = 1.0 / clamp(params.columns, 4.0, 240.0);
  return vec2f(cellX, cellX * aspect);
}

fn voxelMaximumHeight() -> f32 {
  return max(select(params.baseHeight + params.heightScale, params.graphBoxSize.w, params.graphFlags.z > 0.0), 0.001);
}

fn voxelHeightFromColor(color: vec4f) -> f32 {
  if (params.graphFlags.z > 0.0) {
    return max(0.0, evaluateScalarField(luminance(color.rgb), params.graphField, u32(params.graphFlags.z), u32(params.graphFlags.w))) * color.a * params.graphBoxSize.z;
  }
  let brightness = pow(clamp(luminance(color.rgb), 0.0, 1.0), max(params.heightContrast, 0.001));
  return max(params.baseHeight, 0.0) * color.a + brightness * max(params.heightScale, 0.0) * color.a;
}

fn voxelSampleScreenCell(uv: vec2f, offset: vec2f) -> VoxelScreenCell {
  let cellSize = voxelScreenCellSize();
  let cellIndex = floor(uv / cellSize) + offset;
  let center = (cellIndex + vec2f(0.5)) * cellSize;
  let sampleUv = clamp(center, vec2f(0.0), vec2f(1.0));
  let color = voxelColorTexture(sampleUv);

  var cell: VoxelScreenCell;
  cell.center = center;
  cell.local = fract(uv / cellSize);
  cell.color = color;
  cell.blockHeight = voxelHeightFromColor(voxelHeightTexture(sampleUv));
  return cell;
}

fn voxelScreenRelief(uv: vec2f) -> vec4f {
  let cell = voxelSampleScreenCell(uv, vec2f(0.0));
  let rightCell = voxelSampleScreenCell(uv, vec2f(1.0, 0.0));
  let downCell = voxelSampleScreenCell(uv, vec2f(0.0, 1.0));
  let leftCell = voxelSampleScreenCell(uv, vec2f(-1.0, 0.0));
  let upCell = voxelSampleScreenCell(uv, vec2f(0.0, -1.0));

  let maxHeight = voxelMaximumHeight();
  let height01 = clamp(cell.blockHeight / maxHeight, 0.0, 1.0);
  let viewSlant = clamp((90.0 - clamp(params.tilt, 20.0, 88.0)) / 35.0, 0.0, 1.0);
  let perspectiveAmount = clamp((params.perspective - 0.15) / 1.45, 0.0, 1.0);
  let heightAmount = clamp(params.heightScale / 0.24, 0.0, 3.0);
  let yawBias = clamp(params.yaw / 45.0, -1.0, 1.0);
  let sideWidth = clamp((0.075 + viewSlant * 0.18 + perspectiveAmount * 0.13) * heightAmount, 0.04, 0.42);
  let gap = clamp(params.gap, 0.0, 0.42);
  let bevel = clamp(0.036 + gap * 0.24, 0.026, 0.16);
  let edgeDistance = max(abs(cell.local.x - 0.5), abs(cell.local.y - 0.5)) * 2.0;
  let gridLine = smoothstep(1.0 - bevel, 1.0, edgeDistance);

  let effectiveLightAngle = params.lightAngle + select(0.0, params.yaw, params.lightFollow > 0.5);
  let lightAzimuth = voxelRadians(effectiveLightAngle);
  let lightElevation = voxelRadians(clamp(params.lightElevation, 1.0, 89.0));
  let lightDir = normalize(vec3f(
    cos(lightAzimuth) * cos(lightElevation),
    -sin(lightAzimuth) * cos(lightElevation),
    sin(lightElevation)
  ));

  let topDiffuse = max(dot(vec3f(0.0, 0.0, 1.0), lightDir), 0.0);
  let topLight = clamp(params.ambient + topDiffuse * params.lightStrength, 0.0, 2.0);
  let sourceRgb = mix(vec3f(luminance(cell.color.rgb)), cell.color.rgb, clamp(params.colorMix, 0.0, 1.0));
  var rgb = sourceRgb * topLight;

  let rightDrop = clamp((cell.blockHeight - rightCell.blockHeight) / maxHeight, 0.0, 1.0);
  let downDrop = clamp((cell.blockHeight - downCell.blockHeight) / maxHeight, 0.0, 1.0);
  let leftRise = clamp((leftCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);
  let upRise = clamp((upCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);
  let leftDrop = clamp((cell.blockHeight - leftCell.blockHeight) / maxHeight, 0.0, 1.0);
  let rightRise = clamp((rightCell.blockHeight - cell.blockHeight) / maxHeight, 0.0, 1.0);

  let rightVisibility = clamp(0.5 + yawBias * 0.5, 0.0, 1.0);
  let leftVisibility = 1.0 - rightVisibility;
  let rightSideStrength = max(rightDrop, height01 * 0.28);
  let leftSideStrength = max(leftDrop, height01 * 0.14);
  let downSideStrength = max(downDrop, height01 * 0.34);
  let rightSide = smoothstep(1.0 - sideWidth, 1.0, cell.local.x) * rightSideStrength * mix(0.35, 1.0, rightVisibility);
  let leftSide = (1.0 - smoothstep(0.0, sideWidth, cell.local.x)) * leftSideStrength * mix(0.35, 1.0, leftVisibility);
  let downSide = smoothstep(1.0 - sideWidth, 1.0, cell.local.y) * downSideStrength;
  let shadowWidth = clamp(sideWidth * 1.45, 0.02, 0.38);
  let occlusion = (1.0 - smoothstep(0.0, shadowWidth, cell.local.x)) * leftRise * mix(0.35, 1.0, rightVisibility) +
    smoothstep(1.0 - shadowWidth, 1.0, cell.local.x) * rightRise * mix(0.35, 1.0, leftVisibility) +
    (1.0 - smoothstep(0.0, shadowWidth, cell.local.y)) * upRise;

  let sideNormalX = vec3f(1.0, 0.0, 0.22);
  let sideNormalY = vec3f(0.0, 1.0, 0.22);
  let sideLightX = clamp(params.ambient * 0.58 + max(dot(normalize(sideNormalX), lightDir), 0.0) * params.lightStrength, 0.08, 1.2);
  let sideLightY = clamp(params.ambient * 0.5 + max(dot(normalize(sideNormalY), lightDir), 0.0) * params.lightStrength, 0.06, 1.1);
  let horizontalSide = max(rightSide, leftSide);
  let sideShade = min(mix(1.0, sideLightX, horizontalSide), mix(1.0, sideLightY, downSide));
  let sideMask = clamp(max(horizontalSide, downSide), 0.0, 1.0);
  let sideRgb = sourceRgb * sideShade * mix(0.62, 0.32, clamp(params.edgeDarkness, 0.0, 1.0));

  rgb = mix(rgb, sideRgb, sideMask);
  rgb *= 1.0 - clamp(occlusion, 0.0, 1.0) * clamp(params.edgeDarkness, 0.0, 1.0) * 0.58;
  rgb *= 1.0 - gridLine * clamp(params.edgeDarkness, 0.0, 1.0) * 0.72;
  rgb += vec3f(height01 * 0.045);

  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), cell.color.a);
}

fn voxelScreenPixelColor(uv: vec2f) -> vec4f {
  let aspect = max(params.width / max(params.height, 1.0), 0.1);
  let columns = clamp(params.columns, 4.0, 240.0);
  let cellX = 1.0 / columns;
  let cellY = cellX * aspect;
  let cell = vec2f(cellX, cellY);
  let center = (floor(uv / cell) + vec2f(0.5)) * cell;
  let source = voxelColorTexture(clamp(center, vec2f(0.0), vec2f(1.0)));
  let local = abs(fract(uv / cell) - vec2f(0.5)) * 2.0;
  let grid = smoothstep(0.86, 1.0, max(local.x, local.y));
  let edgeShade = 1.0 - grid * clamp(params.edgeDarkness, 0.0, 1.0) * 0.42;
  return vec4f(source.rgb * edgeShade * clamp(params.floorBrightness, 0.0, 1.0), source.a);
}

fn voxelFloorCell(fieldSize: vec2f, p: vec3f) -> VoxelCell {
  let uv = voxelSourceUv(clamp(p.xy / fieldSize, vec2f(0.0), vec2f(1.0)));
  var cell: VoxelCell;
  cell.center = fieldSize * 0.5;
  cell.halfSize = vec3f(fieldSize * 0.5, 0.018);
  cell.height = 0.0;
  cell.color = voxelColorTexture(uv);
  cell.material = 0.0;
  return cell;
}

fn voxelCellFromIndex(index: vec2f, fieldSize: vec2f, cellSize: f32) -> VoxelCell {
  let center = (index + vec2f(0.5)) * cellSize;
  let uv = voxelSourceUv(center / fieldSize);
  let source = voxelHeightTexture(clamp(uv, vec2f(0.0), vec2f(1.0)));
  let brightness = pow(clamp(luminance(source.rgb), 0.0, 1.0), max(params.heightContrast, 0.001));
  let height = voxelHeightFromColor(source);
  let fill = clamp(1.0 - params.gap, 0.18, 1.0);

  var cell: VoxelCell;
  cell.center = center;
  cell.halfSize = vec3f(vec2f(cellSize * 0.5 * fill) * params.graphBoxSize.xy, max(height * 0.5, 0.0005));
  cell.height = max(height, 0.001);
  cell.color = voxelColorTexture(clamp(uv, vec2f(0.0), vec2f(1.0)));
  cell.material = 1.0;
  return cell;
}

fn voxelCellIsInsideVideo(index: vec2f, fieldSize: vec2f, cellSize: f32) -> bool {
  let center = (index + vec2f(0.5)) * cellSize;
  return center.x >= 0.0 && center.y >= 0.0 && center.x < fieldSize.x && center.y < fieldSize.y;
}

fn voxelMap(p: vec3f) -> VoxelMapSample {
  let fieldSize = voxelFieldSize();
  let cellSize = voxelCellSize(fieldSize);

  var best: VoxelMapSample;
  best.dist = 1.0e6;
  best.cell = voxelEmptyCell();

  let baseIndex = floor(p.xy / cellSize);
  for (var offsetY = -1; offsetY <= 1; offsetY = offsetY + 1) {
    for (var offsetX = -1; offsetX <= 1; offsetX = offsetX + 1) {
      let index = baseIndex + vec2f(f32(offsetX), f32(offsetY));
      if (params.limitToVideo < 0.5 || voxelCellIsInsideVideo(index, fieldSize, cellSize)) {
        let cell = voxelCellFromIndex(index, fieldSize, cellSize);
        let boxCenter = vec3f(cell.center, cell.height * 0.5);
        let dist = voxelSdBox(p - boxCenter, cell.halfSize);
        if (dist < best.dist) {
          best.dist = dist;
          best.cell = cell;
        }
      }
    }
  }

  if (params.limitToVideo > 0.5) {
    let floorCell = voxelFloorCell(fieldSize, p);
    let floorCenter = vec3f(floorCell.center, -floorCell.halfSize.z);
    let floorDist = voxelSdBox(p - floorCenter, floorCell.halfSize);
    if (floorDist < best.dist) {
      best.dist = floorDist;
      best.cell = floorCell;
    }
  }

  return best;
}

fn voxelCameraRay(uv: vec2f) -> VoxelRay {
  let fieldSize = voxelFieldSize();
  let focusPoint = vec3f(
    fieldSize.x * clamp(params.centerX, 0.0, 1.0),
    clamp(params.centerY, 0.0, 1.0),
    0.0
  );
  // Treat the source as an upright XY image with relief extruding along +Z.
  // Tilt 90 is face-on. Converting it to the same pitch convention as the
  // native 3D camera preserves existing effect poses while making both
  // orbit controllers use the same upright camera frame.
  let pitch = voxelRadians(params.tilt - 90.0);
  let yaw = voxelRadians(params.yaw);
  let perspective = clamp(params.perspective, 0.15, 1.6);
  let fov = voxelRadians(mix(12.0, 42.0, (perspective - 0.15) / 1.45));
  let focal = 1.0 / tan(fov * 0.5);
  let radius = max(0.9, focal * 0.5 + voxelMaximumHeight() * 0.7) *
    clamp(params.distance, 0.15, 8.0);
  let cosPitch = cos(pitch);
  let sinPitch = sin(pitch);
  let eyeDir = vec3f(sin(yaw) * cosPitch, sinPitch, cos(yaw) * cosPitch);
  let eye = focusPoint + eyeDir * radius;
  let forward = -eyeDir;
  // Match the native 3D camera basis: right remains level and up stays
  // upright while crossing either pole.
  let baseRight = vec3f(cos(yaw), 0.0, -sin(yaw));
  let baseUp = vec3f(-sin(yaw) * sinPitch, cosPitch, -cos(yaw) * sinPitch);
  let roll = voxelRadians(params.roll);
  let right = baseRight * cos(roll) + baseUp * sin(roll);
  let up = baseUp * cos(roll) - baseRight * sin(roll);

  let screenAspect = max(params.width / max(params.height, 1.0), 0.1);
  let screen = vec2f((uv.x * 2.0 - 1.0) * screenAspect, 1.0 - uv.y * 2.0);
  let direction = normalize(forward * focal + right * screen.x + up * screen.y);

  var ray: VoxelRay;
  ray.origin = eye;
  ray.direction = direction;
  return ray;
}

fn voxelSafeRayComponent(value: f32) -> f32 {
  let signedEpsilon = select(-0.000001, 0.000001, value >= 0.0);
  return select(signedEpsilon, value, abs(value) >= 0.000001);
}

fn voxelRayBoxInterval(ray: VoxelRay, boundsMin: vec3f, boundsMax: vec3f) -> vec2f {
  let safeDirection = vec3f(
    voxelSafeRayComponent(ray.direction.x),
    voxelSafeRayComponent(ray.direction.y),
    voxelSafeRayComponent(ray.direction.z)
  );
  let inverseDirection = vec3f(1.0) / safeDirection;
  let first = (boundsMin - ray.origin) * inverseDirection;
  let second = (boundsMax - ray.origin) * inverseDirection;
  let nearPlane = min(first, second);
  let farPlane = max(first, second);
  return vec2f(
    max(nearPlane.x, max(nearPlane.y, nearPlane.z)),
    min(farPlane.x, min(farPlane.y, farPlane.z))
  );
}

fn voxelTrace(ray: VoxelRay) -> VoxelHit {
  var hit: VoxelHit;
  hit.hit = 0.0;
  hit.position = ray.origin;
  hit.travel = 0.0;
  hit.sample.dist = 1.0e6;
  hit.sample.cell = voxelEmptyCell();

  let traversalBudget = i32(clamp(params.maxSteps * 4.0, 96.0, 576.0));
  let topZ = voxelMaximumHeight();
  let fieldSize = voxelFieldSize();
  let cellSize = voxelCellSize(fieldSize);
  let boundCenter = vec3f(fieldSize * 0.5, topZ * 0.5);
  let boundRadius = length(vec3f(fieldSize * 0.5, topZ * 0.5)) + 0.1;
  var sceneMin = vec3f(boundCenter.xy - vec2f(boundRadius), 0.0);
  var sceneMax = vec3f(boundCenter.xy + vec2f(boundRadius), topZ);
  if (params.limitToVideo > 0.5) {
    sceneMin = vec3f(0.0, 0.0, 0.0);
    sceneMax = vec3f(fieldSize, topZ);
  }

  let sceneInterval = voxelRayBoxInterval(ray, sceneMin, sceneMax);
  if (sceneInterval.x <= sceneInterval.y && sceneInterval.y >= 0.0) {
    var travel = max(sceneInterval.x, 0.0);
    let sceneExit = sceneInterval.y;
    let startPosition = ray.origin + ray.direction * (travel + 0.00001);
    var cellIndex = vec2i(floor(startPosition.xy / cellSize));
    let stepDirection = vec2i(
      select(-1, 1, ray.direction.x >= 0.0),
      select(-1, 1, ray.direction.y >= 0.0)
    );
    let safeDirection = vec2f(
      voxelSafeRayComponent(ray.direction.x),
      voxelSafeRayComponent(ray.direction.y)
    );
    let nextBoundary = vec2f(
      f32(cellIndex.x + select(0, 1, stepDirection.x > 0)) * cellSize,
      f32(cellIndex.y + select(0, 1, stepDirection.y > 0)) * cellSize
    );
    var nextCrossing = (nextBoundary - ray.origin.xy) / safeDirection;
    let crossingDelta = vec2f(cellSize) / abs(safeDirection);

    // Traverse grid cells front-to-back and intersect every visible prism
    // exactly. The previous sphere tracer could overestimate distance when a
    // tall cell sat outside its 3x3 neighborhood, skipping that column and
    // producing dashed side profiles.
    for (var traversalIndex = 0; traversalIndex < 576; traversalIndex = traversalIndex + 1) {
      if (traversalIndex >= traversalBudget || travel > sceneExit) {
        break;
      }

      let index = vec2f(f32(cellIndex.x), f32(cellIndex.y));
      let nextTravel = min(sceneExit, min(nextCrossing.x, nextCrossing.y));
      if (params.limitToVideo < 0.5 || voxelCellIsInsideVideo(index, fieldSize, cellSize)) {
        let cell = voxelCellFromIndex(index, fieldSize, cellSize);
        let boxCenter = vec3f(cell.center, cell.height * 0.5);
        let cellInterval = voxelRayBoxInterval(ray, boxCenter - cell.halfSize, boxCenter + cell.halfSize);
        let cellTravel = max(cellInterval.x, travel);
        if (cellInterval.x <= cellInterval.y && cellInterval.y >= travel && cellTravel <= nextTravel + 0.00002) {
          hit.hit = 1.0;
          hit.position = ray.origin + ray.direction * cellTravel;
          hit.travel = cellTravel;
          hit.sample.dist = 0.0;
          hit.sample.cell = cell;
          break;
        }
      }

      let crossX = nextCrossing.x;
      let crossY = nextCrossing.y;
      if (crossX <= crossY + 0.000001) {
        cellIndex.x += stepDirection.x;
        nextCrossing.x += crossingDelta.x;
      }
      if (crossY <= crossX + 0.000001) {
        cellIndex.y += stepDirection.y;
        nextCrossing.y += crossingDelta.y;
      }
      travel = nextTravel + 0.000001;
    }
  }

  if (params.limitToVideo > 0.5) {
    let floorCenter = vec3f(fieldSize * 0.5, -0.018);
    let floorHalfSize = vec3f(fieldSize * 0.5, 0.018);
    let floorInterval = voxelRayBoxInterval(ray, floorCenter - floorHalfSize, floorCenter + floorHalfSize);
    let floorTravel = max(floorInterval.x, 0.0);
    if (floorInterval.x <= floorInterval.y && floorInterval.y >= 0.0 && (hit.hit < 0.5 || floorTravel < hit.travel)) {
      let floorPosition = ray.origin + ray.direction * floorTravel;
      hit.hit = 1.0;
      hit.position = floorPosition;
      hit.travel = floorTravel;
      hit.sample.dist = 0.0;
      hit.sample.cell = voxelFloorCell(fieldSize, floorPosition);
    }
  }

  return hit;
}

fn voxelFaceNormal(hit: VoxelHit) -> vec3f {
  if (hit.sample.cell.material < 0.5) {
    return vec3f(0.0, 0.0, 1.0);
  }

  let cell = hit.sample.cell;
  let local = hit.position - vec3f(cell.center, cell.height * 0.5);
  let halfSize = max(cell.halfSize, vec3f(0.0001));
  let faceDistance = abs(abs(local) - halfSize);

  if (faceDistance.z <= faceDistance.x && faceDistance.z <= faceDistance.y) {
    return vec3f(0.0, 0.0, select(-1.0, 1.0, local.z >= 0.0));
  }

  if (faceDistance.x < faceDistance.y) {
    return vec3f(select(-1.0, 1.0, local.x >= 0.0), 0.0, 0.0);
  }

  return vec3f(0.0, select(-1.0, 1.0, local.y >= 0.0), 0.0);
}

fn voxelShade(hit: VoxelHit, ray: VoxelRay) -> vec4f {
  if (hit.hit < 0.5) {
    // A ray miss is empty space. Re-sampling the source here creates a flat,
    // dim duplicate behind the relief that becomes obvious in profile views.
    return vec4f(0.0);
  }

  let normal = voxelFaceNormal(hit);
  let source = hit.sample.cell.color;
  let effectiveLightAngle = params.lightAngle + select(0.0, params.yaw, params.lightFollow > 0.5);
  let lightAzimuth = voxelRadians(effectiveLightAngle);
  let lightElevation = voxelRadians(clamp(params.lightElevation, 1.0, 89.0));
  let lightDir = normalize(vec3f(
    cos(lightAzimuth) * cos(lightElevation),
    -sin(lightAzimuth) * cos(lightElevation),
    sin(lightElevation)
  ));

  let diffuse = max(dot(normal, lightDir), 0.0);
  let halfVector = normalize(lightDir - ray.direction);
  let specular = pow(max(dot(normal, halfVector), 0.0), 30.0) * 0.06;
  let topness = abs(normal.z);
  let faceBias = mix(0.68, 1.08, topness);
  let light = (clamp(params.ambient, 0.0, 1.5) + diffuse * max(params.lightStrength, 0.0)) * faceBias;

  var color = mix(vec3f(luminance(source.rgb)), source.rgb, clamp(params.colorMix, 0.0, 1.0));

  if (hit.sample.cell.material < 0.5) {
    color *= clamp(params.floorBrightness, 0.0, 1.0);
  } else {
    let edgeLocal = abs(hit.position.xy - hit.sample.cell.center) / max(hit.sample.cell.halfSize.xy, vec2f(0.0001));
    let edge = smoothstep(0.78, 1.0, max(edgeLocal.x, edgeLocal.y));
    let edgeShade = 1.0 - edge * clamp(params.edgeDarkness, 0.0, 1.0) * 0.36;
    let heightLift = smoothstep(0.0, voxelMaximumHeight(), hit.sample.cell.height) * 0.12;
    color = color * edgeShade + vec3f(heightLift);
  }

  let shaded = clamp(color * light + vec3f(specular), vec3f(0.0), vec3f(1.0));
  return vec4f(shaded, source.a);
}

fn voxelRenderSample(uv: vec2f) -> vec4f {
  let ray = voxelCameraRay(uv);
  return voxelShade(voxelTrace(ray), ray);
}

@fragment
fn voxelReliefFragment(input: VertexOutput) -> @location(0) vec4f {
  if (params.graphFlags.x < 0.5 || params.graphTintOpacity.a <= 0.0) { return vec4f(0.0); }
  // A stable 2x2 sub-pixel pattern suppresses the high-frequency grid moire
  // and smooths thin column silhouettes without relying on temporal blur.
  let pixelSize = vec2f(1.0 / max(params.width, 1.0), 1.0 / max(params.height, 1.0));
  let relief = (
    voxelRenderSample(input.uv + pixelSize * vec2f(-0.25, -0.25)) +
    voxelRenderSample(input.uv + pixelSize * vec2f(0.25, -0.25)) +
    voxelRenderSample(input.uv + pixelSize * vec2f(-0.25, 0.25)) +
    voxelRenderSample(input.uv + pixelSize * vec2f(0.25, 0.25))
  ) * 0.25;
  let previous = textureSampleLevel(feedbackTex, texSampler, input.uv, 0.0);
  let smoothing = select(clamp(params.temporalBlend, 0.0, 0.94), 0.0, params.reset > 0.5);
  let rgb = mix(relief.rgb, previous.rgb, smoothing);
  let alpha = max(relief.a, previous.a * smoothing);
  return vec4f(rgb, alpha * params.graphTintOpacity.a);
}
