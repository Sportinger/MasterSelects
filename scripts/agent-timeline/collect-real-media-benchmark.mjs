import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRealMediaReport,
  createRealMediaEvidence,
  fingerprintRealMedia,
} from './realMediaBenchmark.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, '..', '..');
const supportedAnalyzers = ['cuts', 'focus-motion', 'faces', 'audio'];

function printHelp() {
  console.log(`Usage: node scripts/agent-timeline/collect-real-media-benchmark.mjs [options]

Collects local, real-media benchmark evidence through an already-registered dev-bridge
tool. It never uploads media, starts cloud analysis, or fabricates values. The selected
tool must implement the documented two-pass contract (baseline + analysis) and return
agent-timeline-real-media-benchmark/v1 local-analysis-pass JSON.

Required:
  --media <path>                 User-selected local media file
  --duration-seconds <n>         Measured source duration; use ffprobe externally if needed
  --scenario <id>                Stable scenario identifier, e.g. handheld-low-light
 --profile quick|balanced|deep
  --baseline-kind standalone-cut|proxy-piggyback
  --tool <registered bridge tool> Local benchmark runner registered by the app

Options:
  --analyzers cuts,focus-motion,faces,audio  Defaults to all four
  --cache-states cold,warm                   Defaults to cold,warm
  --base-url <url>                           Default http://localhost:5173
  --token-file <path>                        Default .ai-bridge-token
  --target-tab-id <id>                       Explicit connected dev-bridge tab
  --timeout-ms <n>                           Per-pass bridge timeout, default 300000
  --out <file>                               Default tmp/agent-timeline-benchmarks/real-media.json
  --cancel-after <baseline|analysis>         Stop cleanly after the named pass

Cold-cache instructions: clear only local analyzer/model/artifact caches, reopen the
same project, wait 5 seconds after that reload, then run this command. The runner must
confirm the reset. Warm evidence must keep the same profile/project and report zero
redundantly decoded seconds. Synthetic reports never qualify for analysisBenchmarkGate.
`);
}

function parseList(value, label, allowed) {
  const entries = value.split(',').filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !allowed.includes(entry))) {
    throw new Error(`${label} must contain only: ${allowed.join(', ')}`);
  }
  return [...new Set(entries)];
}

function numberArg(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be positive and finite`);
  return parsed;
}

function parseArgs(argv) {
  const options = {
    baseUrl: 'http://localhost:5173', tokenFile: path.join(repoRoot, '.ai-bridge-token'), targetTabId: null,
    timeoutMs: 300000, analyzers: supportedAnalyzers, cacheStates: ['cold', 'warm'], baselineKind: 'standalone-cut', cancelAfter: null,
    out: path.join(repoRoot, 'tmp', 'agent-timeline-benchmarks', 'real-media.json'),
  };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--media') options.media = path.resolve(argv[++index] ?? '');
    else if (arg === '--duration-seconds') options.durationSeconds = numberArg(argv[++index], '--duration-seconds');
    else if (arg === '--scenario') options.scenarioId = argv[++index] ?? '';
    else if (arg === '--profile') options.profile = argv[++index] ?? '';
    else if (arg === '--baseline-kind') options.baselineKind = argv[++index] ?? '';
    else if (arg === '--tool') options.tool = argv[++index] ?? '';
    else if (arg === '--analyzers') options.analyzers = parseList(argv[++index] ?? '', '--analyzers', supportedAnalyzers);
    else if (arg === '--cache-states') options.cacheStates = parseList(argv[++index] ?? '', '--cache-states', ['cold', 'warm']);
    else if (arg === '--base-url') options.baseUrl = argv[++index] ?? options.baseUrl;
    else if (arg === '--token-file') options.tokenFile = path.resolve(argv[++index] ?? options.tokenFile);
    else if (arg === '--target-tab-id') options.targetTabId = argv[++index] ?? null;
    else if (arg === '--timeout-ms') options.timeoutMs = numberArg(argv[++index], '--timeout-ms');
    else if (arg === '--out') options.out = path.resolve(argv[++index] ?? options.out);
    else if (arg === '--cancel-after') options.cancelAfter = argv[++index] ?? null;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!options.help) {
    for (const key of ['media', 'durationSeconds', 'scenarioId', 'profile', 'tool']) {
      if (!options[key]) throw new Error(`Missing required --${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`);
    }
    if (!['quick', 'balanced', 'deep'].includes(options.profile)) throw new Error('--profile must be quick, balanced, or deep');
    if (!['standalone-cut', 'proxy-piggyback'].includes(options.baselineKind)) throw new Error('--baseline-kind must be standalone-cut or proxy-piggyback');
    if (options.cancelAfter && !['baseline', 'analysis'].includes(options.cancelAfter)) throw new Error('--cancel-after must be baseline or analysis');
  }
  return options;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

async function fetchJson(url, init, label, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status} ${payload.error ?? response.statusText}`);
    return payload;
  } finally { clearTimeout(timer); }
}

function selectTarget(status, requestedId) {
  const tabs = Array.isArray(status?.clientTabs) ? status.clientTabs : [];
  const fresh = tabs.filter((tab) => tab && !tab.unresponsiveForMs && (tab.lastSeenAgoMs ?? Infinity) <= 10000);
  const selected = requestedId ? fresh.find((tab) => tab.tabId === requestedId) : fresh.toSorted((left, right) => Number(right.visibilityState === 'visible') - Number(left.visibilityState === 'visible') || Number(Boolean(right.hasFocus)) - Number(Boolean(left.hasFocus)))[0];
  if (!selected?.tabId) throw new Error('No fresh dev-bridge browser tab is connected. Open the project and wait for registration.');
  return selected.tabId;
}

async function createBridge(options) {
  const token = (await fs.readFile(options.tokenFile, 'utf8')).trim();
  if (!token) throw new Error(`Bridge token is empty: ${options.tokenFile}`);
  const endpoint = new URL('/api/ai-tools', options.baseUrl);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const status = await fetchJson(endpoint, { method: 'GET' }, 'bridge status', 5000);
  const targetTabId = selectTarget(status, options.targetTabId);
  return {
    targetTabId,
    async invoke(tool, args) {
      const response = await fetchJson(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ tool, args, timeoutMs: options.timeoutMs, targetTabId }),
      }, tool, options.timeoutMs + 30000);
      if (response?.success !== true) throw new Error(response?.error ?? `${tool} did not return success=true`);
      return response.data;
    },
  };
}

async function main() {
  const options = parseArgs(process.argv);
  if (options.help) return printHelp();
  const [media, bridge] = await Promise.all([fingerprintRealMedia(options.media), createBridge(options)]);
  const evidence = [];
  let cancelled = false;
  for (const cacheState of options.cacheStates) {
    for (const analyzer of options.analyzers) {
      const request = {
        schemaVersion: 'agent-timeline-real-media-benchmark/v1', kind: 'agent-timeline-benchmark-request',
        localOnly: true, mediaPath: options.media, mediaFingerprint: media, durationSeconds: options.durationSeconds,
        scenarioId: options.scenarioId, profile: options.profile, analyzer, baselineKind: options.baselineKind, cacheState,
      };
      const baseline = await bridge.invoke(options.tool, { ...request, pass: 'baseline' });
      if (options.cancelAfter === 'baseline') { cancelled = true; break; }
      const analysis = await bridge.invoke(options.tool, { ...request, pass: 'analysis' });
      evidence.push(createRealMediaEvidence({ ...request, media, baseline, analysis }));
      if (options.cancelAfter === 'analysis') { cancelled = true; break; }
    }
    if (cancelled) break;
  }
  const report = buildRealMediaReport(evidence, {
    host: { platform: process.platform, arch: process.arch, release: os.release() },
    bridge: { baseUrl: options.baseUrl, targetTabId: bridge.targetTabId, tool: options.tool },
    cancelled,
  });
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Real-media evidence: ${report.summary.gateEligibleEvidence}/${report.summary.totalEvidence} gate-eligible`);
  console.log(`Report: ${path.relative(repoRoot, options.out)}`);
  if (cancelled) process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
