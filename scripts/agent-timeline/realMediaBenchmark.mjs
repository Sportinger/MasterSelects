import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const AGENT_TIMELINE_REAL_MEDIA_BENCHMARK_SCHEMA = 'agent-timeline-real-media-benchmark/v1';
export const AGENT_TIMELINE_REAL_MEDIA_REPORT_SCHEMA = 'agent-timeline-real-media-benchmark-report/v1';
const BASELINE_KINDS = new Set(['standalone-cut', 'proxy-piggyback']);

const CHANNEL_PRESETS = Object.freeze({
  cuts: ['cuts'],
  'focus-motion': ['quality', 'camera-motion'],
  faces: ['people'],
  audio: ['audio'],
});

const CACHE_INSTRUCTIONS = Object.freeze({
  cold: 'Clear only the local analyzer/model/artifact caches in the selected browser profile, reopen the exact project, wait 5 seconds after reload, then let the runner confirm cacheStateObserved="cold".',
  warm: 'Run the same local analyzer once, keep the exact browser profile and project open, then let the runner confirm cacheStateObserved="warm" and redundantDecodedSeconds=0.',
});

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
  return value;
}

function positiveFinite(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new TypeError(`${label} must be a positive finite number`);
  return value;
}

function optionalNonNegative(value, label) {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} must be null or a non-negative finite number`);
  return value;
}

function channelPreset(name) {
  const channels = CHANNEL_PRESETS[name];
  if (!channels) throw new TypeError(`Unknown benchmark analyzer: ${name}`);
  return channels;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalJson(item)]));
  }
  return value;
}

function sameJson(left, right) {
  return JSON.stringify(canonicalJson(left ?? null)) === JSON.stringify(canonicalJson(right ?? null));
}

export function createEvidenceId(value) {
  return createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
}

export function cacheInstructions(cacheState) {
  if (!CACHE_INSTRUCTIONS[cacheState]) throw new TypeError('cacheState must be cold or warm');
  return CACHE_INSTRUCTIONS[cacheState];
}

export async function fingerprintRealMedia(mediaPath) {
  const resolvedPath = path.resolve(mediaPath);
  const stat = await fs.stat(resolvedPath);
  if (!stat.isFile() || stat.size <= 0) throw new TypeError('media must be a non-empty regular file');
  const digest = createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = createReadStream(resolvedPath);
    stream.on('data', (chunk) => digest.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return {
    name: path.basename(resolvedPath),
    sizeBytes: stat.size,
    sha256: digest.digest('hex'),
  };
}

/** Validates measurements emitted by a local browser/dev-bridge benchmark runner. */
export function normalizeRunnerMeasurement(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('runner result must be an object');
  if (value.schemaVersion !== AGENT_TIMELINE_REAL_MEDIA_BENCHMARK_SCHEMA) {
    throw new TypeError(`runner schemaVersion must be ${AGENT_TIMELINE_REAL_MEDIA_BENCHMARK_SCHEMA}`);
  }
  if (value.kind !== 'agent-timeline-local-analysis-pass') throw new TypeError('runner kind must be agent-timeline-local-analysis-pass');
  if (value.status !== 'completed' || value.localOnly !== true) throw new TypeError('runner pass must complete locally before evidence is collected');
  if (value.networkUsed !== false || value.cloudUsed !== false) throw new TypeError('real-media benchmark runners must prove local-only execution');
  if (value.cacheStateObserved !== expected.cacheState) throw new TypeError(`runner did not confirm ${expected.cacheState} cache state`);
  if (value.cacheResetConfirmed !== (expected.cacheState === 'cold')) {
    throw new TypeError('runner cache-reset confirmation does not match the requested cache state');
  }
  if (!Array.isArray(value.channels) || JSON.stringify(value.channels.toSorted()) !== JSON.stringify(expected.channels.toSorted())) {
    throw new TypeError('runner channels do not match the requested analyzer preset');
  }
  if (value.profile !== expected.profile) throw new TypeError('runner profile does not match request');
  if (value.pass !== expected.pass) throw new TypeError(`runner did not verify ${expected.pass} pass`);
  if (value.baselineKind !== expected.baselineKind || !BASELINE_KINDS.has(value.baselineKind)) {
    throw new TypeError('runner baseline kind does not match request');
  }
  const elapsedMs = positiveFinite(value.elapsedMs, 'runner elapsedMs');
  const peakMemoryBytes = optionalNonNegative(value.peakMemoryBytes, 'runner peakMemoryBytes');
  const artifactBytes = optionalNonNegative(value.artifactBytes, 'runner artifactBytes');
  const redundantDecodedSeconds = optionalNonNegative(value.redundantDecodedSeconds, 'runner redundantDecodedSeconds');
  if (expected.cacheState === 'warm' && redundantDecodedSeconds !== 0) {
    throw new TypeError('warm runner must observe redundantDecodedSeconds=0');
  }
  return {
    platform: nonEmptyString(value.platform, 'runner platform'),
    deviceClass: nonEmptyString(value.deviceClass, 'runner deviceClass'),
    pass: value.pass,
    baselineKind: value.baselineKind,
    elapsedMs,
    peakMemoryBytes,
    artifactBytes,
    redundantDecodedSeconds,
    cacheEvidence: value.cacheEvidence && typeof value.cacheEvidence === 'object' ? canonicalJson(value.cacheEvidence) : undefined,
    runtimeEvidence: value.runtimeEvidence && typeof value.runtimeEvidence === 'object' ? canonicalJson(value.runtimeEvidence) : undefined,
  };
}

export function createRealMediaEvidence({
  media,
  durationSeconds,
  scenarioId,
  profile,
  analyzer,
  cacheState,
  baselineKind,
  baseline,
  analysis,
  collectedAt = new Date().toISOString(),
}) {
  if (!media || typeof media !== 'object' || !/^[a-f0-9]{64}$/i.test(media.sha256)) throw new TypeError('media fingerprint is required');
  positiveFinite(durationSeconds, 'durationSeconds');
  nonEmptyString(scenarioId, 'scenarioId');
  if (!['quick', 'balanced', 'deep'].includes(profile)) throw new TypeError('profile must be quick, balanced, or deep');
  if (!['cold', 'warm'].includes(cacheState)) throw new TypeError('cacheState must be cold or warm');
  if (!BASELINE_KINDS.has(baselineKind)) throw new TypeError('baselineKind must be standalone-cut or proxy-piggyback');
  if (!Number.isFinite(Date.parse(collectedAt))) throw new TypeError('collectedAt must be an ISO-compatible timestamp');
  const channels = channelPreset(analyzer);
  const normalizedBaseline = normalizeRunnerMeasurement(baseline, {
    cacheState, channels, profile, pass: 'baseline', baselineKind,
  });
  const normalizedAnalysis = normalizeRunnerMeasurement(analysis, {
    cacheState, channels, profile, pass: 'analysis', baselineKind,
  });
  if (normalizedBaseline.platform !== normalizedAnalysis.platform
    || normalizedBaseline.deviceClass !== normalizedAnalysis.deviceClass
    || !sameJson(normalizedBaseline.runtimeEvidence, normalizedAnalysis.runtimeEvidence)) {
    throw new TypeError('baseline and analysis must report matching platform, device, and renderer evidence');
  }
  const gateEligible = normalizedAnalysis.peakMemoryBytes !== null
    && normalizedAnalysis.artifactBytes !== null
    && normalizedAnalysis.redundantDecodedSeconds !== null;
  const id = createEvidenceId({ media, durationSeconds, scenarioId, profile, analyzer, cacheState, baselineKind, baseline: normalizedBaseline, analysis: normalizedAnalysis, collectedAt });
  return {
    schemaVersion: AGENT_TIMELINE_REAL_MEDIA_BENCHMARK_SCHEMA,
    kind: 'agent-timeline-real-media-evidence',
    id,
    realMedia: true,
    synthetic: false,
    localOnly: true,
    collectedAt,
    media,
    durationSeconds,
    scenarioId,
    profile,
    analyzer,
    baselineKind,
    channels,
    cacheState,
    cacheProtocol: { instruction: cacheInstructions(cacheState), confirmed: true },
    platform: normalizedAnalysis.platform,
    deviceClass: normalizedAnalysis.deviceClass,
    baseline: normalizedBaseline,
    analysis: normalizedAnalysis,
    runtimeEvidence: normalizedAnalysis.runtimeEvidence,
    elapsedRatio: normalizedAnalysis.elapsedMs / normalizedBaseline.elapsedMs,
    observability: {
      peakMemoryBytes: normalizedAnalysis.peakMemoryBytes !== null,
      artifactBytes: normalizedAnalysis.artifactBytes !== null,
      redundantDecodedSeconds: normalizedAnalysis.redundantDecodedSeconds !== null,
    },
    gateEligible,
  };
}

/** Converts only complete, local, real-media evidence to the pre-existing production gate DTO. */
export function toBenchmarkGateMeasurement(evidence) {
  if (!evidence || evidence.schemaVersion !== AGENT_TIMELINE_REAL_MEDIA_BENCHMARK_SCHEMA || !evidence.gateEligible) return null;
  return {
    id: evidence.id,
    realMedia: evidence.realMedia === true && evidence.synthetic === false && evidence.localOnly === true,
    profile: evidence.profile,
    channels: evidence.channels,
    platform: evidence.platform,
    deviceClass: evidence.deviceClass,
    scenarioId: evidence.scenarioId,
    cacheState: evidence.cacheState,
    baselineKind: evidence.baselineKind,
    baselinePlatform: evidence.baseline.platform,
    baselineDeviceClass: evidence.baseline.deviceClass,
    runtimeEvidence: evidence.runtimeEvidence,
    baselineRuntimeEvidence: evidence.baseline.runtimeEvidence,
    sourceDurationSeconds: evidence.durationSeconds,
    wallTimeSeconds: evidence.analysis.elapsedMs / 1000,
    baselineWallTimeSeconds: evidence.baseline.elapsedMs / 1000,
    peakMemoryBytes: evidence.analysis.peakMemoryBytes,
    artifactBytes: evidence.analysis.artifactBytes,
    redundantDecodedSeconds: evidence.analysis.redundantDecodedSeconds,
  };
}

export function buildRealMediaReport(evidence, metadata = {}) {
  const completed = evidence.filter((entry) => entry?.gateEligible);
  return {
    schemaVersion: AGENT_TIMELINE_REAL_MEDIA_REPORT_SCHEMA,
    kind: 'agent-timeline-real-media-benchmark-report',
    synthetic: false,
    qualifying: completed.length > 0,
    collection: canonicalJson(metadata),
    evidence,
    gateMeasurements: completed.map(toBenchmarkGateMeasurement),
    summary: {
      totalEvidence: evidence.length,
      gateEligibleEvidence: completed.length,
      nonQualifyingEvidence: evidence.length - completed.length,
    },
  };
}
