import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const defaultManifestPath = path.join(repoRoot, 'fixtures', 'torture-media', 'manifest.local.json');
const defaultReportsDir = path.join(repoRoot, 'fixtures', 'torture-media', 'reports');

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:5173',
    manifest: defaultManifestPath,
    out: defaultReportsDir,
    skipExport: false,
    includePrecise: false,
  };

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? options.baseUrl;
    } else if (arg === '--manifest') {
      options.manifest = path.resolve(argv[++index] ?? options.manifest);
    } else if (arg === '--out') {
      options.out = path.resolve(argv[++index] ?? options.out);
    } else if (arg === '--skip-export') {
      options.skipExport = true;
    } else if (arg === '--include-precise') {
      options.includePrecise = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(`Usage: npm run torture:bridge-fast -- [options]

Options:
  --base-url <url>     Dev server base URL. Default: http://localhost:5173
  --manifest <path>    Local torture media manifest. Default: fixtures/torture-media/manifest.local.json
  --out <dir>          Report output directory. Default: fixtures/torture-media/reports
  --skip-export        Build/scrub/capture only; skip fast and precise export probes
  --include-precise    Also run a short precise/HTML export probe
`);
}

async function readJson(filePath) {
  const text = await fs.readFile(filePath, 'utf8');
  return JSON.parse(text);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readBridgeToken() {
  const tokenPath = path.join(repoRoot, '.ai-bridge-token');
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (!token) {
    throw new Error(`Bridge token file is empty: ${tokenPath}`);
  }
  return token;
}

function timestampForPath(date = new Date()) {
  return date.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z')
    .replace('T', '-');
}

function compactDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    return value;
  }
  const commaIndex = value.indexOf(',');
  const meta = commaIndex >= 0 ? value.slice(0, commaIndex) : 'data';
  const bytes = commaIndex >= 0
    ? Math.floor((value.length - commaIndex - 1) * 0.75)
    : value.length;
  return `[redacted ${meta}, approx ${bytes} bytes]`;
}

function compactReportValue(value) {
  if (Array.isArray(value)) {
    return value.map(compactReportValue);
  }
  if (!value || typeof value !== 'object') {
    return compactDataUrl(value);
  }

  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    output[key] = key === 'dataUrl'
      ? compactDataUrl(entry)
      : compactReportValue(entry);
  }
  return output;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Frame grid result did not contain a base64 data URL');
  }
  return {
    mimeType: match[1],
    bytes: Buffer.from(match[2], 'base64'),
  };
}

function assertToolSuccess(label, result) {
  if (!result || result.success !== true) {
    const message = result?.error || `Tool failed: ${label}`;
    throw new Error(`${label}: ${message}`);
  }
  return result;
}

function getExportBlobSize(result) {
  const blob = result?.data?.blob;
  return typeof blob?.size === 'number' ? blob.size : 0;
}

function chooseTargetTabId(status) {
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  const liveTabs = tabs.filter((tab) => !tab.unresponsiveForMs || tab.unresponsiveForMs <= 0);
  if (liveTabs.length === 0) {
    return null;
  }
  liveTabs.sort((a, b) => {
    const visibleScore = Number(b.visibilityState === 'visible') - Number(a.visibilityState === 'visible');
    if (visibleScore !== 0) return visibleScore;
    const focusScore = Number(Boolean(b.hasFocus)) - Number(Boolean(a.hasFocus));
    if (focusScore !== 0) return focusScore;
    return (a.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER) - (b.lastSeenAgoMs ?? Number.MAX_SAFE_INTEGER);
  });
  return typeof liveTabs[0]?.tabId === 'string' ? liveTabs[0].tabId : null;
}

async function fetchJson(url, init, label, timeoutMs = 35000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
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

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) {
    printHelp();
    return;
  }

  const manifest = await readJson(options.manifest);
  const importPaths = Array.isArray(manifest.importPaths) ? manifest.importPaths : [];
  if (importPaths.length < 3) {
    throw new Error(`Manifest must contain at least three importPaths: ${options.manifest}`);
  }

  for (const importPath of importPaths.slice(0, 3)) {
    if (!(await pathExists(importPath))) {
      throw new Error(`Fixture media file missing: ${importPath}`);
    }
  }

  const token = await readBridgeToken();
  const baseUrl = new URL(options.baseUrl);
  const apiUrl = new URL('/api/ai-tools', baseUrl);
  const runDir = path.join(options.out, `run-${timestampForPath()}`);
  await fs.mkdir(runDir, { recursive: true });

  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let targetTabId = null;

  async function postTool(tool, args = {}, timeoutMs = 35000) {
    return fetchJson(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ tool, args, timeoutMs, targetTabId }),
    }, tool, timeoutMs + 5000);
  }

  console.log(`Bridge: ${baseUrl.origin}`);
  console.log(`Manifest: ${path.relative(repoRoot, options.manifest)}`);
  console.log(`Report dir: ${path.relative(repoRoot, runDir)}`);

  const runStartedAt = new Date().toISOString();
  const report = {
    name: 'MasterSelects bridge torture fast',
    generatedAt: runStartedAt,
    baseUrl: baseUrl.origin,
    manifestPath: options.manifest,
    runDir,
    steps: {},
    artifacts: {},
    summary: {},
  };

  const status = await fetchJson(apiUrl, { method: 'GET' }, 'bridge status', 5000);
  report.steps.status = status;
  if (!status.clients || status.clients < 1) {
    throw new Error('No browser tab is connected to the dev bridge. Open the running dev server page first.');
  }
  targetTabId = chooseTargetTabId(status);
  if (targetTabId) {
    report.targetTabId = targetTabId;
    console.log(`Target tab: ${targetTabId}`);
  }

  report.steps.clearRuntimeDiagnostics = await postTool('clearRuntimeDiagnostics', {}, 10000);

  console.log('Creating fixture project...');
  report.steps.createFixture = assertToolSuccess('createTortureProjectFixture', await postTool('createTortureProjectFixture', {
    paths: importPaths.slice(0, 3),
    resetProject: true,
    projectName: `Bridge Torture Fast ${new Date().toLocaleString('sv-SE')}`,
    durationSeconds: 6.2,
    width: 1920,
    height: 1080,
    frameRate: 24,
  }, 90000));

  console.log('Scrubbing timeline...');
  report.steps.scrub = assertToolSuccess('simulateScrub', await postTool('simulateScrub', {
    pattern: 'custom',
    points: [0.25, 2.65, 4.8, 1.1, 5.85, 3.25],
    durationMs: 1200,
    resetDiagnostics: true,
  }, 20000));

  console.log('Running short playback...');
  report.steps.playback = assertToolSuccess('simulatePlayback', await postTool('simulatePlayback', {
    startTime: 0.25,
    durationMs: 1500,
    settleMs: 120,
    resetDiagnostics: false,
  }, 20000));

  console.log('Capturing frame grid...');
  const frames = assertToolSuccess('getFramesAtTimes', await postTool('getFramesAtTimes', {
    times: [0.25, 0.85, 1.2, 1.8, 2.35, 3.35],
    columns: 3,
    settleMs: 450,
    mode: 'dom',
  }, 20000));
  report.steps.frames = frames;

  const frameDataUrl = frames?.data?.dataUrl;
  if (typeof frameDataUrl === 'string') {
    const decoded = decodeDataUrl(frameDataUrl);
    const frameGridPath = path.join(runDir, 'frame-grid.png');
    await fs.writeFile(frameGridPath, decoded.bytes);
    report.artifacts.frameGrid = frameGridPath;
    report.summary.frameGridBytes = decoded.bytes.length;
  }

  if (!options.skipExport) {
    console.log('Exporting fast probe...');
    report.steps.exportFast = assertToolSuccess('debugExport fast', await postTool('debugExport', {
      startTime: 0,
      durationSeconds: 1.2,
      width: 640,
      height: 360,
      fps: 12,
      includeAudio: false,
      exportMode: 'fast',
      download: false,
      maxRuntimeMs: 25000,
    }, 30000));

    const fastSize = getExportBlobSize(report.steps.exportFast);
    if (fastSize <= 0) {
      throw new Error('Fast export returned an empty blob');
    }

    report.summary.exportFastBytes = fastSize;

    if (options.includePrecise) {
      console.log('Exporting precise HTML probe...');
      report.steps.exportPrecise = assertToolSuccess('debugExport precise', await postTool('debugExport', {
        startTime: 2.8,
        durationSeconds: 0.5,
        width: 320,
        height: 180,
        fps: 8,
        includeAudio: false,
        exportMode: 'precise',
        download: false,
        maxRuntimeMs: 60000,
      }, 90000));

      const preciseSize = getExportBlobSize(report.steps.exportPrecise);
      if (preciseSize <= 0) {
        throw new Error('Precise export returned an empty blob');
      }
      report.summary.exportPreciseBytes = preciseSize;
    }
  }

  console.log('Collecting diagnostics...');
  report.steps.stats = await postTool('getStats', {}, 10000);
  report.steps.runtimeDiagnostics = await postTool('getRuntimeDiagnostics', { limit: 500 }, 10000);
  report.steps.warnLogs = await postTool('getLogs', { limit: 200, level: 'WARN', sinceIso: runStartedAt }, 10000);
  report.steps.playbackTrace = await postTool('getPlaybackTrace', { windowMs: 15000, limit: 500 }, 10000);

  const activeTimeline = report.steps.createFixture?.data?.timeline;
  const warnCount = report.steps.warnLogs?.data?.total ?? report.steps.warnLogs?.data?.logs?.length ?? null;
  report.summary = {
    ...report.summary,
    activeClipCount: activeTimeline?.clipCount ?? null,
    activeTrackCount: activeTimeline?.trackCount ?? null,
    markers: activeTimeline?.markers?.length ?? null,
    warnLogCount: warnCount,
    playbackFinalPosition: report.steps.playback?.data?.finalPosition ?? null,
    scrubDragMode: report.steps.scrub?.data?.dragMode ?? null,
  };

  const reportPath = path.join(runDir, 'report.json');
  await fs.writeFile(reportPath, JSON.stringify(compactReportValue(report), null, 2));

  console.log('');
  console.log('Fast torture run complete.');
  console.log(`Frame grid: ${path.relative(repoRoot, report.artifacts.frameGrid ?? '')}`);
  console.log(`Report: ${path.relative(repoRoot, reportPath)}`);
  console.log(`Fast export bytes: ${report.summary.exportFastBytes ?? 'skipped'}`);
  console.log(`Precise export bytes: ${report.summary.exportPreciseBytes ?? 'skipped'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
