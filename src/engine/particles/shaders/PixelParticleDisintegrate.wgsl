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
  fade: f32,
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

/**
 * Gust field: gradient Fractal Noise (imageGraphFractalNoise, prepended from the shared Fractal Noise
 * node) with 4 octaves that each turn by 37.5 degrees, so no lattice axis survives the release
 * contrast (value noise turned one lattice square into an axis-aligned pocket, a hard "censor bar").
 * Spread by 1.4 around 0.5 to keep the value-noise field's spread (std 0.13), so pockets stay as large.
 */
fn gustNoise(p: vec2f) -> f32 {
  return clamp(0.5 + (imageGraphFractalNoise(p, 4.0, 0.5) - 0.5) * 1.4, 0.0, 1.0);
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

/** Straight-alpha source texel at an integer pixel, clamped to the frame. */
fn loadSource(pixel: vec2i) -> vec4f {
  let size = vec2i(textureDimensions(sourceTexture));
  return textureLoad(sourceTexture, clamp(pixel, vec2i(0), size - vec2i(1)), 0);
}

/** Bilinear read that mixes premultiplied texels, so transparent neighbours never darken an edge. */
fn samplePremultiplied(uv: vec2f) -> vec4f {
  let position = uv * vec2f(textureDimensions(sourceTexture)) - vec2f(0.5);
  let base = floor(position);
  let f = position - base;
  let cell = vec2i(base);
  let a = loadSource(cell); let b = loadSource(cell + vec2i(1, 0));
  let c = loadSource(cell + vec2i(0, 1)); let d = loadSource(cell + vec2i(1, 1));
  let pa = vec4f(a.rgb * a.a, a.a); let pb = vec4f(b.rgb * b.a, b.a);
  let pc = vec4f(c.rgb * c.a, c.a); let pd = vec4f(d.rgb * d.a, d.a);
  return mix(mix(pa, pb, f.x), mix(pc, pd, f.x), f.y);
}

/** Centre of the cell (in uv) that covers `uv`. */
fn cellCenter(uv: vec2f) -> vec2f {
  let grid = vec2f(f32(max(params.columns, 1u)), f32(max(params.rows, 1u)));
  let cell = min(floor(uv * grid), grid - vec2f(1.0));
  return (cell + vec2f(0.5)) / grid;
}

@fragment
fn flatFragmentMain(input: FlatVertexOutput) -> @location(0) vec4f {
  let color = loadSource(vec2i(floor(input.uv * vec2f(textureDimensions(sourceTexture)))));
  let premultiplied = vec4f(color.rgb * color.a, color.a);
  // Passthrough (muted render node or unconnected chain): the whole input, unchanged.
  if (params.flatAlpha > 0.5) {
    return premultiplied;
  }
  // Cells that are not released yet stay in place as exact source pixels (progress 0 is the
  // original picture); a released cell is drawn by its particle instead.
  if (cellRelease(cellCenter(input.uv)).local > 0.0) {
    return vec4f(0.0);
  }
  return premultiplied * globalFade();
}

@fragment
fn resolveFragmentMain(input: FlatVertexOutput) -> @location(0) vec4f {
  let premul = textureSample(sourceTexture, sourceSampler, input.uv);
  let alpha = clamp(premul.a, 0.0, 1.0);
  let rgb = select(vec3f(0.0), premul.rgb / max(alpha, 0.00001), alpha > 0.00001);
  return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)), alpha);
}

struct CellRelease {
  local: f32,
  gustField: f32,
  gustPocket: f32,
  detailRelease: f32,
  seedUv: vec2f,
};

/** When the cell at `baseUv` lets go (0 = still in place, 1 = at the end of its Tail). */
fn cellRelease(baseUv: vec2f) -> CellRelease {
  let seedUv = baseUv + vec2f(params.seed * 0.013, params.seed * 0.017);
  let progress = clamp(params.progress, 0.0, 1.0);
  let gustStrength = clamp(params.gustStrength, 0.0, 2.0);
  let gustScale = max(params.gustScale, 0.5);
  let windDir = safeNormalize(vec2f(params.directionX, params.directionY) + vec2f(0.42, -0.72));
  let windAxis = dot(baseUv - vec2f(0.5), windDir);
  let windOrder = clamp((windAxis + 0.70710678) * 0.70710678, 0.0, 1.0);
  let windDelay = windOrder * clamp(params.windSweep, 0.0, 1.0) * 0.45;
  let gustField = gustNoise(baseUv * gustScale + vec2f(params.seed * 0.031, params.seed * 0.047));
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
  var release: CellRelease;
  release.local = localRaw * localRaw * (3.0 - 2.0 * localRaw);
  release.gustField = gustField;
  release.gustPocket = gustPocket;
  release.detailRelease = detailRelease;
  release.seedUv = seedUv;
  return release;
}

/** Everything fades out over the last 18 % of Progress. */
fn globalFade() -> f32 {
  return 1.0 - smoothstep(0.82, 1.0, clamp(params.progress, 0.0, 1.0));
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
  let release = cellRelease(baseUv);
  let local = release.local;
  var out: ParticleVertexOutput;
  if (local <= 0.0) {
    // Not released: the flat pass draws this cell; a degenerate quad rasterizes nothing.
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.sourceUv = baseUv;
    out.localUv = vec2f(0.5);
    out.alpha = 0.0;
    out.shape = 0.0;
    return out;
  }
  let rnd = hash22(release.seedUv);
  let gustStrength = clamp(params.gustStrength, 0.0, 2.0);
  let windDir = safeNormalize(vec2f(params.directionX, params.directionY) + vec2f(0.42, -0.72));
  let gustField = release.gustField;
  let gustPocket = release.gustPocket;
  let detailRelease = release.detailRelease;
  // Fade: a particle thins out and shrinks over the second half of its own flight.
  let fade = clamp(params.fade, 0.0, 1.0);
  let lifeFade = 1.0 - fade * smoothstep(0.35, 1.0, local);
  let particleAlpha = globalFade() * lifeFade * clamp(params.particleAlpha, 0.0, 1.0);

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
  // A released particle starts as its exact cell, then grows to Particle Size and takes its
  // shape over the first quarter of its flight (no jump when it lets go).
  let lift = smoothstep(0.0, 0.25, local);
  let lifeScale = 1.0 - 0.5 * fade * smoothstep(0.5, 1.0, local);
  let scale = mix(1.0, max(params.particleSize, 0.01), lift) * perspective * lifeScale;
  let ndcSize = vec2f(2.0 / f32(columns), 2.0 / f32(rows)) * scale;

  out.position = vec4f(center + rotated * ndcSize, 0.0, 1.0);
  out.sourceUv = clamp(
    baseUv + vec2f(corner.x * sourceCellUv.x, -corner.y * sourceCellUv.y),
    vec2f(0.0),
    vec2f(1.0)
  );
  out.localUv = corner + vec2f(0.5);
  out.alpha = particleAlpha;
  // Shape blend: integer part = shape, fraction = how far the square has turned into it.
  out.shape = f32(params.shape) + min(lift, 0.999);
  return out;
}

@fragment
fn particleFragmentMain(input: ParticleVertexOutput) -> @location(0) vec4f {
  let shape = floor(input.shape);
  let lift = input.shape - shape;
  let dist = distance(input.localUv, vec2f(0.5));
  // At least one screen pixel of edge, so Softness 0 is a crisp circle, not smoothstep(0.5, 0.5, d).
  let edge = max(clamp(params.softness, 0.0, 1.0) * 0.35, max(fwidth(dist), 1e-4));
  var mask = 1.0;
  if (shape > 0.5 && shape < 1.5) {
    mask = 1.0 - smoothstep(0.5 - edge, 0.5, dist);
  } else if (shape >= 1.5) {
    let shard = 1.0 - smoothstep(0.42, 0.5, abs(input.localUv.x + input.localUv.y - 1.0));
    mask = max(shard, 1.0 - smoothstep(0.46, 0.5, max(abs(input.localUv.x - 0.5), abs(input.localUv.y - 0.5))));
  }
  let coverage = mix(1.0, mask, lift);
  let color = samplePremultiplied(input.sourceUv);
  return color * clamp(input.alpha * coverage, 0.0, 1.0);
}
