const PI: f32 = 3.141592653589793;
const TAU: f32 = 6.283185307179586;
const SIGNAL_WIDTH: i32 = 864;
const SIGNAL_HEIGHT: i32 = 313;
const DECODED_WIDTH: i32 = 360;
const DECODED_HEIGHT: i32 = 288;
const ACTIVE_START: i32 = 162;
const ACTIVE_TOP: i32 = 12;
const SAMPLE_RATE_MHZ: f32 = 13.5;
const PAL_SUBCARRIER_RATIO: f32 = 4.43361875 / 13.5;
const PAL_CYCLES_PER_LINE: f32 = 4.43361875 * 64.0;

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

fn activeYuv(uv: vec2f) -> vec3f {
  return rgbToYuv(sourceBilinear(uv).rgb);
}

@compute @workgroup_size(8, 8)
fn palEncodeCompute(@builtin(global_invocation_id) invocation: vec3u) {
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
  } else if (sample >= ACTIVE_START && line >= ACTIVE_TOP && line < ACTIVE_TOP + DECODED_HEIGHT) {
    let uv = vec2f(
      f32(sample - ACTIVE_START) / f32(SIGNAL_WIDTH - ACTIVE_START - 1),
      f32(line - ACTIVE_TOP) / f32(DECODED_HEIGHT - 1)
    );
    yuv = activeYuv(uv);
    let phaseError = params.palPhaseErrorDegrees * PI / 180.0 * lineVSign(line);
    let chromaPhase = phase + phaseError;
    let chroma = yuv.y * sin(chromaPhase) + lineVSign(line) * yuv.z * cos(chromaPhase);
    composite = yuv.x * 0.7 + chroma * 0.18 * clamp(params.chromaLevel, 0.0, 2.0);
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

@compute @workgroup_size(8, 8)
fn vhsTransportCompute(@builtin(global_invocation_id) invocation: vec3u) {
  if (invocation.x >= u32(SIGNAL_WIDTH) || invocation.y >= u32(SIGNAL_HEIGHT)) { return; }
  let sample = i32(invocation.x);
  let line = i32(invocation.y);
  if (params.vhsAmount <= 0.0001) {
    textureStore(stageOutput, vec2i(sample, line), stageLoad(vec2i(sample, line)));
    return;
  }

  let speedPenalty = params.tapeSpeed * 0.52;
  let lineWave = sin(f32(line) * 0.047 + params.time * 0.91)
    + 0.55 * smoothLineNoise(f32(line) + params.time * 18.0, 11.0, 0x91e1u);
  let transportOffset = lineWave * params.timebaseError * (2.2 + speedPenalty * 2.0);
  let trackingCenter = fract(params.seed * 0.137 + params.time * (0.018 + speedPenalty * 0.006));
  let linePosition = f32(line - ACTIVE_TOP) / f32(DECODED_HEIGHT);
  let trackingBand = exp(-pow(wrappedDistance(fract(linePosition), trackingCenter) / 0.065, 2.0)) * params.tracking;
  let headZone = smoothstep(f32(ACTIVE_TOP + DECODED_HEIGHT - 13), f32(ACTIVE_TOP + DECODED_HEIGHT - 2), f32(line));
  let headOffset = headZone * params.headSwitching * (3.5 + 2.5 * randomSigned(line, 0, 0xd317u));
  let warpedSample = f32(sample) + params.vhsAmount * (transportOffset + trackingBand * 6.5 + headOffset);

  let center = stageLinear(warpedSample, line);
  let near = (stageLinear(warpedSample - 2.0, line).x + center.x * 2.0 + stageLinear(warpedSample + 2.0, line).x) * 0.25;
  let far = (stageLinear(warpedSample - 5.0, line).x + stageLinear(warpedSample + 5.0, line).x) * 0.5;
  let softness = clamp(params.vhsAmount * (0.14 + params.chromaBleed * 0.34 + speedPenalty * 0.16), 0.0, 0.78);
  var tapeSignal = mix(center.x, mix(near, far, 0.22 + params.chromaBleed * 0.34), softness);

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
  let dropoutMask = dropoutActive * dropoutShape * params.vhsAmount;
  let replacement = stageLinear(warpedSample, max(line - 1, 0)).x;
  tapeSignal = mix(tapeSignal, replacement, dropoutMask * 0.94);
  let dropoutEdge = dropoutActive * max(
    1.0 - smoothstep(0.0, 0.035, abs(localSample - dropoutStart)),
    1.0 - smoothstep(0.0, 0.035, abs(localSample - dropoutStart - dropoutLength))
  );

  let tapeNoise = randomSigned(sample, line, 0xa3c59u)
    * params.vhsAmount
    * (0.008 + params.tapeWear * 0.055 + trackingBand * 0.12 + headZone * params.headSwitching * 0.1 + speedPenalty * 0.018);
  tapeSignal += tapeNoise + dropoutEdge * params.dropout * randomSigned(sample, line, 0xf12c7u) * 0.32;
  textureStore(stageOutput, vec2i(sample, line), vec4f(tapeSignal, center.y, dropoutMask, trackingBand + headZone));
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

fn decodeYuvAt(sample: i32, line: i32, burstPhase: f32) -> vec3f {
  var lumaNarrow = 0.0;
  var lumaWide = 0.0;
  var chromaU = 0.0;
  var chromaV = 0.0;
  var weightSum = 0.0;
  let chromaRadius = mix(3.8, 1.35, clamp(params.chromaBandwidth, 0.0, 1.0))
    + params.vhsAmount * params.chromaBleed * 0.6;
  for (var offset = -3; offset <= 3; offset += 1) {
    let offsetF = f32(offset);
    let weight = max(0.0, 1.0 - abs(offsetF) / chromaRadius);
    let composite = decodedSample(sample + offset, line);
    let phase = palPhase(f32(sample + offset), f32(line)) + burstPhase;
    lumaNarrow += composite;
    if (abs(offset) <= 1) { lumaWide += composite; }
    chromaU += composite * sin(phase) * weight;
    chromaV += composite * cos(phase) * weight;
    weightSum += weight;
  }
  let filteredLuma = mix(lumaNarrow / 7.0, lumaWide / 3.0, clamp(params.lumaBandwidth, 0.0, 1.0));
  let compositeLuma = decodedSample(sample, line);
  let luma = mix(filteredLuma, compositeLuma, clamp(params.ycCrosstalk, 0.0, 1.0));
  let scale = 2.0 / max(weightSum * 0.18, 0.001);
  return vec3f(
    clamp(luma / 0.7, -0.15, 1.25),
    chromaU * scale,
    chromaV * scale * lineVSign(line)
  );
}

@compute @workgroup_size(8, 8)
fn palDecodeCompute(@builtin(global_invocation_id) invocation: vec3u) {
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
  let activeSpan = f32(SIGNAL_WIDTH - ACTIVE_START - 1);
  let nominalSample = f32(ACTIVE_START) + (f32(outputPixel.x) + 0.5) / f32(DECODED_WIDTH) * activeSpan;
  let sample = i32(round(nominalSample + syncOffset));
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
  let inside = select(0.0, 1.0, all(displayUv >= vec2f(0.0)) && all(displayUv <= vec2f(1.0)));
  let decoded = mix(sourceBilinear(displayUv).rgb, decodedBilinear(displayUv), signalAmount);
  let bloomOffset = vec2f(1.75 / f32(DECODED_WIDTH), 0.0);
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
