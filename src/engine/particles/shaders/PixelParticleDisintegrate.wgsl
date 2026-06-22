struct ParticleParams {
  progress: f32,
  cellSize: f32,
  particleSize: f32,
  spread: f32,
  depth: f32,
  curlStrength: f32,
  turbulence: f32,
  directionX: f32,
  directionY: f32,
  gravity: f32,
  spin: f32,
  stagger: f32,
  tail: f32,
  seed: f32,
  motionTime: f32,
  width: f32,
  height: f32,
  columns: u32,
  rows: u32,
  maxInstances: u32,
  shape: u32,
  softness: f32,
  flatAlpha: f32,
  particleAlpha: f32,
  gustStrength: f32,
  gustScale: f32,
  windSweep: f32,
  releaseContrast: f32,
};

struct FlatVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

struct ParticleVertexOutput {
  @builtin(position) position: vec4f,
  @location(0) sourceUv: vec2f,
  @location(1) localUv: vec2f,
  @location(2) alpha: f32,
  @location(3) shape: f32,
};

@group(0) @binding(0) var sourceSampler: sampler;
@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: ParticleParams;

fn hash12(p: vec2f) -> f32 {
  let h = dot(p, vec2f(127.1, 311.7));
  return fract(sin(h) * 43758.5453123);
}

fn hash22(p: vec2f) -> vec2f {
  return vec2f(
    hash12(p + vec2f(17.0, 91.0)),
    hash12(p + vec2f(43.0, 29.0))
  );
}

fn safeNormalize(v: vec2f) -> vec2f {
  let len = length(v);
  if (len < 0.0001) {
    return vec2f(0.5, -0.8660254);
  }
  return v / len;
}

fn valueNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = hash12(i);
  let b = hash12(i + vec2f(1.0, 0.0));
  let c = hash12(i + vec2f(0.0, 1.0));
  let d = hash12(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm2(p: vec2f) -> f32 {
  let n0 = valueNoise(p) * 0.5;
  let n1 = valueNoise(p * 2.0 + vec2f(19.1, 7.3)) * 0.25;
  let n2 = valueNoise(p * 4.0 + vec2f(3.7, 41.2)) * 0.125;
  let n3 = valueNoise(p * 8.0 + vec2f(29.5, 13.9)) * 0.0625;
  return (n0 + n1 + n2 + n3) / 0.9375;
}

fn flatPosition(vertexIndex: u32) -> vec2f {
  var positions = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  return positions[vertexIndex];
}

fn flatUv(vertexIndex: u32) -> vec2f {
  var uvs = array<vec2f, 6>(
    vec2f(0.0, 1.0), vec2f(1.0, 1.0), vec2f(0.0, 0.0),
    vec2f(0.0, 0.0), vec2f(1.0, 1.0), vec2f(1.0, 0.0)
  );
  return uvs[vertexIndex];
}

@vertex
fn flatVertexMain(@builtin(vertex_index) vertexIndex: u32) -> FlatVertexOutput {
  var out: FlatVertexOutput;
  out.position = vec4f(flatPosition(vertexIndex), 0.0, 1.0);
  out.uv = flatUv(vertexIndex);
  return out;
}

@fragment
fn flatFragmentMain(input: FlatVertexOutput) -> @location(0) vec4f {
  let color = textureSample(sourceTexture, sourceSampler, input.uv);
  let alpha = clamp(params.flatAlpha, 0.0, 1.0);
  return vec4f(color.rgb * alpha, color.a * alpha);
}

@fragment
fn resolveFragmentMain(input: FlatVertexOutput) -> @location(0) vec4f {
  let premul = textureSample(sourceTexture, sourceSampler, input.uv);
  let alpha = clamp(premul.a, 0.0, 1.0);
  let rgb = select(vec3f(0.0), premul.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), alpha);
}

@vertex
fn particleVertexMain(
  @builtin(vertex_index) vertexIndex: u32,
  @builtin(instance_index) instanceIndex: u32
) -> ParticleVertexOutput {
  var corners = array<vec2f, 4>(
    vec2f(-0.5, -0.5),
    vec2f(0.5, -0.5),
    vec2f(-0.5, 0.5),
    vec2f(0.5, 0.5)
  );
  let columns = max(params.columns, 1u);
  let rows = max(params.rows, 1u);
  let col = instanceIndex % columns;
  let row = instanceIndex / columns;
  let baseUv = vec2f(
    (f32(col) + 0.5) / f32(columns),
    (f32(row) + 0.5) / f32(rows)
  );
  let sourceCellUv = vec2f(1.0 / f32(columns), 1.0 / f32(rows));
  let seedUv = baseUv + vec2f(params.seed * 0.013, params.seed * 0.017);
  let rnd = hash22(seedUv);
  let progress = clamp(params.progress, 0.0, 1.0);
  let gustStrength = clamp(params.gustStrength, 0.0, 2.0);
  let gustScale = max(params.gustScale, 0.5);
  let windDir = safeNormalize(vec2f(params.directionX, params.directionY) + vec2f(0.42, -0.72));
  let windAxis = dot(baseUv - vec2f(0.5), windDir);
  let windOrder = clamp((windAxis + 0.70710678) * 0.70710678, 0.0, 1.0);
  let windDelay = windOrder * clamp(params.windSweep, 0.0, 1.0) * 0.45;
  let gustField = fbm2(baseUv * gustScale + vec2f(params.seed * 0.031, params.seed * 0.047));
  let gustPocket = smoothstep(0.32, 0.9, gustField);
  let detailRelease = hash12(seedUv * 17.13);
  let releaseBlend = clamp(gustStrength, 0.0, 1.0);
  let releaseField = mix(detailRelease, gustPocket, releaseBlend);
  let contrastedRelease = clamp(
    (releaseField - 0.5) * (1.0 + clamp(params.releaseContrast, 0.0, 2.0)) + 0.5,
    0.0,
    1.0
  );
  let delay = clamp((1.0 - contrastedRelease) * clamp(params.stagger, 0.0, 0.95) + windDelay, 0.0, 0.98);
  let tail = max(params.tail, 0.02);
  let localRaw = smoothstep(delay, min(delay + tail, 1.25), progress);
  let local = localRaw * localRaw * (3.0 - 2.0 * localRaw);
  let fadeOut = 1.0 - smoothstep(0.82, 1.0, progress);
  let particleAlpha = fadeOut * clamp(params.particleAlpha, 0.0, 1.0);

  let angle = rnd.x * 6.2831853;
  let randomDir = vec2f(cos(angle), sin(angle));
  let curl = vec2f(
    sin((baseUv.y + params.motionTime * 0.07 + rnd.y) * 18.0),
    cos((baseUv.x + params.motionTime * 0.05 + rnd.x) * 18.0)
  ) * params.curlStrength;
  let turbulent = vec2f(
    sin((baseUv.x + baseUv.y + rnd.x) * 48.0 + params.motionTime),
    cos((baseUv.x - baseUv.y + rnd.y) * 42.0 + params.motionTime * 0.7)
  ) * params.turbulence * (0.65 + gustPocket * 0.7);
  let gravity = vec2f(0.0, params.gravity * local * local);
  let bias = vec2f(params.directionX, params.directionY);
  let coherentWind = windDir * (0.25 + gustField * 0.95) * gustStrength;
  let pocketBurst = windDir * gustPocket * gustStrength * smoothstep(0.0, 0.65, local);
  let displacement = (
    randomDir * (0.45 + detailRelease * 0.55) +
    curl +
    turbulent +
    bias +
    coherentWind +
    pocketBurst +
    gravity
  ) * params.spread * local;

  let z = max(0.0, params.depth * local * (0.35 + rnd.y));
  let perspective = 1.0 / (1.0 + z * 0.75);
  let baseClip = vec2f(baseUv.x * 2.0 - 1.0, (1.0 - baseUv.y) * 2.0 - 1.0);
  let center = baseClip + vec2f(displacement.x, -displacement.y) * perspective;

  let spinAngle = params.spin * local * (rnd.x * 2.0 - 1.0) * 6.2831853;
  let c = cos(spinAngle);
  let s = sin(spinAngle);
  let corner = corners[vertexIndex];
  let rotated = vec2f(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
  let size = max(params.cellSize, 1.0) * max(params.particleSize, 0.01) * perspective;
  let ndcSize = vec2f(size / max(params.width, 1.0) * 2.0, size / max(params.height, 1.0) * 2.0);

  var out: ParticleVertexOutput;
  out.position = vec4f(center + rotated * ndcSize, 0.0, 1.0);
  out.sourceUv = clamp(
    baseUv + vec2f(corner.x * sourceCellUv.x, -corner.y * sourceCellUv.y),
    vec2f(0.0),
    vec2f(1.0)
  );
  out.localUv = corner + vec2f(0.5);
  out.alpha = particleAlpha;
  out.shape = f32(params.shape);
  return out;
}

@fragment
fn particleFragmentMain(input: ParticleVertexOutput) -> @location(0) vec4f {
  var mask = 1.0;
  if (input.shape > 0.5 && input.shape < 1.5) {
    let dist = distance(input.localUv, vec2f(0.5));
    mask = 1.0 - smoothstep(0.5 - params.softness * 0.35, 0.5, dist);
  } else if (input.shape >= 1.5) {
    let shard = 1.0 - smoothstep(0.42, 0.5, abs(input.localUv.x + input.localUv.y - 1.0));
    mask = max(shard, 1.0 - smoothstep(0.46, 0.5, max(abs(input.localUv.x - 0.5), abs(input.localUv.y - 0.5))));
  }
  let color = textureSample(sourceTexture, sourceSampler, input.sourceUv);
  let alpha = clamp(input.alpha * mask, 0.0, 1.0);
  return vec4f(color.rgb * alpha, color.a * alpha);
}
