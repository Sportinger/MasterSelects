import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultOutDir = path.join(repoRoot, 'tmp', 'worker-first-platform-evidence');
const requiredPlatforms = [
  'windows-chromium',
  'linux-chromium-mesa',
  'linux-firefox-mesa',
  'macos-safari',
  'macos-firefox',
];
const requiredPackageChecks = [
  'capabilityProbeSucceeded',
  'platformResolved',
  'fixtureSucceeded',
  'visibleStressSucceeded',
  'visibleStressNoStaleFrames',
  'visibleStressNonBlank',
  'statsBeforeStressSucceeded',
  'statsAfterStressSucceeded',
  'playbackTraceSucceeded',
  'statsStartPermissionsRemainFalse',
  'traceStartPermissionsRemainFalse',
];
const maxBridgeTabSeenAgoMs = 10000;

function timestampForPath(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
}

function printHelp() {
  console.log(`Usage:
  node scripts/run-worker-first-platform-evidence.mjs collect [options]
  node scripts/run-worker-first-platform-evidence.mjs verify [options] [package.json...]
  node scripts/run-worker-first-platform-evidence.mjs status [options] [package.json...]
  node scripts/run-worker-first-platform-evidence.mjs doctor [options] [package.json...]
  node scripts/run-worker-first-platform-evidence.mjs macos-runbook [options]

Commands:
  collect    Run runWorkerFirstPlatformEvidencePackage in a visible browser tab and save the package.
  verify     Verify package files offline by default.
  status     Print offline matrix status and always exit 0 unless packages cannot be read.
  doctor     Print package, matrix, and bridge readiness without running a browser proof.
  macos-runbook
             Print the exact macOS Safari/Firefox collection commands and copy-back checks.

Options:
  --base-url <url>          Dev server base URL. Default: http://localhost:5173
  --token-file <path>       Bridge token file. Default: .ai-bridge-token
  --out <dir>               Output/package directory. Default: tmp/worker-first-platform-evidence
  --target-tab-id <id>      Explicit bridge tab id. Default: pick focused/visible tab.
  --wait-ms <ms>            Wait for a target tab, then wait again after tab selection. Default: 5000
  --timeout-ms <ms>         AI tool timeout. Default: 300000
  --bridge                  For verify, call verifyWorkerFirstPlatformEvidenceMatrix through the app bridge.
  --latest-per-platform     For verify/status, use only the newest package per platform.

Collect options:
  --expect-platform <id>   Fail collect if the returned package platform differs.
  --width <n>               Fixture width.
  --height <n>              Fixture height.
  --sample-width <n>        Fingerprint sample width.
  --sample-height <n>       Fingerprint sample height.
  --duration-ms <n>         Visible playback stress duration.
  --min-preview-frames <n>  Minimum preview frames for stress proof.
  --settle-ms <n>           Settle wait forwarded to proof tools.
  --capture-settle-ms <n>   Wait after capture seek before visible-pixel read.
  --start-time <n>          Playback stress start time.
  --playback-speed <n>      Playback stress speed.
  --reset-diagnostics       Reset playback diagnostics during stress proof.
`);
}

function parseNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
}

function parseArgs(argv) {
  const command = argv[2];
  const options = {
    command,
    baseUrl: 'http://localhost:5173',
    tokenFile: path.join(repoRoot, '.ai-bridge-token'),
    out: defaultOutDir,
    targetTabId: null,
    waitMs: 5000,
    timeoutMs: 300000,
    bridgeVerify: false,
    latestPerPlatform: false,
    expectedPlatform: null,
    packagePaths: [],
    collectArgs: {},
  };

  if (!command || command === '--help' || command === '-h') {
    options.help = true;
    return options;
  }
  if (
    command !== 'collect'
    && command !== 'verify'
    && command !== 'status'
    && command !== 'doctor'
    && command !== 'macos-runbook'
  ) {
    throw new Error(`Unknown command: ${command}`);
  }

  for (let index = 3; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? options.baseUrl;
    } else if (arg === '--token-file') {
      options.tokenFile = path.resolve(argv[++index] ?? options.tokenFile);
    } else if (arg === '--out') {
      options.out = path.resolve(argv[++index] ?? options.out);
    } else if (arg === '--target-tab-id') {
      options.targetTabId = argv[++index] ?? null;
    } else if (arg === '--wait-ms') {
      options.waitMs = parseNumber(argv[++index], '--wait-ms');
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = parseNumber(argv[++index], '--timeout-ms');
    } else if (arg === '--bridge') {
      options.bridgeVerify = true;
    } else if (arg === '--latest-per-platform') {
      options.latestPerPlatform = true;
    } else if (arg === '--expect-platform') {
      const expectedPlatform = argv[++index] ?? '';
      if (!requiredPlatforms.includes(expectedPlatform)) {
        throw new Error(`--expect-platform must be one of: ${requiredPlatforms.join(', ')}`);
      }
      options.expectedPlatform = expectedPlatform;
    } else if (arg === '--width') {
      options.collectArgs.width = parseNumber(argv[++index], '--width');
    } else if (arg === '--height') {
      options.collectArgs.height = parseNumber(argv[++index], '--height');
    } else if (arg === '--sample-width') {
      options.collectArgs.sampleWidth = parseNumber(argv[++index], '--sample-width');
    } else if (arg === '--sample-height') {
      options.collectArgs.sampleHeight = parseNumber(argv[++index], '--sample-height');
    } else if (arg === '--duration-ms') {
      options.collectArgs.durationMs = parseNumber(argv[++index], '--duration-ms');
    } else if (arg === '--min-preview-frames') {
      options.collectArgs.minPreviewFrames = parseNumber(argv[++index], '--min-preview-frames');
    } else if (arg === '--settle-ms') {
      options.collectArgs.settleMs = parseNumber(argv[++index], '--settle-ms');
    } else if (arg === '--capture-settle-ms') {
      options.collectArgs.captureSettleMs = parseNumber(argv[++index], '--capture-settle-ms');
    } else if (arg === '--start-time') {
      options.collectArgs.startTime = parseNumber(argv[++index], '--start-time');
    } else if (arg === '--playback-speed') {
      options.collectArgs.playbackSpeed = parseNumber(argv[++index], '--playback-speed');
    } else if (arg === '--reset-diagnostics') {
      options.collectArgs.resetDiagnostics = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (command === 'verify' || command === 'status' || command === 'doctor') {
      options.packagePaths.push(path.resolve(arg));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

async function readBridgeToken(tokenPath) {
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (!token) {
    throw new Error(`Bridge token file is empty: ${tokenPath}`);
  }
  return token;
}

async function fetchJson(url, init, label, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`${label}: non-JSON response (${response.status}) ${text.slice(0, 240)}`);
    }
    if (!response.ok) {
      throw new Error(`${label}: HTTP ${response.status} ${parsed.error || response.statusText}`);
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function chooseTargetTabId(status) {
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  const candidates = tabs.filter(isFreshBridgeTab);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const visible = Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible');
    if (visible !== 0) return visible;
    const focus = Number(Boolean(b.hasFocus)) - Number(Boolean(a.hasFocus));
    if (focus !== 0) return focus;
    return (a.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER) - (b.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER);
  });
  return typeof candidates[0]?.tabId === 'string' ? candidates[0].tabId : null;
}

function isFreshBridgeTab(tab) {
  return Boolean(tab)
    && (!tab.unresponsiveForMs || tab.unresponsiveForMs <= 0)
    && (tab.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER) <= maxBridgeTabSeenAgoMs;
}

function findLiveTargetTab(status, tabId) {
  if (typeof tabId !== 'string' || !tabId) return null;
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  const tab = tabs.find((entry) => entry?.tabId === tabId);
  if (!isFreshBridgeTab(tab)) return null;
  return tab;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

async function createBridge(options) {
  const token = await readBridgeToken(options.tokenFile);
  const baseUrl = new URL(options.baseUrl);
  const apiUrl = new URL('/api/ai-tools', baseUrl);
  const authCheckUrl = new URL('/api/ai-tools/auth-check', baseUrl);
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  let targetTabId = options.targetTabId;

  async function getStatus() {
    return fetchJson(apiUrl, { method: 'GET' }, 'bridge status', 5000);
  }

  async function getAuthStatus() {
    const result = await fetchJson(authCheckUrl, {
      method: 'GET',
      headers,
    }, 'bridge auth check', 5000);
    if (result?.status !== 'ok') {
      throw new Error('bridge auth check endpoint unavailable or stale dev server');
    }
    return result;
  }

  async function selectTargetTab() {
    const status = await getStatus();
    if (!status.clients || status.clients < 1) {
      throw new Error('No browser tab is connected to the dev bridge. Open the dev server page first.');
    }
    if (!targetTabId) {
      targetTabId = chooseTargetTabId(status);
    } else if (!findLiveTargetTab(status, targetTabId)) {
      throw new Error(`Configured target tab is not currently connected or responsive: ${targetTabId}`);
    }
    if (!targetTabId) {
      throw new Error('No live browser tab could be selected from the dev bridge status.');
    }
    return { status, targetTabId, targetTab: findLiveTargetTab(status, targetTabId) };
  }

  async function waitForTargetTab(timeoutMs) {
    const startedAt = Date.now();
    const deadline = startedAt + Math.max(0, timeoutMs);
    let lastError = null;
    let pollCount = 0;
    while (Date.now() <= deadline) {
      pollCount += 1;
      try {
        return {
          ...await selectTargetTab(),
          readinessPollCount: pollCount,
          readinessWaitedMs: Date.now() - startedAt,
        };
      } catch (error) {
        lastError = error;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) break;
      await sleep(Math.min(250, remainingMs));
    }
    throw lastError ?? new Error('No live browser tab could be selected from the dev bridge status.');
  }

  async function postTool(tool, args = {}, timeoutMs = options.timeoutMs) {
    return fetchJson(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, args, timeoutMs, targetTabId }),
    }, tool, timeoutMs + 30000);
  }

  return {
    baseUrl,
    getStatus,
    getAuthStatus,
    selectTargetTab,
    waitForTargetTab,
    postTool,
    get targetTabId() {
      return targetTabId;
    },
  };
}

function extractPackage(value, sourcePath) {
  if (value?.schema === 'worker-first-platform-evidence/v1') return value;
  if (value?.package?.schema === 'worker-first-platform-evidence/v1') return value.package;
  if (value?.data?.package?.schema === 'worker-first-platform-evidence/v1') return value.data.package;
  if (value?.result?.data?.package?.schema === 'worker-first-platform-evidence/v1') {
    return value.result.data.package;
  }
  throw new Error(`No worker-first platform evidence package found in ${sourcePath}`);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) {
        sorted[key] = canonicalize(value[key]);
      }
    }
    return sorted;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return null;
  }
  return value;
}

function stableStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function hashEvidencePayload(payload) {
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

function readObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function readString(value) {
  return typeof value === 'string' ? value : null;
}

function readNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function isRequiredPlatform(value) {
  return requiredPlatforms.includes(value);
}

function isWorkerPresentationStrategy(value) {
  return value === 'worker-webgpu-present'
    || value === 'worker-webgpu-main-present'
    || value === 'worker-cpu-present';
}

function sameRequiredPlatformSet(value) {
  if (!Array.isArray(value)) return false;
  const provided = new Set(value.filter((entry) => typeof entry === 'string'));
  return provided.size === requiredPlatforms.length
    && requiredPlatforms.every((platform) => provided.has(platform));
}

function packageWithoutEvidenceHash(pkg) {
  const { evidenceHash: _evidenceHash, ...payload } = pkg;
  return payload;
}

function failedChecks(checks) {
  if (!readObject(checks)) return ['checks:missing'];
  return requiredPackageChecks
    .filter((key) => checks[key] !== true)
    .map((key) => `checks.${key}:${String(checks[key])}`);
}

function startBooleansStayFalse(record, prefix) {
  const value = readObject(record);
  if (!value) return [`${prefix}:missing`];
  return [
    value.canStartWorkerWebGpu === false ? null : `${prefix}.canStartWorkerWebGpu:${String(value.canStartWorkerWebGpu)}`,
    value.canStartWorkerPresentation === false
      ? null
      : `${prefix}.canStartWorkerPresentation:${String(value.canStartWorkerPresentation)}`,
    value.canStartRenderDispatcherCutover === false
      ? null
      : `${prefix}.canStartRenderDispatcherCutover:${String(value.canStartRenderDispatcherCutover)}`,
  ].filter(Boolean);
}

function verifyPackageOffline(value) {
  const pkg = readObject(value);
  const platform = readString(pkg?.platform);
  const evidenceHash = readString(pkg?.evidenceHash);
  const strategy = readString(pkg?.strategy);
  const visibleStress = readObject(pkg?.visibleStress);
  const capabilityProbe = readObject(pkg?.capabilityProbe);
  const statsAfterStress = readObject(pkg?.statsAfterStress);
  const playbackTrace = readObject(pkg?.playbackTrace);
  const acceptedGate = readObject(pkg?.acceptedGate);
  const failures = [];
  let expectedHash = null;

  if (!pkg) failures.push('package:not-object');
  if (pkg?.schema !== 'worker-first-platform-evidence/v1') failures.push(`schema:${String(pkg?.schema)}`);
  if (!evidenceHash) failures.push('evidenceHash:missing');
  if (!isRequiredPlatform(platform)) failures.push(`platform:${String(platform)}`);
  if (!isWorkerPresentationStrategy(strategy)) failures.push(`strategy:${String(strategy)}`);
  if (!sameRequiredPlatformSet(pkg?.requiredPlatforms)) failures.push('requiredPlatforms:mismatch');
  if (capabilityProbe?.platform !== platform) failures.push('capabilityProbe.platform:mismatch');
  if (visibleStress?.platform !== platform) failures.push('visibleStress.platform:mismatch');
  if (visibleStress?.strategy !== strategy) failures.push('visibleStress.strategy:mismatch');
  if (visibleStress?.attached !== true) failures.push(`visibleStress.attached:${String(visibleStress?.attached)}`);
  if (visibleStress?.viewportIntersecting !== true) {
    failures.push(`visibleStress.viewportIntersecting:${String(visibleStress?.viewportIntersecting)}`);
  }
  if (visibleStress?.centerOccluded === true) failures.push('visibleStress.centerOccluded:true');
  if (Array.isArray(visibleStress?.errors) && visibleStress.errors.length > 0) {
    failures.push(`visibleStress.errors:${visibleStress.errors.join('|')}`);
  }

  const frameCount = readNumber(visibleStress?.frameCount);
  const staleVisibleFrameCount = readNumber(visibleStress?.staleVisibleFrameCount);
  const nonBlankRatio = readNumber(visibleStress?.nonBlankRatio);
  if (frameCount === null || frameCount <= 0) failures.push(`visibleStress.frameCount:${String(frameCount)}`);
  if (staleVisibleFrameCount !== 0) {
    failures.push(`visibleStress.staleVisibleFrameCount:${String(staleVisibleFrameCount)}`);
  }
  if (nonBlankRatio === null || nonBlankRatio < 0.05) {
    failures.push(`visibleStress.nonBlankRatio:${String(nonBlankRatio)}`);
  }

  failures.push(...failedChecks(pkg?.checks));
  if (statsAfterStress?.w5GateEvidenceMode !== 'stats-observation') {
    failures.push(`statsAfterStress.w5GateEvidenceMode:${String(statsAfterStress?.w5GateEvidenceMode)}`);
  }
  if (playbackTrace?.w5GateEvidenceMode !== 'stats-observation') {
    failures.push(`playbackTrace.w5GateEvidenceMode:${String(playbackTrace?.w5GateEvidenceMode)}`);
  }
  failures.push(...startBooleansStayFalse(statsAfterStress, 'statsAfterStress'));
  failures.push(...startBooleansStayFalse(playbackTrace, 'playbackTrace'));
  failures.push(...startBooleansStayFalse(acceptedGate, 'acceptedGate'));
  if (pkg?.w5StartPermissionsRemainStatsGuarded !== true) {
    failures.push(`w5StartPermissionsRemainStatsGuarded:${String(pkg?.w5StartPermissionsRemainStatsGuarded)}`);
  }

  if (pkg && evidenceHash) {
    expectedHash = hashEvidencePayload(stableStringify(packageWithoutEvidenceHash(pkg)));
    if (expectedHash !== evidenceHash) {
      failures.push('evidenceHash:mismatch');
    }
  }

  return {
    platform: isRequiredPlatform(platform) ? platform : 'windows-chromium',
    status: failures.length === 0 ? 'valid' : 'invalid',
    evidenceHash,
    expectedHash,
    strategy,
    frameCount,
    staleVisibleFrameCount,
    nonBlankRatio,
    failures,
  };
}

function verifyPackagesOffline(packages) {
  const verified = packages.map(verifyPackageOffline);
  const validByPlatform = {};
  for (const entry of verified.filter((entry) => entry.status === 'valid')) {
    validByPlatform[entry.platform] = [...(validByPlatform[entry.platform] ?? []), entry];
  }
  const duplicatePlatforms = requiredPlatforms
    .filter((platform) => (validByPlatform[platform]?.length ?? 0) > 1);
  const missingPlatforms = requiredPlatforms
    .filter((platform) => (validByPlatform[platform]?.length ?? 0) === 0);
  const invalidPackages = verified
    .map((entry, index) => ({ index, ...entry }))
    .filter((entry) => entry.status === 'invalid');
  const matrixComplete = missingPlatforms.length === 0
    && duplicatePlatforms.length === 0
    && invalidPackages.length === 0;
  const data = {
    schema: 'worker-first-platform-evidence-matrix/v1',
    requiredPlatforms,
    providedPackageCount: packages.length,
    validPackageCount: verified.filter((entry) => entry.status === 'valid').length,
    matrixComplete,
    missingPlatforms,
    duplicatePlatforms,
    invalidPackages,
    platforms: requiredPlatforms.map((platform) => ({
      platform,
      status: duplicatePlatforms.includes(platform)
        ? 'duplicate'
        : (validByPlatform[platform]?.length ?? 0) > 0
          ? 'valid'
          : 'missing',
      packages: validByPlatform[platform] ?? [],
    })),
    canStartWorkerWebGpu: false,
    canStartWorkerPresentation: false,
    canStartRenderDispatcherCutover: false,
    w5StartPermissionsRemainStatsGuarded: true,
  };
  return matrixComplete
    ? { success: true, data }
    : {
        success: false,
        error: 'Worker-first platform evidence matrix is incomplete or invalid.',
        data,
  };
}

function missingPlatformGuidance(missingPlatforms) {
  if (!Array.isArray(missingPlatforms) || missingPlatforms.length === 0) {
    return null;
  }
  const missing = new Set(missingPlatforms);
  if (missing.has('macos-safari') || missing.has('macos-firefox')) {
    return 'Next: run npm run worker-first:platform:macos-runbook on a real Mac to collect Safari/Firefox packages.';
  }
  return 'Next: run npm run worker-first:platform:collect -- --expect-platform <missing-platform-id> from a visible real target browser tab.';
}

function formatNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(Number(value.toFixed(4)))
    : '-';
}

function platformProofLine(platformRecord) {
  const verified = Array.isArray(platformRecord?.packages) ? platformRecord.packages[0] : null;
  if (!verified) {
    return `  ${platformRecord.platform}: ${platformRecord.status}`;
  }
  return [
    `  ${platformRecord.platform}: ${platformRecord.status}`,
    `strategy=${verified.strategy ?? '-'}`,
    `frames=${formatNumber(verified.frameCount)}`,
    `stale=${formatNumber(verified.staleVisibleFrameCount)}`,
    `nonBlank=${formatNumber(verified.nonBlankRatio)}`,
  ].join(' ');
}

function printPlatformProofSummary(data) {
  if (!Array.isArray(data?.platforms) || data.platforms.length === 0) return;
  console.log('Platform proofs:');
  for (const platform of data.platforms) {
    console.log(platformProofLine(platform));
  }
}

async function defaultPackagePaths(outDir) {
  let entries = [];
  try {
    entries = await fs.readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.package.json'))
    .map((entry) => path.join(outDir, entry.name))
    .sort();
}

async function loadPackageEntries(paths) {
  const entries = [];
  for (const filePath of paths) {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
    entries.push({
      filePath,
      pkg: extractPackage(parsed, filePath),
    });
  }
  return entries;
}

function companionReportPathForPackage(filePath) {
  return filePath.endsWith('.package.json')
    ? filePath.replace(/\.package\.json$/, '.report.json')
    : null;
}

function validateReadinessReport(report, packageEntry, reportPath) {
  const readiness = readObject(report?.readiness);
  const targetTabId = readString(report?.targetTabId);
  const failures = [];
  if (!readiness) {
    return {
      packagePath: packageEntry.filePath,
      reportPath,
      platform: packageEntry.pkg?.platform ?? 'unknown-platform',
      status: 'legacy-report',
      failures: ['readiness:missing'],
      readiness: null,
    };
  }
  const targetPollCount = readNumber(readiness?.targetPollCount);
  const targetWaitTimeoutMs = readNumber(readiness?.targetWaitTimeoutMs);
  const targetWaitedMs = readNumber(readiness?.targetWaitedMs);
  const postSelectionSettleMs = readNumber(readiness?.postSelectionSettleMs);
  const postSelectionSettleWaitedMs = readNumber(readiness?.postSelectionSettleWaitedMs);
  const beforeTabId = readString(readiness?.selectedTabBeforeSettle?.tabId);
  const afterTabId = readString(readiness?.selectedTabAfterSettle?.tabId);

  if (targetPollCount === null || targetPollCount < 1) failures.push(`targetPollCount:${String(targetPollCount)}`);
  if (targetWaitTimeoutMs === null || targetWaitTimeoutMs < 5000) {
    failures.push(`targetWaitTimeoutMs:${String(targetWaitTimeoutMs)}`);
  }
  if (targetWaitedMs === null || targetWaitedMs < 0) failures.push(`targetWaitedMs:${String(targetWaitedMs)}`);
  if (postSelectionSettleMs === null || postSelectionSettleMs < 5000) {
    failures.push(`postSelectionSettleMs:${String(postSelectionSettleMs)}`);
  }
  if (
    postSelectionSettleWaitedMs === null
    || (postSelectionSettleMs !== null && postSelectionSettleWaitedMs + 50 < postSelectionSettleMs)
  ) {
    failures.push(`postSelectionSettleWaitedMs:${String(postSelectionSettleWaitedMs)}`);
  }
  if (!beforeTabId) failures.push('selectedTabBeforeSettle.tabId:missing');
  if (!afterTabId) failures.push('selectedTabAfterSettle.tabId:missing');
  if (targetTabId && beforeTabId && beforeTabId !== targetTabId) {
    failures.push(`selectedTabBeforeSettle.tabId:${beforeTabId}`);
  }
  if (targetTabId && afterTabId && afterTabId !== targetTabId) {
    failures.push(`selectedTabAfterSettle.tabId:${afterTabId}`);
  }

  return {
    packagePath: packageEntry.filePath,
    reportPath,
    platform: packageEntry.pkg?.platform ?? 'unknown-platform',
    status: failures.length === 0 ? 'auditable' : 'invalid',
    failures,
    readiness: readiness ?? null,
  };
}

async function collectReadinessAudits(packageEntries) {
  const audits = [];
  for (const entry of packageEntries) {
    const reportPath = companionReportPathForPackage(entry.filePath);
    if (!reportPath) {
      audits.push({
        packagePath: entry.filePath,
        reportPath: null,
        platform: entry.pkg?.platform ?? 'unknown-platform',
        status: 'missing-report',
        failures: ['reportPath:unresolved'],
      });
      continue;
    }
    let report = null;
    try {
      report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    } catch {
      audits.push({
        packagePath: entry.filePath,
        reportPath,
        platform: entry.pkg?.platform ?? 'unknown-platform',
        status: 'missing-report',
        failures: ['report:missing'],
      });
      continue;
    }
    audits.push(validateReadinessReport(report, entry, reportPath));
  }
  return audits;
}

function readinessAuditCounts(audits) {
  return {
    total: audits.length,
    auditable: audits.filter((entry) => entry.status === 'auditable').length,
    missingReport: audits.filter((entry) => entry.status === 'missing-report').length,
    legacyReport: audits.filter((entry) => entry.status === 'legacy-report').length,
    invalid: audits.filter((entry) => entry.status === 'invalid').length,
  };
}

function printReadinessAuditSummary(audits) {
  if (!Array.isArray(audits) || audits.length === 0) return;
  const counts = readinessAuditCounts(audits);
  console.log(
    `Readiness reports: ${counts.auditable}/${counts.total} auditable `
      + `(missing report: ${counts.missingReport}, legacy report: ${counts.legacyReport}, invalid: ${counts.invalid})`,
  );
  for (const entry of audits.filter((audit) => audit.status !== 'auditable').slice(0, 5)) {
    const relPackagePath = path.relative(repoRoot, entry.packagePath);
    console.log(`  ${entry.platform}: ${entry.status} ${relPackagePath} ${entry.failures.join(', ')}`);
  }
}

function summarizeBridgeTabs(status) {
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  return {
    total: tabs.length,
    fresh: tabs.filter(isFreshBridgeTab).length,
    unresponsive: tabs.filter((tab) => tab?.unresponsiveForMs && tab.unresponsiveForMs > 0).length,
    stale: tabs.filter((tab) => {
      const seenAgoMs = tab?.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER;
      return (!tab?.unresponsiveForMs || tab.unresponsiveForMs <= 0) && seenAgoMs > maxBridgeTabSeenAgoMs;
    }).length,
    maxSeenAgoMs: maxSeenAgoMs(),
  };

  function maxSeenAgoMs() {
    const values = tabs
      .map((tab) => readNumber(tab?.lastSeenAgoMs))
      .filter((value) => value !== null);
    return values.length > 0 ? Math.max(...values) : null;
  }
}

function packageSortTime(pkg, filePath) {
  if (typeof pkg?.createdAt === 'number' && Number.isFinite(pkg.createdAt)) {
    return pkg.createdAt;
  }
  if (typeof pkg?.finishedAt === 'number' && Number.isFinite(pkg.finishedAt)) {
    return pkg.finishedAt;
  }
  const basename = path.basename(filePath);
  const match = /^(\d{8})-(\d{6})Z-/.exec(basename);
  if (!match) return 0;
  const [, day, time] = match;
  const parsed = Date.parse(`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}Z`);
  return Number.isFinite(parsed) ? parsed : 0;
}

function selectLatestPackageEntryPerPlatform(entries) {
  const latestByPlatform = new Map();
  const ungrouped = [];
  for (const entry of entries) {
    const platform = typeof entry.pkg?.platform === 'string' ? entry.pkg.platform : null;
    if (!requiredPlatforms.includes(platform)) {
      ungrouped.push(entry);
      continue;
    }
    const current = latestByPlatform.get(platform);
    if (!current || packageSortTime(entry.pkg, entry.filePath) > packageSortTime(current.pkg, current.filePath)) {
      latestByPlatform.set(platform, entry);
    }
  }
  return [...latestByPlatform.values(), ...ungrouped]
    .sort((a, b) => a.filePath.localeCompare(b.filePath));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function collect(options) {
  const bridge = await createBridge(options);
  if (options.waitMs > 0) {
    console.log(`Waiting up to ${options.waitMs}ms for a live MasterSelects bridge tab...`);
  }
  const selected = options.waitMs > 0
    ? await bridge.waitForTargetTab(options.waitMs)
    : await bridge.selectTargetTab();
  console.log(`Bridge: ${bridge.baseUrl.origin}`);
  console.log(`Target tab: ${selected.targetTabId}`);
  const readiness = {
    targetWaitTimeoutMs: options.waitMs,
    targetWaitedMs: selected.readinessWaitedMs ?? 0,
    targetPollCount: selected.readinessPollCount ?? 1,
    selectedTabBeforeSettle: selected.targetTab ?? null,
    selectedTabAfterSettle: null,
    postSelectionSettleMs: options.waitMs,
    postSelectionSettleWaitedMs: 0,
  };
  if (options.waitMs > 0) {
    console.log(`Waiting ${options.waitMs}ms after target tab selection for MasterSelects to settle...`);
    const settleStartedAt = Date.now();
    await sleep(options.waitMs);
    readiness.postSelectionSettleWaitedMs = Date.now() - settleStartedAt;
    const selectedAfterSettle = await bridge.selectTargetTab();
    readiness.selectedTabAfterSettle = selectedAfterSettle.targetTab ?? null;
  }

  console.log('Collecting worker-first platform evidence package...');
  const result = await bridge.postTool(
    'runWorkerFirstPlatformEvidencePackage',
    options.collectArgs,
    options.timeoutMs,
  );
  const pkg = result?.data?.package ?? null;
  const platform = pkg?.platform ?? 'unknown-platform';
  const hash = typeof pkg?.evidenceHash === 'string' ? pkg.evidenceHash.slice(0, 12) : 'nohash';
  const stamp = timestampForPath();
  const collectSucceeded = result?.success === true;
  const packagePath = path.join(
    options.out,
    collectSucceeded
      ? `${stamp}-${platform}-${hash}.package.json`
      : `${stamp}-${platform}-${hash}.failed.json`,
  );
  const reportPath = path.join(options.out, `${stamp}-${platform}-${hash}.report.json`);
  const platformMatchesExpectation = !options.expectedPlatform || platform === options.expectedPlatform;

  if (pkg) {
    await writeJson(packagePath, pkg);
  }
  await writeJson(reportPath, {
    name: 'Worker-First platform evidence package run',
    generatedAt: new Date().toISOString(),
    baseUrl: bridge.baseUrl.origin,
    targetTabId: bridge.targetTabId,
    readiness,
    args: options.collectArgs,
    expectedPlatform: options.expectedPlatform,
    platformMatchesExpectation,
    result,
    packagePath: pkg ? packagePath : null,
    selectablePackage: Boolean(pkg && collectSucceeded),
  });

  console.log(`Result: ${result?.success === true ? 'success' : 'failed'}`);
  console.log(`Platform: ${platform}`);
  if (options.expectedPlatform) console.log(`Expected platform: ${options.expectedPlatform}`);
  console.log(`Evidence hash: ${pkg?.evidenceHash ?? 'n/a'}`);
  if (pkg) console.log(`Package: ${path.relative(repoRoot, packagePath)}`);
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);

  if (result?.success !== true) {
    throw new Error(result?.error || 'Platform evidence package collection failed');
  }
  if (!platformMatchesExpectation) {
    throw new Error(`Collected platform ${platform} did not match expected platform ${options.expectedPlatform}`);
  }
}

async function verify(options) {
  const packagePaths = options.packagePaths.length > 0
    ? options.packagePaths
    : await defaultPackagePaths(options.out);
  if (packagePaths.length === 0) {
    throw new Error(`No package files provided and none found in ${options.out}`);
  }

  const packageEntries = await loadPackageEntries(packagePaths);
  const selectedEntries = options.latestPerPlatform
    ? selectLatestPackageEntryPerPlatform(packageEntries)
    : packageEntries;
  const packages = selectedEntries.map((entry) => entry.pkg);
  const readinessAudit = await collectReadinessAudits(selectedEntries);
  console.log(`Packages: ${selectedEntries.length}${options.latestPerPlatform ? ` selected from ${packagePaths.length}` : ''}`);
  let result;
  let baseUrl = null;
  let targetTabId = null;
  if (options.bridgeVerify) {
    const bridge = await createBridge(options);
    await bridge.selectTargetTab();
    baseUrl = bridge.baseUrl.origin;
    targetTabId = bridge.targetTabId;
    console.log(`Bridge: ${baseUrl}`);
    console.log(`Target tab: ${targetTabId}`);
    result = await bridge.postTool(
      'verifyWorkerFirstPlatformEvidenceMatrix',
      { packages },
      options.timeoutMs,
    );
  } else {
    console.log('Verifier: offline');
    result = verifyPackagesOffline(packages);
  }
  const data = result?.data ?? {};
  const nextStep = missingPlatformGuidance(data.missingPlatforms);
  const stamp = timestampForPath();
  const mode = options.bridgeVerify ? 'bridge' : 'offline';
  const reportPath = path.join(options.out, `${stamp}-${mode}-platform-matrix.report.json`);
  await writeJson(reportPath, {
    name: 'Worker-First platform evidence matrix verification',
    generatedAt: new Date().toISOString(),
    mode,
    baseUrl,
    targetTabId,
    tokenFile: options.tokenFile,
    packagePaths,
    selectedPackagePaths: selectedEntries.map((entry) => entry.filePath),
    latestPerPlatform: options.latestPerPlatform,
    readinessAudit,
    nextStep,
    result,
  });

  console.log(`Matrix: ${result?.success === true ? 'complete' : 'incomplete'}`);
  console.log(`Valid packages: ${data.validPackageCount ?? 0}/${data.providedPackageCount ?? selectedEntries.length}`);
  console.log(`Missing platforms: ${(data.missingPlatforms ?? []).join(', ') || '-'}`);
  console.log(`Duplicate platforms: ${(data.duplicatePlatforms ?? []).join(', ') || '-'}`);
  console.log(`Invalid packages: ${(data.invalidPackages ?? []).length}`);
  printPlatformProofSummary(data);
  printReadinessAuditSummary(readinessAudit);
  if (nextStep) console.log(nextStep);
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);

  if (result?.success !== true) {
    throw new Error(result?.error || 'Platform evidence matrix verification failed');
  }
}

async function status(options) {
  const packagePaths = options.packagePaths.length > 0
    ? options.packagePaths
    : await defaultPackagePaths(options.out);
  if (packagePaths.length === 0) {
    throw new Error(`No package files provided and none found in ${options.out}`);
  }

  const packageEntries = await loadPackageEntries(packagePaths);
  const selectedEntries = options.latestPerPlatform
    ? selectLatestPackageEntryPerPlatform(packageEntries)
    : packageEntries;
  const packages = selectedEntries.map((entry) => entry.pkg);
  const readinessAudit = await collectReadinessAudits(selectedEntries);
  const result = verifyPackagesOffline(packages);
  const data = result.data ?? {};
  const nextStep = missingPlatformGuidance(data.missingPlatforms);
  console.log(`Packages: ${selectedEntries.length}${options.latestPerPlatform ? ` selected from ${packagePaths.length}` : ''}`);
  console.log('Verifier: offline');
  console.log(`Matrix: ${result.success === true ? 'complete' : 'incomplete'}`);
  console.log(`Valid packages: ${data.validPackageCount ?? 0}/${data.providedPackageCount ?? selectedEntries.length}`);
  console.log(`Missing platforms: ${(data.missingPlatforms ?? []).join(', ') || '-'}`);
  console.log(`Duplicate platforms: ${(data.duplicatePlatforms ?? []).join(', ') || '-'}`);
  console.log(`Invalid packages: ${(data.invalidPackages ?? []).length}`);
  printPlatformProofSummary(data);
  printReadinessAuditSummary(readinessAudit);
  if (nextStep) console.log(nextStep);
}

async function doctor(options) {
  const packagePaths = options.packagePaths.length > 0
    ? options.packagePaths
    : await defaultPackagePaths(options.out);
  let selectedEntries = [];
  let result = null;
  let packageError = null;

  if (packagePaths.length > 0) {
    try {
      const packageEntries = await loadPackageEntries(packagePaths);
      selectedEntries = options.latestPerPlatform
        ? selectLatestPackageEntryPerPlatform(packageEntries)
        : packageEntries;
      result = verifyPackagesOffline(selectedEntries.map((entry) => entry.pkg));
    } catch (error) {
      packageError = error instanceof Error ? error.message : String(error);
    }
  }

  const data = result?.data ?? {};
  const readinessAudit = selectedEntries.length > 0
    ? await collectReadinessAudits(selectedEntries)
    : [];
  const nextStep = missingPlatformGuidance(data.missingPlatforms ?? requiredPlatforms);
  let bridgeStatus = null;
  let bridgeError = null;
  let bridgeAuthStatus = null;
  let bridgeAuthError = null;
  let bridgeTabSummary = null;
  let baseUrl = null;
  let targetTabId = null;

  try {
    const bridge = await createBridge(options);
    baseUrl = bridge.baseUrl.origin;
    const statusResult = await bridge.getStatus();
    try {
      bridgeAuthStatus = await bridge.getAuthStatus();
    } catch (error) {
      bridgeAuthError = error instanceof Error ? error.message : String(error);
    }
    bridgeStatus = statusResult;
    bridgeTabSummary = summarizeBridgeTabs(statusResult);
    targetTabId = chooseTargetTabId(statusResult);
  } catch (error) {
    bridgeError = error instanceof Error ? error.message : String(error);
  }

  const stamp = timestampForPath();
  const reportPath = path.join(options.out, `${stamp}-platform-doctor.report.json`);
  await writeJson(reportPath, {
    name: 'Worker-First platform evidence doctor',
    generatedAt: new Date().toISOString(),
    baseUrl,
    targetTabId,
    tokenFile: options.tokenFile,
    packagePaths,
    selectedPackagePaths: selectedEntries.map((entry) => entry.filePath),
    latestPerPlatform: options.latestPerPlatform,
    readinessAudit,
    packageError,
    matrix: result,
    nextStep,
    bridgeStatus,
    bridgeTabSummary,
    bridgeError,
    bridgeAuthStatus,
    bridgeAuthError,
    requiredPlatforms,
  });

  console.log('Worker-First platform evidence doctor');
  console.log(`Packages: ${selectedEntries.length}${options.latestPerPlatform ? ` selected from ${packagePaths.length}` : ''}`);
  if (packageError) console.log(`Package error: ${packageError}`);
  console.log(`Matrix: ${result?.success === true ? 'complete' : 'incomplete'}`);
  console.log(`Valid packages: ${data.validPackageCount ?? 0}/${data.providedPackageCount ?? selectedEntries.length}`);
  console.log(`Missing platforms: ${(data.missingPlatforms ?? requiredPlatforms).join(', ') || '-'}`);
  console.log(`Duplicate platforms: ${(data.duplicatePlatforms ?? []).join(', ') || '-'}`);
  console.log(`Invalid packages: ${(data.invalidPackages ?? []).length}`);
  printPlatformProofSummary(data);
  printReadinessAuditSummary(readinessAudit);
  if (nextStep) console.log(nextStep);
  if (bridgeError) {
    console.log(`Bridge: unavailable (${bridgeError})`);
  } else {
    console.log(`Bridge: ${baseUrl ?? options.baseUrl}`);
    console.log(`Bridge clients: ${bridgeStatus?.clients ?? 0}`);
    if (bridgeTabSummary) {
      console.log(
        `Fresh tabs: ${bridgeTabSummary.fresh}/${bridgeTabSummary.total} `
          + `(stale: ${bridgeTabSummary.stale}, unresponsive: ${bridgeTabSummary.unresponsive}, `
          + `threshold: ${maxBridgeTabSeenAgoMs}ms)`,
      );
    }
    console.log(`Target tab: ${targetTabId ?? '-'}`);
  }
  if (bridgeAuthError) {
    console.log(`Bridge auth: failed (${bridgeAuthError})`);
  } else if (bridgeAuthStatus) {
    console.log('Bridge auth: ok');
  }
  console.log(`Collector wait: ${options.waitMs}ms`);
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
}

function printMacosRunbook(options) {
  const out = (path.relative(repoRoot, options.out) || '.').split(path.sep).join('/');
  const commonCollectArgs = [
    '--wait-ms 12000',
    '--timeout-ms 300000',
    '--duration-ms 3000',
    '--min-preview-frames 2',
    '--sample-width 16',
    '--sample-height 9',
    '--capture-settle-ms 1200',
    '--start-time 0.5',
    '--reset-diagnostics',
  ].join(' ');

  console.log(`Worker-First macOS platform evidence runbook

Run on a real Mac from this repository checkout. Do not use Playwright WebKit
or a remote browser pretending to be Safari; the package platform must be
derived by the in-browser capability probe.

1. Start the dev server:
   npm install
   npm run dev

2. Safari package:
   - Open http://localhost:5173/ in Safari.
   - Wait until the editor UI is fully loaded, then keep the tab visible/focused.
   npm run worker-first:platform:collect -- --expect-platform macos-safari ${commonCollectArgs}

3. Firefox package:
   - Open http://localhost:5173/ in Firefox on the same Mac.
   - Wait until the editor UI is fully loaded, then keep the tab visible/focused.
   - If Firefox does not expose WebGPU, enable WebGPU in about:config and relaunch,
     then rerun this exact collect command.
   npm run worker-first:platform:collect -- --expect-platform macos-firefox ${commonCollectArgs}

4. Verify on the Mac:
   npm run worker-first:platform:status -- --latest-per-platform
   npm run worker-first:platform:verify -- --latest-per-platform

5. Copy the new *.package.json files and their matching *.report.json files
   from ${out} back into the same relative directory in the main worktree,
   then rerun:
   npm run worker-first:platform:verify -- --latest-per-platform
`);
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }
  await fs.mkdir(options.out, { recursive: true });
  if (options.command === 'collect') {
    await collect(options);
  } else if (options.command === 'verify') {
    await verify(options);
  } else if (options.command === 'status') {
    await status(options);
  } else if (options.command === 'macos-runbook') {
    printMacosRunbook(options);
  } else {
    await doctor(options);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
