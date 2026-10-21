const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const SIGNAL_WIDTH: i32 = 864;
const SIGNAL_HEIGHT: i32 = 313;
// One decoded pixel per active PAL sample (BT.601: 702 picture samples at 13.5 MHz) and per field line.
const DECODED_WIDTH: i32 = 702;
const DECODED_HEIGHT: i32 = 288;
// The picture starts behind a 16-sample margin after the burst and ends 16 samples before the line
// does. Both margins carry the picture's edge colour (a TV overscans them), so filters at the frame
// edges and small sync shifts read picture instead of blanking.
const ACTIVE_START: i32 = 146;
const PICTURE_MARGIN: i32 = 16;
const ACTIVE_TOP: i32 = 12;
const SAMPLE_RATE_MHZ: f32 = 13.5;
const PAL_SUBCARRIER_MHZ: f32 = 4.43361875;
const PAL_SUBCARRIER_RATIO: f32 = 4.43361875 / 13.5;
const PAL_CYCLES_PER_LINE: f32 = 4.43361875 * 64.0;
// Luma filters are symmetric FIRs of 2 * LUMA_REACH + 1 taps (shared by a workgroup).
const LUMA_REACH: i32 = 20;
const LUMA_TAPS: u32 = 41u;
// Gain of the chroma high-pass (sample minus its 3-sample mean) at the subcarrier frequency.
const SUBCARRIER_HIGHPASS_GAIN: f32 = 0.981;
// First sample after the sync pulse: chroma separation ignores the sync edge before it.
const BURST_GATE_START: i32 = 90;
// Legacy fixed-schedule bloom offset: 1.75 samples of the former 360-wide raster, as a share of the width.
const LEGACY_BLOOM_OFFSET: f32 = 1.75 / 360.0;

struct AnalogParams {
  outputSize: vec2f,
  time: f32,
  seed: f32,

  amount: f32,
  signalStrength: f32,
  rfNoise: f32,
  impulseNoise: f32,

  ghostLevel: f32,
  ghostDelayUs: f32,
  ghostPhaseDegrees: f32,
  multipathDrift: f32,

  tuning: f32,
  interference: f32,
  syncInstability: f32,
  colorLock: f32,

  vhsAmount: f32,
  tracking: f32,
  dropout: f32,
  timebaseError: f32,

  tapeWear: f32,
  chromaBleed: f32,
  headSwitching: f32,
  tapeSpeed: f32,

  crtAmount: f32,
  scanlines: f32,
  maskStrength: f32,
  bloom: f32,

  curvature: f32,
  flicker: f32,
  decoderMode: f32,
  _padding: f32,

  palAmount: f32,
  lumaBandwidth: f32,
  chromaBandwidth: f32,
  chromaLevel: f32,

  ycCrosstalk: f32,
  palPhaseErrorDegrees: f32,
  rfAmount: f32,
  receiverAmount: f32,
};

struct LineStateBuffer {
  lines: array<vec4f>,
};

@group(0) @binding(1) var sourceTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: AnalogParams;
@group(0) @binding(3) var stageInput: texture_2d<f32>;
@group(0) @binding(4) var stageOutput: texture_storage_2d<rgba16float, write>;
@group(0) @binding(5) var finalOutput: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(6) var<storage, read_write> lineStates: LineStateBuffer;

fn hashU32(value: u32) -> u32 {
  var result = value;
  result = result ^ (result >> 16u);
  result = result * 0x7feb352du;
  result = result ^ (result >> 15u);
  result = result * 0x846ca68bu;
  return result ^ (result >> 16u);
}

fn random01(value: u32) -> f32 {
  return f32(hashU32(value) & 0x00ffffffu) / 16777216.0;
}

fn randomSigned(x: i32, y: i32, salt: u32) -> f32 {
  let seed = u32(max(params.seed, 0.0));
  let field = u32(max(floor(params.time * 50.0), 0.0));
  let key = (u32(max(x, 0)) * 0x9e3779b9u)
    ^ (u32(max(y, 0)) * 0x85ebca6bu)
    ^ (field * 0xc2b2ae35u)
    ^ (seed * 0x27d4eb2du)
    ^ salt;
  return random01(key) * 2.0 - 1.0;
}

fn smoothLineNoise(line: f32, scale: f32, salt: u32) -> f32 {
  let position = line / max(scale, 1.0);
  let lower = i32(floor(position));
  let blend = fract(position);
  let shaped = blend * blend * (3.0 - 2.0 * blend);
  return mix(randomSigned(lower, 0, salt), randomSigned(lower + 1, 0, salt), shaped);
}

fn palPhase(sample: f32, line: f32) -> f32 {
  let cycles = sample * PAL_SUBCARRIER_RATIO + line * PAL_CYCLES_PER_LINE;
  return TAU * fract(cycles);
}

fn lineVSign(line: i32) -> f32 {
  return select(1.0, -1.0, (line & 1) == 1);
}

fn sourceBilinear(uv: vec2f) -> vec4f {
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let maximum = dimensions - 1;
  let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(dimensions) - 0.5;
  let origin = vec2i(floor(position));
  let fraction = fract(position);
  let a = textureLoad(sourceTexture, clamp(origin, vec2i(0), maximum), 0);
  let b = textureLoad(sourceTexture, clamp(origin + vec2i(1, 0), vec2i(0), maximum), 0);
  let c = textureLoad(sourceTexture, clamp(origin + vec2i(0, 1), vec2i(0), maximum), 0);
  let d = textureLoad(sourceTexture, clamp(origin + vec2i(1, 1), vec2i(0), maximum), 0);
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

fn rgbToYuv(rgb: vec3f) -> vec3f {
  let y = dot(rgb, vec3f(0.299, 0.587, 0.114));
  return vec3f(y, 0.492 * (rgb.b - y), 0.877 * (rgb.r - y));
}

fn yuvToRgb(yuv: vec3f) -> vec3f {
  return vec3f(
    yuv.x + 1.140 * yuv.z,
    yuv.x - 0.395 * yuv.y - 0.581 * yuv.z,
    yuv.x + 2.032 * yuv.y
  );
}

fn gaussianWeight(offset: f32, sigma: f32) -> f32 {
  return exp(-0.5 * offset * offset / (sigma * sigma));
}

fn raisedCosineFall(x: f32) -> f32 {
  return select(select(0.5 + 0.5 * cos(PI * x), 0.0, x >= 1.0), 1.0, x <= 0.0);
}

// Luma Bandwidth sets the luma cutoff of the whole PAL chain: 2.5 MHz at 0 to 5.5 MHz at 1.
fn lumaCutoffMhz() -> f32 {
  return 2.5 + 3.0 * clamp(params.lumaBandwidth, 0.0, 1.0);
}

// Chroma Bandwidth sets the decoder's U/V cutoff: 0.6 MHz at 0 to 1.3 MHz at 1.
fn chromaCutoffMhz() -> f32 {
  return 0.6 + 0.7 * clamp(params.chromaBandwidth, 0.0, 1.0);
}

// Wanted filter response at f MHz: a low-pass to `cutoff` (raised-cosine edge `transition` MHz
// wide, centred on the cutoff) whose band around the 4.43 MHz subcarrier (±halfWidth MHz plus a
// raised-cosine edge) is reduced by `notch` (1 = removed).
fn filterResponse(f: f32, cutoff: f32, transition: f32, notch: f32, halfWidth: f32, edge: f32) -> f32 {
  let lowPass = raisedCosineFall((f - cutoff) / transition + 0.5);
  let band = raisedCosineFall((abs(f - PAL_SUBCARRIER_MHZ) - halfWidth) / edge);
  return lowPass * (1.0 - notch * band);
}

// Tap `k` of the symmetric 41-tap FIR with that response (frequency sampling, Hann window).
// Callers divide by the sum of all taps, so the filter passes flat areas unchanged.
fn filterTap(k: i32, cutoff: f32, transition: f32, notch: f32, halfWidth: f32, edge: f32) -> f32 {
  let step = SAMPLE_RATE_MHZ * 0.5 / 96.0;
  var sum = 0.0;
  for (var index = 0; index < 96; index += 1) {
    let f = (f32(index) + 0.5) * step;
    sum += filterResponse(f, cutoff, transition, notch, halfWidth, edge) * cos(TAU * f * f32(k) / SAMPLE_RATE_MHZ);
  }
  return sum * (0.5 + 0.5 * cos(PI * f32(k) / f32(LUMA_REACH + 1)));
}

fn footprintCoverage(start: f32, end: f32, texel: i32) -> f32 {
  return max(0.0, min(f32(texel + 1), end) - max(f32(texel), start));
}

// The source averaged over the footprint of one PAL sample and field line (a box over every source
// texel it covers, alpha-weighted so transparent texels do not tint edges), as YUV. Any source
// resolution maps onto the same 702 x 288 raster without skipping rows or columns; a source smaller
// than the raster is read with a one-texel box, which interpolates linearly.
@compute @workgroup_size(8, 8)
fn palFootprintCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(DECODED_WIDTH) || invocation.y >= u32(DECODED_HEIGHT)) { return; }
  let dimensions = vec2i(textureDimensions(sourceTexture));
  let size = vec2f(dimensions);
  let cell = size / vec2f(f32(DECODED_WIDTH), f32(DECODED_HEIGHT));
  let centre = (vec2f(invocation.xy) + 0.5) * cell;
  let halfSize = max(cell, vec2f(1.0)) * 0.5;
  let start = centre - halfSize;
  let end = centre + halfSize;
  let first = vec2i(floor(start));
  let last = vec2i(ceil(end)) - 1;
  var weighted = vec3f(0.0);
  var plain = vec3f(0.0);
  var coverage = 0.0;
  var area = 0.0;
  for (var y = first.y; y <= last.y; y += 1) {
    let wy = footprintCoverage(start.y, end.y, y);
    for (var x = first.x; x <= last.x; x += 1) {
      let weight = wy * footprintCoverage(start.x, end.x, x);
      let texel = textureLoad(sourceTexture, clamp(vec2i(x, y), vec2i(0), dimensions - 1), 0);
      weighted += texel.rgb * texel.a * weight;
      plain += texel.rgb * weight;
      coverage += texel.a * weight;
      area += weight;
    }
  }
  let rgb = select(plain / max(area, 1e-6), weighted / max(coverage, 1e-6), coverage > 1e-4 * area);
  textureStore(stageOutput, vec2i(invocation.xy), vec4f(rgbToYuv(rgb), 1.0));
}

var<workgroup> encodeLumaKernel: array<f32, 41>;
var<workgroup> encodeChromaKernel: array<f32, 41>;

// PAL encoder. Luma is low-passed to the Luma Bandwidth cutoff, and its share in the band the
// decoder reads as chroma (the subcarrier ± the decoder's U/V cutoff) is removed except for the
// Y/C Crosstalk share, which then shows as cross-colour on fine detail. Chroma (U/V) is low-passed
// to 1.3 MHz. The picture samples read the footprint raster written by palFootprintCompute.
@compute @workgroup_size(8, 8)
fn palEncodeCompute(@builtin(global_invocation_id) invocation: vec3u, @builtin(local_invocation_index) local: u32) {
  if (local < LUMA_TAPS) {
    let notch = 1.0 - clamp(params.ycCrosstalk, 0.0, 1.0);
    let tap = i32(local) - LUMA_REACH;
    encodeLumaKernel[local] = filterTap(tap, lumaCutoffMhz(), 1.0, notch, chromaCutoffMhz() + 0.35, 0.4);
    encodeChromaKernel[local] = filterTap(tap, 1.3, 0.6, 0.0, 0.0, 1.0);
  }
  workgroupBarrier();
  if (invocation.x >= u32(SIGNAL_WIDTH) || invocation.y >= u32(SIGNAL_HEIGHT)) { return; }
  let sample = i32(invocation.x);
  let line = i32(invocation.y);
  let phase = palPhase(f32(sample), f32(line));
  var composite = 0.0;
  var yuv = vec3f(0.0);

  let verticalSync = line < 3;
  if (verticalSync) {
    composite = select(-0.3, 0.0, sample > SIGNAL_WIDTH / 2);
  } else if (sample >= 23 && sample < 86) {
    composite = -0.3;
  } else if (sample >= 95 && sample < 129) {
    composite = 0.15 * sin(phase);
  } else if (sample >= ACTIVE_START - PICTURE_MARGIN && line >= ACTIVE_TOP && line < ACTIVE_TOP + DECODED_HEIGHT) {
    let column = sample - ACTIVE_START;
    let row = line - ACTIVE_TOP;
    var luma = 0.0;
    var lumaSum = 0.0;
    var chroma = vec2f(0.0);
    var chromaSum = 0.0;
    for (var offset = -LUMA_REACH; offset <= LUMA_REACH; offset += 1) {
      let footprint = textureLoad(stageInput, vec2i(clamp(column + offset, 0, DECODED_WIDTH - 1), row), 0).xyz;
      let lumaWeight = encodeLumaKernel[offset + LUMA_REACH];
      luma += footprint.x * lumaWeight;
      lumaSum += lumaWeight;
      let chromaWeight = encodeChromaKernel[offset + LUMA_REACH];
      chroma += footprint.yz * chromaWeight;
      chromaSum += chromaWeight;
    }
    yuv = vec3f(luma / lumaSum, chroma / chromaSum);
    let phaseError = params.palPhaseErrorDegrees * PI / 180.0 * lineVSign(line);
    let chromaPhase = phase + phaseError;
    let modulated = yuv.y * sin(chromaPhase) + lineVSign(line) * yuv.z * cos(chromaPhase);
    composite = yuv.x * 0.7 + modulated * 0.18 * clamp(params.chromaLevel, 0.0, 2.0);
  }

  textureStore(stageOutput, vec2i(sample, line), vec4f(composite, yuv));
}

fn stageLoad(pixel: vec2i) -> vec4f {
  return textureLoad(stageInput, clamp(pixel, vec2i(0), vec2i(SIGNAL_WIDTH - 1, SIGNAL_HEIGHT - 1)), 0);
}

fn stageLinear(sample: f32, line: i32) -> vec4f {
  let lower = i32(floor(sample));
  let blend = fract(sample);
  return mix(stageLoad(vec2i(lower, line)), stageLoad(vec2i(lower + 1, line)), blend);
}

@compute @workgroup_size(8, 8)
fn rfChannelCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(SIGNAL_WIDTH) || invocation.y >= u32(SIGNAL_HEIGHT)) { return; }
  let sample = i32(invocation.x);
  let line = i32(invocation.y);
  let rfAmount = clamp(params.rfAmount, 0.0, 1.0);
  if (rfAmount <= 0.0001) {
    textureStore(stageOutput, vec2i(sample, line), stageLoad(vec2i(sample, line)));
    return;
  }
  let linePhase = f32(line) * 0.037 + params.time * 0.61;
  let delayDriftUs = params.multipathDrift * rfAmount * 0.2 * sin(linePhase + sin(params.time * 0.23));
  let primaryDelay = max(0.0, (params.ghostDelayUs + delayDriftUs) * SAMPLE_RATE_MHZ);
  let secondaryDelay = primaryDelay * 2.43 + 5.0;
  let center = stageLoad(vec2i(sample, line));
  let softened = (stageLoad(vec2i(sample - 1, line)).x + center.x * 2.0 + stageLoad(vec2i(sample + 1, line)).x) * 0.25;
  let effectiveTuning = params.tuning * rfAmount;
  let sourceSignal = mix(center.x, softened, min(abs(effectiveTuning) * 0.55, 0.75));
  let echoA = stageLinear(f32(sample) - primaryDelay, line).x;
  let echoB = stageLinear(f32(sample) - secondaryDelay, line).x;

  let modulation = 0.72;
  let echoLevel = params.ghostLevel * rfAmount * 0.46;
  let echoBLevel = echoLevel * (0.24 + params.multipathDrift * 0.18);
  let echoPhase = params.ghostPhaseDegrees * PI / 180.0;
  let echoBPhase = echoPhase * 1.71 + 1.13;
  let direct = vec2f(1.0 - modulation * sourceSignal, 0.0);
  let directionA = vec2f(cos(echoPhase), sin(echoPhase));
  let directionB = vec2f(cos(echoBPhase), sin(echoBPhase));
  var carrier = direct
    + directionA * echoLevel * (1.0 - modulation * echoA)
    + directionB * echoBLevel * (1.0 - modulation * echoB);
  let dcCarrier = vec2f(1.0, 0.0) + directionA * echoLevel + directionB * echoBLevel;

  let effectiveSignalStrength = mix(1.0, clamp(params.signalStrength, 0.0, 1.0), rfAmount);
  let weakSignal = 1.0 - effectiveSignalStrength;
  let noiseSigma = params.rfNoise * rfAmount * (0.006 + weakSignal * weakSignal * 0.34 + abs(effectiveTuning) * 0.035);
  let noise = vec2f(
    randomSigned(sample, line, 0x2191u) + randomSigned(sample, line, 0x61c9u),
    randomSigned(sample, line, 0x83abu) + randomSigned(sample, line, 0xb529u)
  ) * noiseSigma * 0.5;
  carrier += noise;

  let beatPhase = TAU * (f32(sample) * 0.0017 + f32(line) * 0.018 + params.time * 1.7);
  let foreignPicture = 0.68 + 0.32 * sin(f32(line) * 0.071 - params.time * 0.43);
  carrier += vec2f(cos(beatPhase), sin(beatPhase)) * params.interference * rfAmount * 0.22 * foreignPicture;

  let impulseCell = sample / 3;
  let impulseChance = params.impulseNoise * rfAmount * (0.001 + weakSignal * 0.0035);
  let impulseRandom = random01(
    (u32(max(impulseCell, 0)) * 0x9e3779b9u)
      ^ (u32(line) * 0x85ebca6bu)
      ^ u32(max(floor(params.time * 50.0), 0.0))
      ^ u32(max(params.seed, 0.0))
  );
  let impulseActive = select(0.0, 1.0, impulseRandom > 1.0 - impulseChance);
  let impulse = impulseActive * params.impulseNoise * rfAmount * (0.65 + 0.85 * random01(u32(sample + line * 11) ^ 0x45d9f3bu));
  carrier += vec2f(impulse, -impulse * 0.37);

  let baseline = max(length(dcCarrier), 0.08);
  let recovered = (baseline - length(carrier)) / (modulation * baseline);
  textureStore(stageOutput, vec2i(sample, line), vec4f(recovered, length(carrier), length(noise), impulseActive));
}

fn wrappedDistance(a: f32, b: f32) -> f32 {
  let distance = abs(a - b);
  return min(distance, 1.0 - distance);
}

// Chroma noise of a tape: smooth along the line (cells of 18 samples), so it streaks sideways.
fn vhsChromaNoise(sample: i32, line: i32, salt: u32) -> f32 {
  let position = f32(max(sample, 0)) / 18.0;
  let cell = i32(floor(position));
  let blend = fract(position);
  return mix(randomSigned(cell, line, salt), randomSigned(cell + 1, line, salt), blend * blend * (3.0 - 2.0 * blend));
}

var<workgroup> tapeLumaKernel: array<f32, 41>;

// Tape luma cutoff in MHz: about 3 MHz in SP, 2.6 in LP and 2.2 in EP, lower with Tape Wear. VHS
// Stage moves it from 6 MHz (no tape filtering) to that value.
fn tapeLumaCutoffMhz() -> f32 {
  let speed = clamp(params.tapeSpeed, 0.0, 2.0);
  let tape = max(3.0 - speed * 0.4 - params.tapeWear * 0.5, 0.5);
  return mix(6.0, tape, clamp(params.vhsAmount, 0.0, 1.0));
}

// VHS colour-under transport. The deck separates luma and chroma, records luma at its own lower
// bandwidth and chroma far below its broadcast bandwidth, and plays chroma back re-modulated on a
// stable reference: luma jitters with the tape (time-base error, tracking, head switching), chroma
// smears sideways and lags but keeps its hue (saturation drops slightly at slower speeds). Taps
// sit on whole samples (a fractional read would weaken the subcarrier); luma is filtered at the
// two samples around the jittered position and interpolated. VHS Stage fades the whole stage in
// from the untouched signal, so a keyframed fade-in starts without a step.
@compute @workgroup_size(8, 8)
fn vhsTransportCompute(@builtin(global_invocation_id) invocation: vec3u, @builtin(local_invocation_index) local: u32) {
  if (local < LUMA_TAPS) {
    tapeLumaKernel[local] = filterTap(i32(local) - LUMA_REACH, tapeLumaCutoffMhz(), 1.0, 1.0, 0.75, 0.7);
  }
  workgroupBarrier();
  if (invocation.x >= u32(SIGNAL_WIDTH) || invocation.y >= u32(SIGNAL_HEIGHT)) { return; }
  let sample = i32(invocation.x);
  let line = i32(invocation.y);
  let incoming = stageLoad(vec2i(sample, line));
  let vhsAmount = clamp(params.vhsAmount, 0.0, 1.0);
  if (vhsAmount <= 0.0001) {
    textureStore(stageOutput, vec2i(sample, line), incoming);
    return;
  }

  let speed = clamp(params.tapeSpeed, 0.0, 2.0);
  let speedPenalty = speed * 0.52;
  let lineWave = sin(f32(line) * 0.047 + params.time * 0.91)
    + 0.55 * smoothLineNoise(f32(line) + params.time * 18.0, 11.0, 0x91e1u);
  let transportOffset = lineWave * params.timebaseError * (2.2 + speedPenalty * 2.0);
  let trackingCenter = fract(params.seed * 0.137 + params.time * (0.018 + speedPenalty * 0.006));
  let linePosition = f32(line - ACTIVE_TOP) / f32(DECODED_HEIGHT);
  let trackingBand = exp(-pow(wrappedDistance(fract(linePosition), trackingCenter) / 0.065, 2.0)) * params.tracking;
  let headZone = smoothstep(f32(ACTIVE_TOP + DECODED_HEIGHT - 13), f32(ACTIVE_TOP + DECODED_HEIGHT - 2), f32(line));
  let headOffset = headZone * params.headSwitching * (3.5 + 2.5 * randomSigned(line, 0, 0xd317u));
  let warpedSample = f32(sample) + vhsAmount * (transportOffset + trackingBand * 6.5 + headOffset);

  // Samples base - LUMA_REACH ... base + LUMA_REACH + 1 around the jittered read position.
  let base = i32(floor(warpedSample));
  let fraction = warpedSample - f32(base);
  // Tape noise enters before the playback luma filter (as on a deck), so it stays below the
  // subcarrier band and does not decode as colour confetti.
  let noiseLevel = vhsAmount
    * (0.02 + params.tapeWear * 0.13 + trackingBand * 0.3 + headZone * params.headSwitching * 0.25 + speedPenalty * 0.045);
  // The noise is smoothed over three samples ([1 2 1] / 4), so it streaks along the line like tape
  // noise instead of forming specks.
  var taps: array<f32, 42>;
  var noise: array<f32, 42>;
  var previousNoise = randomSigned(base - LUMA_REACH + 15, line, 0xa3c59u);
  var currentNoise = randomSigned(base - LUMA_REACH + 16, line, 0xa3c59u);
  for (var index = 0; index < 42; index += 1) {
    let position = base + index - LUMA_REACH;
    let nextNoise = randomSigned(position + 17, line, 0xa3c59u);
    taps[index] = stageLoad(vec2i(position, line)).x;
    noise[index] = (previousNoise + 2.0 * currentNoise + nextNoise) * 0.25 * noiseLevel;
    previousNoise = currentNoise;
    currentNoise = nextNoise;
  }
  // Playback luma: the tape low-pass (the subcarrier band removed) at base and base + 1.
  var lumaA = 0.0;
  var lumaB = 0.0;
  var kernelSum = 0.0;
  for (var index = 0; index < 41; index += 1) {
    let weight = tapeLumaKernel[index];
    lumaA += (taps[index] + noise[index]) * weight;
    lumaB += (taps[index + 1] + noise[index + 1]) * weight;
    kernelSum += weight;
  }
  let luma = mix(lumaA, lumaB, fraction) / kernelSum;
  // Tape chroma: about 0.5 MHz and less with Chroma Bleed, which also delays chroma by up to
  // 2.5 samples (colour lags to the right).
  let chromaSigma = clamp(mix(1.4, 3.0 + speed * 0.5 + params.chromaBleed * 1.5, vhsAmount), 0.5, 5.0);
  let chromaDelay = clamp(vhsAmount * params.chromaBleed * 2.5, -4.0, 4.0);
  // Sync and blanking before the burst carry no chroma; keep the sync edge out of the burst.
  let gateStart = select(-1000, BURST_GATE_START, sample >= BURST_GATE_START);
  var chroma = vec2f(0.0);
  var chromaWeight = 0.0;
  for (var offset = -10; offset <= 10; offset += 1) {
    let index = offset + LUMA_REACH;
    let mean = (taps[index - 1] + taps[index] + taps[index + 1]) / 3.0;
    let position = base + offset;
    let wc = select(gaussianWeight(f32(offset) - fraction + chromaDelay, chromaSigma), 0.0, position < gateStart);
    let phase = palPhase(f32(position), f32(line));
    chroma += (taps[index] - mean) * vec2f(sin(phase), cos(phase)) * wc;
    chromaWeight += wc;
  }
  // Demodulated chroma in composite units (amplitude of the sin and cos carriers).
  chroma *= 2.0 / max(chromaWeight * SUBCARRIER_HIGHPASS_GAIN, 1e-6);
  // The burst passes unchanged; the picture loses a little saturation and gains sideways chroma streaks.
  let picture = select(0.0, 1.0, sample >= 129);
  let saturation = mix(1.0, 0.93 - speed * 0.06, vhsAmount * picture);
  let streak = vhsAmount * picture * (0.001 + params.tapeWear * 0.006 + speedPenalty * 0.003 + trackingBand * 0.012);
  chroma = chroma * saturation * select(1.0, 0.0, sample < BURST_GATE_START)
    + vec2f(vhsChromaNoise(sample, line, 0x5bd1u), vhsChromaNoise(sample, line, 0x2c9fu)) * streak;
  let stablePhase = palPhase(f32(sample), f32(line));
  var tapeSignal = luma + chroma.x * sin(stablePhase) + chroma.y * cos(stablePhase);
  let center = stageLinear(warpedSample, line);

  let segment = sample / 48;
  let segmentKey = (u32(max(segment, 0)) * 0x27d4eb2du)
    ^ (u32(line) * 0x165667b1u)
    ^ (u32(max(floor(params.time * 50.0), 0.0)) * 0x9e3779b9u)
    ^ u32(max(params.seed, 0.0));
  let dropoutProbability = params.dropout * (0.035 + params.tapeWear * 0.1 + speedPenalty * 0.025);
  let dropoutActive = select(0.0, 1.0, random01(segmentKey) > 1.0 - dropoutProbability);
  let localSample = f32(sample - segment * 48) / 48.0;
  let dropoutStart = random01(segmentKey ^ 0x68bc21ebu) * 0.58;
  let dropoutLength = 0.12 + random01(segmentKey ^ 0x02e5be93u) * 0.34;
  let dropoutShape = smoothstep(dropoutStart, dropoutStart + 0.035, localSample)
    * (1.0 - smoothstep(dropoutStart + dropoutLength - 0.035, dropoutStart + dropoutLength, localSample));
  let dropoutMask = dropoutActive * dropoutShape * vhsAmount;
  let replacement = stageLinear(warpedSample, max(line - 1, 0)).x;
  tapeSignal = mix(tapeSignal, replacement, dropoutMask * 0.94);
  let dropoutEdge = dropoutActive * max(
    1.0 - smoothstep(0.0, 0.035, abs(localSample - dropoutStart)),
    1.0 - smoothstep(0.0, 0.035, abs(localSample - dropoutStart - dropoutLength))
  );

  tapeSignal += dropoutEdge * params.dropout * randomSigned(sample, line, 0xf12c7u) * 0.32;
  // Fade the stage in over the first tenth of VHS Stage (continuous from the untouched signal).
  let stageMix = smoothstep(0.0, 0.1, vhsAmount);
  textureStore(stageOutput, vec2i(sample, line), vec4f(mix(incoming.x, tapeSignal, stageMix), center.y, dropoutMask, trackingBand + headZone));
}

@compute @workgroup_size(1, 1)
fn receiverAnalyzeCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.y >= u32(SIGNAL_HEIGHT)) { return; }
  let line = i32(invocation.y);
  var bestSlope = -1000.0;
  var detectedSync = 23.0;
  var minimumSync = 1.0;
  for (var sample = 6; sample < 56; sample += 1) {
    let previous = stageLoad(vec2i(sample - 1, line)).x;
    let current = stageLoad(vec2i(sample, line)).x;
    let slope = previous - current;
    if (current < -0.1 && slope > bestSlope) {
      bestSlope = slope;
      detectedSync = f32(sample);
    }
    minimumSync = min(minimumSync, current);
  }

  var burstI = 0.0;
  var burstQ = 0.0;
  for (var sample = 95; sample < 129; sample += 1) {
    let value = stageLoad(vec2i(sample, line)).x;
    let phase = palPhase(f32(sample), f32(line));
    burstI += value * sin(phase);
    burstQ += value * cos(phase);
  }
  let burstVector = vec2f(burstI, burstQ) / 34.0;
  let burstStrength = clamp(length(burstVector) / 0.075, 0.0, 2.0);
  let burstPhase = atan2(burstVector.y, burstVector.x);
  let syncConfidence = clamp((-minimumSync - 0.04) / 0.26, 0.0, 1.0);
  lineStates.lines[line] = vec4f(detectedSync - 23.0, burstPhase, burstStrength, syncConfidence);
}

fn decodedSample(sample: i32, line: i32) -> f32 {
  return stageLoad(vec2i(sample, line)).x;
}

var<workgroup> decodeLumaKernel: array<f32, 41>;
var<workgroup> decodeChromaKernel: array<f32, 41>;

// Separates one decoded sample into Y and U/V.
// - Luma: a low-pass to the Luma Bandwidth cutoff with a notch over the chroma band (about 3.6
//   to 5.2 MHz removed); Y/C Crosstalk lets the raw composite (dot crawl) through.
// - Chroma: the composite minus its 3-sample mean (exactly zero for flat areas) is demodulated with
//   the burst-locked phase and low-passed to the Chroma Bandwidth cutoff (0.6 to 1.3 MHz).
fn decodeYuvAt(sample: i32, line: i32, burstPhase: f32) -> vec3f {
  var composite: array<f32, 43>;
  for (var index = 0; index < 43; index += 1) {
    composite[index] = decodedSample(sample + index - LUMA_REACH - 1, line);
  }
  var chroma = vec2f(0.0);
  var weightSum = 0.0;
  var filteredLuma = 0.0;
  var lumaSum = 0.0;
  for (var offset = -LUMA_REACH; offset <= LUMA_REACH; offset += 1) {
    let index = offset + LUMA_REACH + 1;
    let mean = (composite[index - 1] + composite[index] + composite[index + 1]) / 3.0;
    let weight = decodeChromaKernel[offset + LUMA_REACH];
    let phase = palPhase(f32(sample + offset), f32(line)) + burstPhase;
    chroma += (composite[index] - mean) * vec2f(sin(phase), cos(phase)) * weight;
    weightSum += weight;
    filteredLuma += composite[index] * decodeLumaKernel[offset + LUMA_REACH];
    lumaSum += decodeLumaKernel[offset + LUMA_REACH];
  }
  let luma = mix(filteredLuma / lumaSum, composite[LUMA_REACH + 1], clamp(params.ycCrosstalk, 0.0, 1.0));
  let scale = 2.0 / max(weightSum * 0.18 * SUBCARRIER_HIGHPASS_GAIN, 0.001);
  return vec3f(
    clamp(luma / 0.7, -0.15, 1.25),
    chroma.x * scale,
    chroma.y * scale * lineVSign(line)
  );
}

@compute @workgroup_size(8, 8)
fn palDecodeCompute(@builtin(global_invocation_id) invocation: vec3u, @builtin(local_invocation_index) local: u32) {
  if (local < LUMA_TAPS) {
    let tap = i32(local) - LUMA_REACH;
    decodeLumaKernel[local] = filterTap(tap, lumaCutoffMhz(), 1.0, 1.0, 0.8, 0.5);
    decodeChromaKernel[local] = filterTap(tap, chromaCutoffMhz(), 0.5, 0.0, 0.0, 1.0);
  }
  workgroupBarrier();
  if (invocation.x >= u32(DECODED_WIDTH) || invocation.y >= u32(DECODED_HEIGHT)) { return; }
  let outputPixel = vec2i(invocation.xy);
  let receiverAmount = clamp(params.receiverAmount, 0.0, 1.0);
  let effectiveSignalStrength = mix(1.0, clamp(params.signalStrength, 0.0, 1.0), clamp(params.rfAmount, 0.0, 1.0));
  let weakSignal = 1.0 - effectiveSignalStrength;
  let syncInstability = params.syncInstability * receiverAmount;
  let verticalLoss = clamp((weakSignal - 0.64) * 2.8 * syncInstability, 0.0, 1.0);
  let rollLines = i32(floor(fract(params.time * (0.08 + params.syncInstability * 0.22)) * f32(DECODED_HEIGHT) * verticalLoss));
  let activeLine = (outputPixel.y + rollLines) % DECODED_HEIGHT;
  let signalLine = activeLine + ACTIVE_TOP;
  let state = lineStates.lines[signalLine];
  let falseLock = (1.0 - state.w) * syncInstability;
  let randomTear = randomSigned(signalLine, i32(floor(params.time * 50.0)), 0x731bu) * falseLock * 34.0;
  let syncOffset = state.x * receiverAmount + randomTear;
  // One decoded pixel per picture sample; the sync offset shifts the read along the line.
  let sample = ACTIVE_START + outputPixel.x + i32(round(syncOffset));
  let effectiveColorLock = mix(1.0, clamp(params.colorLock, 0.0, 1.0), receiverAmount);
  let phaseCorrection = state.y * effectiveColorLock;
  var yuv = decodeYuvAt(sample, signalLine, phaseCorrection);

  if (params.decoderMode >= 0.5) {
    let previousLine = max(signalLine - 1, ACTIVE_TOP);
    let previousState = lineStates.lines[previousLine];
    let previous = decodeYuvAt(sample, previousLine, previousState.y * effectiveColorLock);
    let chromaBlend = select(0.5, 0.68, params.decoderMode >= 1.5);
    yuv = vec3f(yuv.x, mix(yuv.yz, previous.yz, chromaBlend));
    if (params.decoderMode >= 1.5) {
      yuv.x = mix(yuv.x, previous.x, 0.16);
    }
  }

  let lockThreshold = mix(0.42, 0.08, effectiveColorLock);
  let chromaLock = smoothstep(lockThreshold, lockThreshold + 0.18, state.z * state.w);
  let unlockedPhase = randomSigned(signalLine, i32(floor(params.time * 12.0)), 0x4f1du) * (1.0 - chromaLock) * PI;
  let rotatedChroma = vec2f(
    yuv.y * cos(unlockedPhase) - yuv.z * sin(unlockedPhase),
    yuv.y * sin(unlockedPhase) + yuv.z * cos(unlockedPhase)
  ) * chromaLock;
  yuv = vec3f(yuv.x, rotatedChroma);

  let decoded = clamp(yuvToRgb(yuv), vec3f(0.0), vec3f(1.0));
  textureStore(stageOutput, outputPixel, vec4f(decoded, 1.0));
}

fn decodedBilinear(uv: vec2f) -> vec3f {
  let position = clamp(uv, vec2f(0.0), vec2f(1.0)) * vec2f(f32(DECODED_WIDTH), f32(DECODED_HEIGHT)) - 0.5;
  let origin = vec2i(floor(position));
  let fraction = fract(position);
  let maximum = vec2i(DECODED_WIDTH - 1, DECODED_HEIGHT - 1);
  let a = stageLoad(clamp(origin, vec2i(0), maximum)).rgb;
  let b = stageLoad(clamp(origin + vec2i(1, 0), vec2i(0), maximum)).rgb;
  let c = stageLoad(clamp(origin + vec2i(0, 1), vec2i(0), maximum)).rgb;
  let d = stageLoad(clamp(origin + vec2i(1, 1), vec2i(0), maximum)).rgb;
  return mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
}

@compute @workgroup_size(8, 8)
fn analogResolveCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(params.outputSize.x) || invocation.y >= u32(params.outputSize.y)) { return; }
  let pixel = vec2i(invocation.xy);
  let uv = (vec2f(invocation.xy) + 0.5) / params.outputSize;
  let original = sourceBilinear(uv);
  let signalAmount = clamp(max(max(params.palAmount, params.rfAmount), max(params.receiverAmount, params.vhsAmount)), 0.0, 1.0);
  let crtAmount = clamp(params.crtAmount, 0.0, 1.0);
  if (signalAmount <= 0.0001 && crtAmount <= 0.0001) {
    textureStore(finalOutput, pixel, original);
    return;
  }
  let centered = uv * 2.0 - 1.0;
  let curved = centered * (1.0 + dot(centered, centered) * params.curvature * crtAmount * 0.12);
  let displayUv = curved * 0.5 + 0.5;
  // Tube coverage, anti-aliased over one output pixel.
  let insideLow = clamp(displayUv * params.outputSize + 0.5, vec2f(0.0), vec2f(1.0));
  let insideHigh = clamp((1.0 - displayUv) * params.outputSize + 0.5, vec2f(0.0), vec2f(1.0));
  let inside = (insideLow.x * insideHigh.x) * (insideLow.y * insideHigh.y);
  let decoded = mix(sourceBilinear(displayUv).rgb, decodedBilinear(displayUv), signalAmount);
  let bloomOffset = vec2f(LEGACY_BLOOM_OFFSET, 0.0);
  let bloomDecoded = (decodedBilinear(displayUv - bloomOffset) + decodedBilinear(displayUv + bloomOffset)) * 0.5;
  let bloomOriginal = (sourceBilinear(displayUv - bloomOffset).rgb + sourceBilinear(displayUv + bloomOffset).rgb) * 0.5;
  let bloomColor = mix(bloomOriginal, bloomDecoded, signalAmount);
  let brightness = dot(decoded, vec3f(0.299, 0.587, 0.114));
  var crt = decoded + bloomColor * params.bloom * crtAmount * smoothstep(0.55, 1.0, brightness) * 0.2;

  // Reconstruct the two interlaced PAL fields for the display stage. The
  // transport works on one 288-line field, while a PAL CRT exposes 576
  // visible line positions over a complete frame.
  let scanPhase = fract(displayUv.y * 576.0);
  let scanProfile = 0.58 + 0.42 * sin(scanPhase * PI);
  crt *= mix(1.0, scanProfile, params.scanlines * crtAmount);
  let maskIndex = u32(invocation.x) % 3u;
  var mask = vec3f(0.78, 0.78, 0.78);
  if (maskIndex == 0u) { mask.r = 1.0; }
  if (maskIndex == 1u) { mask.g = 1.0; }
  if (maskIndex == 2u) { mask.b = 1.0; }
  crt *= mix(vec3f(1.0), mask, params.maskStrength * crtAmount);
  let fieldFlicker = 1.0 - params.flicker * crtAmount * 0.055
    * (0.5 + 0.5 * sin(params.time * TAU * 49.73));
  crt *= fieldFlicker * inside;

  let analog = mix(decoded, crt, crtAmount);
  let mixed = mix(original.rgb, clamp(analog, vec3f(0.0), vec3f(1.0)), clamp(params.amount, 0.0, 1.0));
  textureStore(finalOutput, pixel, vec4f(mixed, original.a));
}
