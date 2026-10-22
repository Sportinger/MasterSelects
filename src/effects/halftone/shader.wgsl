struct CatalogParams {
  resolution: vec2f,
  scale: f32,
  amount: f32,
  angle: f32,
  time: f32,
  speed: f32,
  variant: f32,
  colorA: vec4f,
  colorB: vec4f,
};

@group(0) @binding(0) var texSampler: sampler;
@group(0) @binding(1) var inputTex: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: CatalogParams;

fn source(uv: vec2f) -> vec4f {
  return textureSample(inputTex, texSampler, clamp(uv, vec2f(0.001), vec2f(0.999)));
}

// Cell Filter (prefilterCellTaps in patternCellFilter.ts): the picture averaged over a box of half a cell (whole
// pixels, at most 32 evenly spread reads per axis) in linear light weighted by alpha, back in straight sRGB with the
// average alpha. The cell reads of Halftone, Riso and Dithering take it, so a cell shows its whole light.
// cellBox is the box centred on one point; the graph caches it at every pixel centre and reads that cache
// bilinearly at the tap, so cellFiltered does the same with the four pixel centres around the tap.
// One row of the box (the graph's first pass, cached at every pixel centre): `count` reads across `width` pixels,
// in linear light weighted by alpha.
fn cellRow(uv: vec2f, width: f32, count: f32, spacing: f32) -> vec4f {
  var row = vec4f(0.0);
  for (var i = 0; i < i32(count); i++) {
    let dx = ((f32(i) + 0.5) * spacing - width * 0.5) / params.resolution.x;
    let p = source(uv + vec2f(dx, 0.0));
    row += vec4f(srgbToLinear(p.rgb) * p.a, p.a);
  }
  return row / count;
}

// The box centred on a pixel centre `uv` (the graph's second pass): its column reads take the row cache bilinearly,
// so a read between two pixel rows mixes their rows in linear light.
fn cellBox(uv: vec2f, cells: f32) -> vec4f {
  let width = max(floor(cells * 0.5 + 0.5), 1.0);
  let count = min(width, 32.0);
  let spacing = width / count;
  let lastRow = params.resolution.y - 1.0;
  var sum = vec4f(0.0);
  for (var j = 0; j < i32(count); j++) {
    let dy = ((f32(j) + 0.5) * spacing - width * 0.5) / params.resolution.y;
    let y = clamp(uv.y + dy, 0.001, 0.999) * params.resolution.y - 0.5;
    let base = floor(y);
    let upper = (clamp(base, 0.0, lastRow) + 0.5) / params.resolution.y;
    let lower = (clamp(base + 1.0, 0.0, lastRow) + 0.5) / params.resolution.y;
    sum += mix(cellRow(vec2f(uv.x, upper), width, count, spacing), cellRow(vec2f(uv.x, lower), width, count, spacing), y - base);
  }
  let average = sum / count;
  return vec4f(linearToSrgb(average.rgb / max(average.a, 1e-6)), average.a);
}

fn cellFiltered(uv: vec2f, cells: f32) -> vec4f {
  // The cache read: clamp to the frame as the sampler does, then mix the four pixel centres around the point.
  let point = clamp(uv, vec2f(0.0), vec2f(1.0)) * params.resolution - 0.5;
  let base = floor(point);
  let f = point - base;
  let last = params.resolution - 1.0;
  let p00 = (clamp(base, vec2f(0.0), last) + 0.5) / params.resolution;
  let p11 = (clamp(base + 1.0, vec2f(0.0), last) + 0.5) / params.resolution;
  let top = mix(cellBox(p00, cells), cellBox(vec2f(p11.x, p00.y), cells), f.x);
  let bottom = mix(cellBox(vec2f(p00.x, p11.y), cells), cellBox(p11, cells), f.x);
  return mix(top, bottom, f.y);
}

// Pattern sizes count pixels of a 1080p frame (shorter side), as the graphs do (patternReferenceFrame.ts).
fn frameScale() -> f32 {
  return min(params.resolution.x, params.resolution.y) / 1080.0;
}

fn referencePixels(size: f32) -> f32 {
  return max(size * frameScale(), 1.0);
}

fn rotated(uv: vec2f) -> vec2f {
  let a = params.angle * PI / 180.0;
  let p = uv - 0.5;
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) + 0.5;
}

fn bayer4(pixel: vec2f) -> f32 {
  let table = array<f32, 16>(
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  let x = u32(max(0.0, floor(pixel.x))) % 4u;
  let y = u32(max(0.0, floor(pixel.y))) % 4u;
  return (table[y * 4u + x] + 0.5) / 16.0;
}

fn inkMix(tone: f32, pattern: f32, alpha: f32) -> vec4f {
  let threshold = mix(tone, pattern, params.amount);
  return vec4f(mix(params.colorA.rgb, params.colorB.rgb, step(0.5, threshold)), alpha);
}

fn linearToSrgb(c: vec3f) -> vec3f {
  return sign(c) * select(1.055 * pow(abs(c), vec3f(1.0 / 2.4)) - 0.055, abs(c) * 12.92, abs(c) <= vec3f(0.0031308));
}

// Dithering (createDefaultDitheringGraph in ditheringEffectGraph.ts): cells of Pixel Size whole pixels, each read as one
// colour (four points a quarter cell from its centre, in linear light and weighted by alpha), stepped to Levels equal
// sRGB steps per channel; the share of the upper step is measured in linear light and decided by the cell's Bayer threshold.
@fragment
fn ditherFragment(input: VertexOutput) -> @location(0) vec4f {
  let own = source(input.uv);
  let size = max(round(max(params.scale, 1.0) * frameScale()), 1.0);
  let cells = input.uv * params.resolution / vec2f(size);
  let center = (floor(cells) + vec2f(0.5)) * size;
  let reach = min(size * 0.25, (size - 1.0) * 0.5);
  var light = vec3f(0.0);
  var alpha = 0.0;
  for (var tap = 0; tap < 4; tap++) {
    let side = vec2f(select(-1.0, 1.0, (tap & 1) == 1), select(-1.0, 1.0, tap >= 2));
    let point = cellFiltered((center + side * reach) / params.resolution, size);
    light += srgbToLinear(point.rgb) * point.a;
    alpha += point.a;
  }
  let picked = mix(light / max(alpha, 0.001), srgbToLinear(own.rgb), step(alpha, 0.001));
  let cell = clamp(picked, vec3f(0.0), vec3f(1.0));
  let steps = max(params.variant, 2.0) - 1.0;
  let lowerIndex = floor(linearToSrgb(cell) * steps);
  let lower = lowerIndex / steps;
  let upper = clamp((lowerIndex + vec3f(1.0)) / steps, vec3f(0.0), vec3f(1.0));
  let lowerLinear = srgbToLinear(lower);
  let span = max(srgbToLinear(upper) - lowerLinear, vec3f(1e-6));
  let share = (cell - lowerLinear) / span;
  let stepUp = floor(share + vec3f(bayer4(cells)));
  let dithered = clamp((lowerIndex + stepUp) / steps, vec3f(0.0), vec3f(1.0));
  return vec4f(mix(own.rgb, dithered, params.amount), own.a);
}

@fragment
fn ditherStudioFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  var threshold = bayer4(input.uv * params.resolution / max(params.scale * 0.35, 1.0));
  if (params.variant < 0.5) { threshold = fract(dot(floor(input.uv * params.resolution), vec2f(0.5, 0.75))); }
  if (params.variant > 1.5) { threshold = select(0.25, 0.75, fract(input.uv.x * params.resolution.x / params.scale) > 0.5); }
  let bit = step(threshold, luminance(color.rgb));
  return vec4f(mix(color.rgb, mix(params.colorA.rgb, params.colorB.rgb, bit), params.amount), color.a);
}

// The dot screen in pixels, turned by Angle around the frame centre: cells stay square on every frame shape.
fn screenPixel(uv: vec2f) -> vec2f {
  let a = params.angle * PI / 180.0;
  let center = params.resolution * 0.5;
  let p = uv * params.resolution - center;
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a)) + center;
}

fn srgbToLinear(c: vec3f) -> vec3f {
  let s = abs(c);
  return sign(c) * select(pow((s + 0.055) / 1.055, vec3f(2.4)), s / 12.92, s <= vec3f(0.04045));
}

// Radius of a round dot that covers `darkness` of its cell (HALFTONE_DOT in halftoneEffectGraphs.ts).
fn halftoneDotRadius(darkness: f32) -> f32 {
  if (darkness > PI / 4.0) { return 0.70710678 - sqrt(1.0 - darkness) * 0.44710; }
  return sqrt(darkness / PI);
}

// Cell Tone (cellLight in halftoneEffectGraphs.ts): linear light at four points a quarter cell from the centre,
// weighted by alpha, plus the pixel itself at 5 % so a cell whose points are all transparent still has a tone.
fn halftoneCellLight(uv: vec2f, cells: f32) -> f32 {
  let a = -params.angle * PI / 180.0;
  let center = params.resolution * 0.5;
  let relative = (floor(screenPixel(uv) / cells) + 0.5) * cells - center;
  let centerUv = (vec2f(relative.x * cos(a) - relative.y * sin(a), relative.x * sin(a) + relative.y * cos(a)) + center) / params.resolution;
  let stepX = vec2f(cos(a), sin(a)) * cells * 0.25 / params.resolution;
  let stepY = vec2f(-sin(a), cos(a)) * cells * 0.25 / params.resolution;
  let own = source(uv);
  var light = luminance(srgbToLinear(own.rgb)) * own.a * 0.05;
  var alpha = own.a * 0.05;
  for (var tap = 0; tap < 4; tap++) {
    let side = vec2f(select(-1.0, 1.0, (tap & 1) == 1), select(-1.0, 1.0, tap >= 2));
    let point = cellFiltered(centerUv + stepX * side.x + stepY * side.y, cells);
    light += luminance(srgbToLinear(point.rgb)) * point.a;
    alpha += point.a;
  }
  return light / max(alpha, 1e-6);
}

@fragment
fn halftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let cells = referencePixels(max(params.scale, 2.0));
  let cell = fract(screenPixel(input.uv) / cells) - 0.5;
  let original = source(input.uv);
  let darkness = clamp(1.0 - halftoneCellLight(input.uv, cells), 0.0, 1.0);
  let edge = 0.5 / cells;
  let dotRadius = halftoneDotRadius(darkness) + (darkness * 2.0 - 1.0) * edge;
  let ink = 1.0 - smoothstep(dotRadius - edge, dotRadius + edge, length(cell));
  return vec4f(mix(original.rgb, mix(params.colorB.rgb, params.colorA.rgb, ink), params.amount), original.a);
}

@fragment
fn patternHalftoneFragment(input: VertexOutput) -> @location(0) vec4f {
  let cells = referencePixels(max(params.scale, 2.0));
  let cell = fract(screenPixel(input.uv) / cells) - 0.5;
  let color = source(input.uv);
  let radius = (1.0 - luminance(color.rgb)) * 0.72;
  var distance = length(cell);
  if (params.variant > 0.5 && params.variant < 1.5) { distance = abs(cell.x) + abs(cell.y); }
  if (params.variant > 1.5) { distance = abs(cell.y); }
  let edge = 0.5 / cells;
  let mark = 1.0 - smoothstep(radius - edge, radius + edge, distance);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, mark), params.amount), color.a);
}

// Riso (createRisoPrintGraph in risoPrintEffectGraph.ts): two inks on cream paper, each through its own dot screen
// (dark 15°, warm 75°) of Dot Size (the variant slot) on a drum that Registration slips apart. Each cell's colour (four
// reads in linear light, weighted by alpha) is split between the inks by a least-squares fit of the light it takes from
// the paper; the Tone step keeps its brightness exactly.

fn risoTurn(p: vec2f, a: f32) -> vec2f {
  return vec2f(p.x * cos(a) - p.y * sin(a), p.x * sin(a) + p.y * cos(a));
}

// Cell Colour (cellColourAt in risoPrintEffectGraph.ts): four reads around `centre` (pixels) in the graph's order,
// centre − diagonal, + anti-diagonal, − anti-diagonal, + diagonal, in linear light and weighted by alpha, with the paper
// at weight 0.001 (it decides only where all four reads are transparent).
fn risoCellLight(centre: vec2f, diagonal: vec2f, antiDiagonal: vec2f, paper: vec3f, size: f32) -> vec3f {
  let reads = array<vec2f, 4>(centre - diagonal, centre + antiDiagonal, centre - antiDiagonal, centre + diagonal);
  var light = paper * 0.001;
  var alpha = 0.001;
  for (var tap = 0; tap < 4; tap++) {
    let point = cellFiltered(reads[tap] / params.resolution, size);
    light += srgbToLinear(point.rgb) * point.a;
    alpha += point.a;
  }
  return light / alpha;
}

// Separation and Tone (inkCoverage in risoPrintEffectGraph.ts) of one cell colour for the dark (`dark`) or the warm ink:
// x is this ink's coverage, y the other ink's.
fn risoCoverage(cell: vec3f, paper: vec3f, dark: bool) -> vec2f {
  let absorbsA = vec3f(1.0) - srgbToLinear(params.colorA.rgb);
  let absorbsB = vec3f(1.0) - srgbToLinear(params.colorB.rgb);
  let taken = max(vec3f(1.0) - cell / paper, vec3f(0.0));
  let m00 = dot(absorbsA, absorbsA) + 0.005;
  let m11 = dot(absorbsB, absorbsB) + 0.005;
  let m01 = dot(absorbsA, absorbsB);
  let det = m00 * m11 - m01 * m01;
  let towardsA = dot(taken, absorbsA);
  let towardsB = dot(taken, absorbsB);
  var share = 0.0;
  var otherShare = 0.0;
  if (dark) {
    let first = clamp((m11 * towardsA - m01 * towardsB) / det, 0.0, 1.0);
    otherShare = clamp((towardsB - m01 * first) / m11, 0.0, 1.0);
    share = clamp((towardsA - m01 * otherShare) / m00, 0.0, 1.0);
  } else {
    let first = clamp((m00 * towardsB - m01 * towardsA) / det, 0.0, 1.0);
    otherShare = clamp((towardsA - m01 * first) / m00, 0.0, 1.0);
    share = clamp((towardsB - m01 * otherShare) / m11, 0.0, 1.0);
  }
  // Tone: scale both shares so the dots keep the cell's brightness, then this ink's coverage beside the other's.
  let absorbedA = luminance(paper * absorbsA);
  let absorbedB = luminance(paper * absorbsB);
  let both = luminance(paper * absorbsA * absorbsB);
  let paperLuma = luminance(paper);
  let cellLuma = luminance(cell);
  let darkShare = select(otherShare, share, dark);
  let warmShare = select(share, otherShare, dark);
  let gap = max(paperLuma - cellLuma, 0.0);
  let slope = darkShare * absorbedA + warmShare * absorbedB;
  let overlap = darkShare * warmShare * both;
  let root = sqrt(max(slope * slope - overlap * 4.0 * gap, 0.0));
  let scale = min(gap * 2.0 / max(slope + root, 1e-6), slope / max(overlap * 2.0, 1e-6));
  let otherCoverage = clamp(scale * otherShare, 0.0, 1.0);
  let absorbedOwn = select(absorbedB, absorbedA, dark);
  let absorbedOther = select(absorbedA, absorbedB, dark);
  let left = paperLuma - otherCoverage * absorbedOther - cellLuma;
  let coverage = clamp((left + scale * share * 0.001) / (absorbedOwn - otherCoverage * both + 0.001), 0.0, 1.0);
  return vec2f(coverage, otherCoverage);
}

// One ink's dot at a paper pixel: `layer` is the pixel on the ink's drum, `dark` picks the ink. x is the dot mask, y the
// cell's coverage of this ink, z the other ink's coverage there.
fn risoInkDot(layer: vec2f, angle: f32, size: f32, paper: vec3f, dark: bool) -> vec3f {
  let a = angle * PI / 180.0;
  let center = params.resolution * 0.5;
  let cells = risoTurn(layer - center, a) / vec2f(size);
  let place = fract(cells) - vec2f(0.5);
  let cellCenter = risoTurn((floor(cells) + vec2f(0.5)) * size, -a) + center;
  let stepX = risoTurn(vec2f(size * 0.25, 0.0), -a);
  let stepY = risoTurn(vec2f(0.0, size * 0.25), -a);
  let shares = risoCoverage(risoCellLight(cellCenter, stepX + stepY, stepX - stepY, paper, size), paper, dark);
  let edge = 0.5 / size;
  let dotRadius = halftoneDotRadius(shares.x) + (shares.x * 2.0 - 1.0) * edge;
  return vec3f(1.0 - smoothstep(dotRadius - edge, dotRadius + edge, length(place)), shares.x, shares.y);
}

@fragment
fn risoFragment(input: VertexOutput) -> @location(0) vec4f {
  let own = source(input.uv);
  let pixel = input.uv * params.resolution;
  let slip = vec2f(0.8, 0.6) * (max(params.scale, 0.0) * frameScale() * 0.5);
  let size = referencePixels(max(params.variant, 2.0));
  let paper = srgbToLinear(vec3f(0.96, 0.93, 0.85));
  let markA = risoInkDot(pixel + slip, 15.0, size, paper, true).x;
  let markB = risoInkDot(pixel - slip, 75.0, size, paper, false).x;
  let printed = paper * mix(vec3f(1.0), srgbToLinear(params.colorA.rgb), markA) * mix(vec3f(1.0), srgbToLinear(params.colorB.rgb), markB);
  return vec4f(mix(own.rgb, linearToSrgb(printed), params.amount), own.a);
}

// Riso Glow's cached glow share (the glow ink's cell coverage × (1 − the shadow ink's)) read at `at` (pixels) the way the
// graph's cache is: bilinear between the four nearest pixel centres, clamped to the frame.
fn risoGlowSourceAt(at: vec2f, slip: vec2f, size: f32, paper: vec3f) -> f32 {
  let corner = floor(at - vec2f(0.5));
  let blend = at - vec2f(0.5) - corner;
  var corners = array<f32, 4>(0.0, 0.0, 0.0, 0.0);
  for (var index = 0; index < 4; index++) {
    let texel = clamp(corner + vec2f(f32(index & 1), f32(index >> 1)), vec2f(0.0), params.resolution - vec2f(1.0)) + vec2f(0.5);
    let warm = risoInkDot(texel - slip, 75.0, size, paper, false);
    // RISO_GLOW_PAPER (0.6) of the paper's light glows too: mix(0.6, 1, glow coverage) where the shadow ink leaves paper,
    // on opaque pixels only.
    corners[index] = mix(0.6, 1.0, warm.y) * (1.0 - warm.z) * source(texel / params.resolution).a;
  }
  return mix(mix(corners[0], corners[1], blend.x), mix(corners[2], corners[3], blend.x), blend.y);
}

// Riso Glow (createRisoGlowGraph): Riso's print, then the Glow Ink's light screened on in linear light. Its field is
// gathered over 9 × 9 taps 0.75 cells apart, kept within the outer pixel centres (Gaussian weights, sigma 2 taps, X outer
// and Y inner as the graph's Kernel Sum): at each, the cached glow share (risoGlowSourceAt).
// Strength is Glow (the Angle slot) × 1.5 × the pulse 0.55 + 0.45 cos(2 × time × Speed).
@fragment
fn risoGlowFragment(input: VertexOutput) -> @location(0) vec4f {
  let own = source(input.uv);
  let pixel = input.uv * params.resolution;
  let slip = vec2f(0.8, 0.6) * (max(params.scale, 0.0) * frameScale() * 0.5);
  let size = referencePixels(max(params.variant, 2.0));
  let paper = srgbToLinear(vec3f(0.96, 0.93, 0.85));
  let inkB = srgbToLinear(params.colorB.rgb);
  let printed = paper * mix(vec3f(1.0), srgbToLinear(params.colorA.rgb), risoInkDot(pixel + slip, 15.0, size, paper, true).x)
    * mix(vec3f(1.0), inkB, risoInkDot(pixel - slip, 75.0, size, paper, false).x);
  let tapStep = size * 0.75;
  var gathered = 0.0;
  var weights = 0.0;
  for (var x = 0; x < 9; x++) {
    for (var y = 0; y < 9; y++) {
      let tap = vec2f(f32(x) - 4.0, f32(y) - 4.0);
      let distance = length(tap);
      let weight = exp(-(distance * distance) / (2.0 * 2.0 * 2.0));
      let at = clamp(pixel + tap * tapStep, vec2f(0.5), params.resolution - vec2f(0.5));
      gathered += risoGlowSourceAt(at, slip, size, paper) * weight;
      weights += weight;
    }
  }
  let light = inkB * (gathered / weights);
  let pulse = 0.55 + cos(params.time * params.speed * 2.0) * 0.45;
  let keep = pow(vec3f(exp(0.0 - max(params.angle, 0.0) * (pulse * 1.5))), light);
  let glowing = vec3f(1.0) - (vec3f(1.0) - printed) * keep;
  return vec4f(mix(own.rgb, linearToSrgb(glowing), params.amount), own.a);
}

// The earlier Paper Print (createEarlierPaperPrintGraph in paperPrintEffectGraph.ts), kept for graph-less saves from
// before Texture: brightness plus a value-noise grain pressed between Ink and Paper.
@fragment
fn paperPrintEarlierFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let pixel = floor(input.uv * params.resolution);
  // Exactly as saved (3.2.7): Press Grain in output pixels.
  let grain = noise2d(pixel / max(params.scale, 1.0)) - 0.5;
  let pressed = smoothstep(0.15, 0.85, luminance(color.rgb) + grain * 0.3);
  let printColor = mix(params.colorA.rgb, params.colorB.rgb, pressed) * (0.92 + grain * 0.08);
  return vec4f(mix(color.rgb, printColor, params.amount), color.a);
}

// Paper Print (createDefaultPaperPrintGraph in paperPrintGrainGraph.ts): one ink on paper by a stochastic grain. The
// grain is two-octave Fractal Noise on cells of Grain Size, evened out to a uniform threshold (PAPER_PRINT_EVEN); each
// pixel's share of ink comes from its brightness between Paper and Ink in linear light; the paper's surface (Texture,
// read from the variant slot) lifts the threshold in its valleys and shades the print.
@fragment
fn paperPrintFragment(input: VertexOutput) -> @location(0) vec4f {
  let color = source(input.uv);
  let pixel = input.uv * params.resolution;
  let grain = referencePixels(max(params.scale, 1.0));
  let centred = imageGraphFractalNoise(imageRotate2d(pixel, 0.5) / grain, 2.0, 0.5) - 0.5;
  let spread = centred * 13.46 + centred * centred * centred * 67.7;
  let threshold = 1.0 / (1.0 + exp(0.0 - spread));
  let inkLinear = srgbToLinear(params.colorA.rgb);
  let paperLinear = srgbToLinear(params.colorB.rgb);
  let span = luminance(paperLinear) - luminance(inkLinear);
  let safeSpan = select(min(span, 0.0 - 1e-4), max(span, 1e-4), span > 0.0);
  let share = clamp((luminance(paperLinear) - luminance(srgbToLinear(color.rgb))) / safeSpan, 0.0, 1.0);
  let texture = max(params.variant, 0.0);
  let surface = imageGraphFractalNoise(pixel / (3.0 * frameScale()) + vec2f(37.17, 11.83), 3.0, 0.5) - 0.5;
  let lifted = threshold + max(0.0 - surface, 0.0) * 2.0 * texture * (1.0 - share);
  let width = max(min(1.8 / grain, min(share, 1.0 - share) * 2.0), 1e-6);
  let coverage = clamp((share - lifted) / width + 0.5, 0.0, 1.0);
  let printed = mix(paperLinear, inkLinear, coverage) * (1.0 + surface * 0.4 * texture);
  return vec4f(mix(color.rgb, linearToSrgb(clamp(printed, vec3f(0.0), vec3f(1.0))), params.amount), color.a);
}

@fragment
fn pixelPosterFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = referencePixels(max(params.scale, 2.0));
  let uv = (floor(input.uv * params.resolution / grid) + 0.5) * grid / params.resolution;
  let color = source(uv);
  let poster = floor(color.rgb * 5.0) / 4.0;
  return vec4f(mix(color.rgb, poster, params.amount), color.a);
}

@fragment
fn toneGeometryFragment(input: VertexOutput) -> @location(0) vec4f {
  let uv = rotated(input.uv + vec2f(sin(params.time * params.speed) * 0.002, 0.0));
  let cell = fract(uv * params.resolution / referencePixels(max(params.scale, 3.0))) - 0.5;
  let color = source(input.uv);
  let size = (1.0 - luminance(color.rgb)) * 0.65;
  var dist = max(abs(cell.x), abs(cell.y));
  if (params.variant > 0.5 && params.variant < 1.5) { dist = length(cell); }
  if (params.variant > 1.5) { dist = max(abs(cell.x), cell.y * 0.75 - 0.15); }
  let shape = 1.0 - smoothstep(size - 0.04, size + 0.04, dist);
  return vec4f(mix(color.rgb, mix(params.colorB.rgb, params.colorA.rgb, shape), params.amount), color.a);
}

@fragment
fn crossStitchFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = fract(input.uv * params.resolution / referencePixels(max(params.scale, 3.0))) - 0.5;
  let color = source(input.uv);
  let line = min(abs(cell.x - cell.y), abs(cell.x + cell.y));
  let stitch = (1.0 - smoothstep(0.04, 0.1, line)) * step(length(cell), 0.62);
  let ink = mix(params.colorB.rgb, color.rgb * params.colorA.rgb, stitch);
  return vec4f(mix(color.rgb, ink, params.amount), color.a);
}

@fragment
fn glitchGridFragment(input: VertexOutput) -> @location(0) vec4f {
  let cell = floor(input.uv * params.resolution / referencePixels(max(params.scale, 2.0)));
  let tick = floor(params.time * params.speed * 8.0);
  let jump = (hash(cell + tick) - 0.5) * params.amount;
  let enabledCell = step(0.82, hash(vec2f(cell.y, tick)));
  let uv = input.uv + vec2f(jump * enabledCell * 0.12, 0.0);
  return source(uv);
}

@fragment
fn scatterMosaicFragment(input: VertexOutput) -> @location(0) vec4f {
  let grid = referencePixels(max(params.scale, 3.0));
  let cell = floor(input.uv * params.resolution / grid);
  let jitter = vec2f(hash(cell), hash(cell + 17.0)) - 0.5;
  let drift = sin(params.time * params.speed + hash(cell) * TAU);
  let uv = (cell + 0.5 + jitter * params.amount * drift) * grid / params.resolution;
  return source(uv);
}

// Turns a vector like the graph's Rotate UV operator (coordinateRotation.wgsl), so both stay bit-identical.
fn driftRotate(value: vec2f, angle: f32) -> vec2f {
  let sine = sin(angle);
  let cosine = cos(angle);
  return vec2f(value.x * cosine - value.y * sine, value.x * sine + value.y * cosine);
}

@fragment
fn driftLinesFragment(input: VertexOutput) -> @location(0) vec4f {
  // The operations of createDriftLinesGraph in its order: bands of Scale pixels of a 1080p frame
  // (shorter side, at least one pixel) at Angle (counter-clockwise), counted from the top edge.
  let center = params.resolution * 0.5;
  let radians = params.angle * 0.017453292519943295;
  let across = driftRotate(input.uv * params.resolution - center, radians).y + center.y;
  let rowHeight = max(max(params.scale, 2.0) * (min(params.resolution.x, params.resolution.y) / 1080.0), 1.0);
  let row = floor(across / rowHeight);
  let phase = row * 0.71 + params.time * params.speed * 2.0;
  let shift = sin(phase) * params.amount * (params.resolution.x * 0.06);
  let offset = driftRotate(vec2f(shift, 0.0), 0.0 - radians);
  let sampled = source(input.uv + offset / params.resolution);
  let line = 0.82 + sin(across * PI / rowHeight) * 0.18;
  return vec4f(sampled.rgb * line, sampled.a);
}
