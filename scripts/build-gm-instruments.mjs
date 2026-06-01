// Offline GM asset converter (issue #193, 2b).
//
// Reads the FluidR3 GM SoundFont (MIT) and writes one JSON per GM program (and drum
// kit) into public/instruments/gm/, in the schema from src/types/gmAsset.ts. RUN
// OFFLINE — never imported by the app. The source .sf2 stays out of the repo
// (gitignored); only the generated JSON is committed.
//
// Usage:
//   node scripts/build-gm-instruments.mjs 0            # one melodic program
//   node scripts/build-gm-instruments.mjs 0-7          # a range
//   node scripts/build-gm-instruments.mjs all          # all 128 melodic
//   node scripts/build-gm-instruments.mjs drums         # standard drum kit (bank 128, preset 0)
//   node scripts/build-gm-instruments.mjs all drums     # everything (full, native rate)
//   node scripts/build-gm-instruments.mjs --profile lite  # the committed curated set @ 22.05kHz
//   node scripts/build-gm-instruments.mjs --profile full all drums  # explicit full
//
// Profiles: `full` (default) = native rate, any program set (gitignored local + CDN).
// `lite` = the LITE_PROGRAMS curated list + Standard drum kit, downsampled to 22.05kHz,
// the small set committed into the repo so clones/deploys have sound with no hosting.
//
// SF2 → our schema mapping (the fiddly bits):
//  - Generators combine: instrument level is absolute (global zone, then zone
//    overrides); preset level is an additive offset (global zone, then zone).
//    Key/velocity ranges intersect.
//  - Envelope params are timecents (sec = 2^(tc/1200)); sustain is centibels of
//    attenuation (level = 10^(-cB/200)).
//  - rootKey = overridingRootKey (gen 58) or the sample's originalPitch, shifted by
//    coarse/fine tune + the sample's pitchCorrection so playbackRate is exact.
//  - Loop points come from the sample header (relative to the sample), nudged by the
//    loop-offset generators; sampleModes (gen 54) decides whether to loop.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import pkg from 'soundfont2';

const { SoundFont2, DEFAULT_GENERATOR_VALUES } = pkg;

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const SF2_PATH = resolve(ROOT, 'soundfonts/FluidR3_GM.sf2');
const OUT_DIR = resolve(ROOT, 'public/instruments/gm');

// SF2 generator ids we read.
const GEN = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4, endAddrsCoarseOffset: 12,
  startloopAddrsCoarseOffset: 45, endloopAddrsCoarseOffset: 50,
  attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38,
  keyRange: 43, velRange: 44, initialAttenuation: 48,
  coarseTune: 51, fineTune: 52, sampleModes: 54, overridingRootKey: 58, sampleID: 53,
};

const ADDITIVE = new Set([
  GEN.attackVolEnv, GEN.holdVolEnv, GEN.decayVolEnv, GEN.sustainVolEnv, GEN.releaseVolEnv,
  GEN.coarseTune, GEN.fineTune, GEN.initialAttenuation,
]);

function genValue(map, id) {
  const g = map?.[id];
  return g && typeof g.value === 'number' ? g.value : undefined;
}
function genRange(map, id) {
  const g = map?.[id];
  return g && g.range ? g.range : undefined;
}
/** Merge a global zone's generators with a specific zone's (zone wins). */
function zoneGenMap(globalZone, zone) {
  return { ...(globalZone?.generators ?? {}), ...(zone?.generators ?? {}) };
}
function defaultValue(id) {
  const d = DEFAULT_GENERATOR_VALUES?.[id];
  return typeof d === 'number' ? d : (d && typeof d.value === 'number' ? d.value : 0);
}
/** Final value for an additive generator: instrument-absolute + preset-offset. */
function effective(id, instMap, presetMap) {
  const base = genValue(instMap, id) ?? defaultValue(id);
  const offset = ADDITIVE.has(id) ? (genValue(presetMap, id) ?? 0) : 0;
  return base + offset;
}
function intersectRange(a, b) {
  const lo = Math.max(a?.lo ?? 0, b?.lo ?? 0);
  const hi = Math.min(a?.hi ?? 127, b?.hi ?? 127);
  return lo <= hi ? { lo, hi } : null;
}

const timecentsToSec = (tc) => Math.max(0.001, Math.pow(2, tc / 1200));
const centibelToLevel = (cb) => Math.max(0, Math.min(1, Math.pow(10, -cb / 200)));

// ── Profiles ─────────────────────────────────────────────────────────────────────
// `full`  : native sample rate, any program set (the default; gitignored local + CDN).
// `lite`  : the committed offline bundle — a curated instrument list downsampled to
//           22.05 kHz (near-native, ~⅓ smaller). See docs/Features/GM-Sampler-Plan.md.
const LITE_TARGET_RATE = 22050;
// The user-curated 21-instrument lite set (20 melodic + Standard drum kit), by GM #.
const LITE_PROGRAMS = [
  0,   // Acoustic Grand Piano
  4,   // Electric Piano 1 (Rhodes)
  11,  // Vibraphone
  12,  // Marimba
  16,  // Drawbar Organ
  19,  // Church Organ
  25,  // Acoustic Guitar (steel)
  27,  // Clean Electric Guitar
  32,  // Acoustic Bass
  33,  // Electric Bass (finger)
  38,  // Synth Bass 1
  40,  // Violin
  48,  // String Ensemble 1
  52,  // Choir Aahs
  56,  // Trumpet
  60,  // French Horn
  65,  // Alto Sax
  73,  // Flute
  81,  // Lead 2 (Saw)
  89,  // Pad 2 (Warm)
];

/**
 * Downsample Int16 PCM from srcRate to dstRate by area-averaging (box-filter)
 * decimation — each output sample is the mean of the input samples spanning its
 * window. Cheap, and a decent anti-alias for downsampling (far better than dropping
 * samples). Never upsamples: returns the input untouched when dstRate >= srcRate.
 */
function downsampleInt16(int16, srcRate, dstRate) {
  if (dstRate >= srcRate) return int16;
  const ratio = srcRate / dstRate; // > 1
  const outLen = Math.max(1, Math.floor(int16.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const start = i * ratio;
    const i0 = Math.floor(start);
    const i1 = Math.min(int16.length, Math.max(i0 + 1, Math.ceil(start + ratio)));
    let sum = 0;
    for (let j = i0; j < i1; j++) sum += int16[j];
    out[i] = Math.round(sum / (i1 - i0));
  }
  return out;
}

// Store raw Int16 PCM (the SF2 source is already 16-bit) — lossless and half the
// size of Float32. GmSampleBank decodes it back to Float32 (value/32768) at load.
function int16ToBase64(int16) {
  return Buffer.from(int16.buffer, int16.byteOffset, int16.byteLength).toString('base64');
}

/** Resolve one preset-zone × instrument-zone pair into a GmZone, or null to skip.
 *  `targetRate` (lite profile) downsamples the PCM and rescales the loop points. */
function buildZone(presetZone, presetGlobal, instZone, instGlobal, targetRate = null) {
  const sample = instZone.sample;
  if (!sample || (sample.header.type & 0x8000) !== 0) return null; // skip ROM samples

  const presetMap = zoneGenMap(presetGlobal, presetZone);
  const instMap = zoneGenMap(instGlobal, instZone);

  const keyRange = intersectRange(
    genRange(presetMap, GEN.keyRange) ?? presetZone.keyRange,
    genRange(instMap, GEN.keyRange) ?? instZone.keyRange,
  );
  if (!keyRange) return null;
  const velRange = genRange(instMap, GEN.velRange) ?? instZone.velRange ?? null;

  // Root key + tuning → fractional effective root so playbackRate is exact.
  const rootKey = genValue(instMap, GEN.overridingRootKey) ?? sample.header.originalPitch;
  const coarse = effective(GEN.coarseTune, instMap, presetMap);
  const fine = effective(GEN.fineTune, instMap, presetMap);
  const correction = sample.header.pitchCorrection ?? 0;
  const effRoot = rootKey - coarse - (fine + correction) / 100;

  // Sample trim (offset generators) — usually zero.
  const startOff = (genValue(instMap, GEN.startAddrsOffset) ?? 0) + 32768 * (genValue(instMap, GEN.startAddrsCoarseOffset) ?? 0);
  const endOff = (genValue(instMap, GEN.endAddrsOffset) ?? 0) + 32768 * (genValue(instMap, GEN.endAddrsCoarseOffset) ?? 0);
  const begin = Math.max(0, startOff);
  const finish = Math.min(sample.data.length, sample.data.length + endOff);
  const int16 = sample.data.subarray(begin, finish);

  // Loop (relative to the sample start), nudged by loop-offset generators.
  const loopMode = genValue(instMap, GEN.sampleModes) ?? 0;
  let loopStart = -1, loopEnd = -1;
  if (loopMode === 1 || loopMode === 3) {
    loopStart = sample.header.startLoop
      + (genValue(instMap, GEN.startloopAddrsOffset) ?? 0)
      + 32768 * (genValue(instMap, GEN.startloopAddrsCoarseOffset) ?? 0) - begin;
    loopEnd = sample.header.endLoop
      + (genValue(instMap, GEN.endloopAddrsOffset) ?? 0)
      + 32768 * (genValue(instMap, GEN.endloopAddrsCoarseOffset) ?? 0) - begin;
    if (!(loopEnd > loopStart && loopStart >= 0 && loopEnd <= int16.length)) {
      loopStart = -1; loopEnd = -1;
    }
  }

  // Lite profile: downsample the PCM and rescale loop points to the new rate.
  let outPcm = int16;
  let outRate = sample.header.sampleRate;
  if (targetRate && outRate > targetRate) {
    outPcm = downsampleInt16(int16, outRate, targetRate);
    if (loopStart >= 0) {
      const f = targetRate / outRate;
      loopStart = Math.round(loopStart * f);
      loopEnd = Math.round(loopEnd * f);
      if (!(loopEnd > loopStart && loopStart >= 0 && loopEnd <= outPcm.length)) {
        loopStart = -1; loopEnd = -1;
      }
    }
    outRate = targetRate;
  }

  const envelope = {
    attack: timecentsToSec(effective(GEN.attackVolEnv, instMap, presetMap)),
    decay: timecentsToSec(effective(GEN.decayVolEnv, instMap, presetMap)),
    sustain: centibelToLevel(effective(GEN.sustainVolEnv, instMap, presetMap)),
    release: timecentsToSec(effective(GEN.releaseVolEnv, instMap, presetMap)),
  };

  return {
    loKey: keyRange.lo, hiKey: keyRange.hi,
    rootKey: Number(effRoot.toFixed(4)),
    loopStart, loopEnd,
    envelope,
    sampleRate: outRate,
    pcm: int16ToBase64(outPcm),
    _vel: velRange, // internal, stripped before write
  };
}

/** Collapse velocity layers: one zone per key range (prefer the layer covering vel 100). */
function collapseVelocity(zones) {
  const byRange = new Map();
  for (const z of zones) {
    const key = `${z.loKey}-${z.hiKey}`;
    const list = byRange.get(key) ?? [];
    list.push(z);
    byRange.set(key, list);
  }
  const out = [];
  for (const list of byRange.values()) {
    if (list.length === 1) { out.push(list[0]); continue; }
    const covers100 = list.find((z) => z._vel && z._vel.lo <= 100 && z._vel.hi >= 100);
    out.push(covers100 ?? list[0]);
  }
  return out.sort((a, b) => a.loKey - b.loKey).map(({ _vel, ...z }) => z);
}

function buildPreset(preset, { isDrum, targetRate = null }) {
  const zones = [];
  for (const pz of preset.zones) {
    if (!pz.instrument) continue; // global preset zone
    const inst = pz.instrument;
    for (const iz of inst.zones) {
      if (!iz.sample) continue; // global instrument zone
      const zone = buildZone(pz, preset.globalZone, iz, inst.globalZone, targetRate);
      if (zone) zones.push(zone);
    }
  }
  const collapsed = collapseVelocity(zones);
  if (collapsed.length === 0) return null;
  return {
    program: preset.header.preset,
    name: preset.header.name,
    isDrum,
    sampleRate: collapsed[0].sampleRate ?? 44100,
    pcmFormat: 'i16',
    zones: collapsed,
  };
}

function writeAsset(asset, isDrum) {
  const dir = isDrum ? resolve(OUT_DIR, 'drums') : OUT_DIR;
  mkdirSync(dir, { recursive: true });
  const file = resolve(dir, `${String(asset.program).padStart(4, '0')}.json`);
  const json = JSON.stringify(asset);
  writeFileSync(file, json);
  return { file, kb: Math.round(json.length / 1024), zones: asset.zones.length };
}

// ── main ────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

// `--profile lite|full` (default full). lite = the committed curated set at 22.05kHz.
const profileIdx = args.indexOf('--profile');
const profile = profileIdx >= 0 ? (args[profileIdx + 1] ?? 'full') : 'full';
if (profile !== 'lite' && profile !== 'full') {
  console.error(`Unknown --profile "${profile}". Use "lite" or "full".`);
  process.exit(1);
}
const targetRate = profile === 'lite' ? LITE_TARGET_RATE : null;

const measureOnly = args.includes('measure');
// lite always includes drums; otherwise the explicit `drums` token controls it.
const wantDrums = profile === 'lite' || args.includes('drums');
// Positional program arg, ignoring keywords and the --profile value.
const melodicArg = args.find((a, i) =>
  a !== 'drums' && a !== 'measure' && a !== '--profile' && i !== profileIdx + 1);

const sf = SoundFont2.from(readFileSync(SF2_PATH));
const melodic = new Map();
for (const p of sf.presets) if (p.header.bank === 0) melodic.set(p.header.preset, p);

// Dry run: build everything in memory, report real sizes (Float32 now vs Int16
// projection), write nothing. Answers "how big is the full set, and does Int16 fix it?"
if (measureOnly) {
  // Collect per-zone {samples, rate, loopEnd} for the whole set.
  const zones = [];
  let count = 0;
  const presets = [...[...melodic.keys()].sort((a, b) => a - b).map((k) => [melodic.get(k), false])];
  const kit = sf.presets.find((p) => p.header.bank === 128);
  if (kit) presets.push([kit, true]);
  for (const [preset, isDrum] of presets) {
    const asset = buildPreset(preset, { isDrum });
    if (!asset) continue;
    if (!isDrum) count++;
    for (const z of asset.zones) {
      // pcm is now Int16 base64: bytes = len*3/4, samples = bytes/2.
      zones.push({ samples: Math.round((z.pcm.length * 3 / 4) / 2), rate: z.sampleRate ?? asset.sampleRate, loopEnd: z.loopEnd });
    }
  }

  const b64 = (bytes) => bytes * 4 / 3;
  // Project stored sample count under a target rate + optional length cap (seconds).
  // Capping never trims before the loop end (the loop must survive).
  function project(bytesPerSample, targetRate, capSec) {
    let total = 0;
    for (const z of zones) {
      const r = targetRate ?? z.rate;
      let s = Math.round(z.samples * (r / z.rate));
      if (capSec != null) {
        const loopEndScaled = z.loopEnd > 0 ? Math.round(z.loopEnd * (r / z.rate)) : 0;
        s = Math.max(Math.min(s, Math.round(capSec * r)), loopEndScaled);
      }
      total += s;
    }
    return b64(total * bytesPerSample) / 1e6;
  }
  const recipe = (label, mb) => console.log(`  ${label.padEnd(42)} ~${mb.toFixed(0)} MB`);
  console.log(`programs: ${count} + drums, zones: ${zones.length}`);
  console.log(`projected committed size (base64 JSON):`);
  recipe('Float32, native rate (legacy)', project(4, null, null));
  recipe('Int16, native rate (current)', project(2, null, null));
  recipe('Int16 + 22.05kHz', project(2, 22050, null));
  recipe('Int16 + 22.05kHz + cap 3s', project(2, 22050, 3));
  recipe('Int16 + 22.05kHz + cap 2s', project(2, 22050, 2));
  recipe('Int16 + 16kHz + cap 2s', project(2, 16000, 2));
  process.exit(0);
}

let programs = [];
if (profile === 'lite') programs = [...LITE_PROGRAMS];
else if (melodicArg === 'all') programs = [...melodic.keys()].sort((a, b) => a - b);
else if (melodicArg && melodicArg.includes('-')) {
  const [lo, hi] = melodicArg.split('-').map(Number);
  for (let i = lo; i <= hi; i++) programs.push(i);
} else if (melodicArg !== undefined) programs = [Number(melodicArg)];

console.log(`profile: ${profile}${targetRate ? ` (${targetRate} Hz)` : ' (native rate)'}`);

let total = 0;
for (const program of programs) {
  const preset = melodic.get(program);
  if (!preset) { console.warn(`  program ${program}: no preset in bank 0, skipped`); continue; }
  const asset = buildPreset(preset, { isDrum: false, targetRate });
  if (!asset) { console.warn(`  program ${program}: no usable zones, skipped`); continue; }
  const r = writeAsset(asset, false);
  total += r.kb;
  console.log(`  program ${String(program).padStart(3)} "${asset.name}" -> ${r.zones} zones, ${r.kb} kB`);
}

if (wantDrums) {
  // Standard kit = bank 128, preset 0. (Bank-128 presets are NOT in preset order in
  // the file, so an unqualified find lands on whatever kit comes first, e.g. "Power 3".)
  const kit = sf.presets.find((p) => p.header.bank === 128 && p.header.preset === 0)
    ?? sf.presets.find((p) => p.header.bank === 128)
    ?? sf.presets.find((p) => /drum|kit|standard/i.test(p.header.name));
  if (!kit) console.warn('  drums: no bank-128 preset found');
  else {
    const asset = buildPreset(kit, { isDrum: true, targetRate });
    asset.program = 0; // standard kit -> drums/0000.json
    const r = writeAsset(asset, true);
    total += r.kb;
    console.log(`  drums "${kit.header.name}" -> ${r.zones} zones, ${r.kb} kB`);
  }
}

console.log(`Done. ${programs.length} program(s)${wantDrums ? ' + drums' : ''}, ${total} kB total.`);
