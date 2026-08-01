#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_BASE_URL = 'http://localhost:5173/';
const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'docs', 'evidence', 'motion-design', 'md2');

export const MD2_EVIDENCE_SURFACES = Object.freeze([
  'direct-preview',
  'direct-export',
  'nested-preview',
  'nested-export',
  'global-graph',
  'motion-path-overlay',
]);

function usage() {
  return `Usage:
  node scripts/run-motion-design-md2-evidence.mjs \\
    --session-url "http://motion-md2.localhost:5173/?motionDesignEvidenceSession=<id>" \\
    --mode record|verify \\
    --baseline-dir <dedicated baseline directory> \\
    [--base-url http://localhost:5173/] \\
    [--output docs/evidence/motion-design/md2]

Safety rules:
  - This command never starts or navigates a server or browser.
  - --session-url is mandatory, exact, and must use a dedicated *.localhost hostname.
  - Plain localhost/loopback URLs and missing motionDesignEvidenceSession markers are rejected.
  - Other live sessions may exist; exactly one URL match is selected and targeted explicitly.
  - The target must be a blank, chat-free session with no open project.
  - Focused-tab fallback is forbidden.
  - Verify mode is filesystem-read-only; record writes only after all six PNG surfaces validate.
`;
}

export function parseMd2EvidenceArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT_DIR,
    sessionUrl: null,
    baselineDir: null,
    mode: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') return { ...options, help: true };
    if (['--base-url', '--output', '--session-url', '--baseline-dir', '--mode'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      index += 1;
      if (arg === '--base-url') options.baseUrl = value;
      if (arg === '--output') options.output = path.resolve(repoRoot, value);
      if (arg === '--session-url') options.sessionUrl = value;
      if (arg === '--baseline-dir') options.baselineDir = path.resolve(repoRoot, value);
      if (arg === '--mode') options.mode = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function normalizeHttpUrl(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute HTTP(S) URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${label} must use HTTP(S)`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not contain credentials`);
  }
  url.hash = '';
  return url;
}

function isIpv4Loopback(hostname) {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    && Number(parts[0]) === 127;
}

function assertRepoInternalDirectory(directory, label) {
  const absolute = path.resolve(directory);
  const relative = path.relative(repoRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a dedicated directory inside this repository`);
  }
  return absolute;
}

export function validateMd2DisposableSession(options) {
  if (!options.sessionUrl) {
    throw new Error('--session-url is required; focused/live localhost fallback is forbidden');
  }
  if (options.mode !== 'record' && options.mode !== 'verify') {
    throw new Error('--mode must be record or verify');
  }
  if (!options.baselineDir) throw new Error('--baseline-dir is required');

  const base = normalizeHttpUrl(options.baseUrl, '--base-url');
  const baseHostname = base.hostname.toLowerCase();
  if (
    baseHostname !== 'localhost'
    && baseHostname !== '::1'
    && baseHostname !== '[::1]'
    && !isIpv4Loopback(baseHostname)
  ) {
    throw new Error('--base-url must be loopback-only');
  }
  if (base.pathname !== '/' || base.search || base.hash) {
    throw new Error('--base-url must be an origin only, without path, query, or hash');
  }

  const baselineDir = assertRepoInternalDirectory(options.baselineDir, '--baseline-dir');
  const output = assertRepoInternalDirectory(options.output ?? DEFAULT_OUTPUT_DIR, '--output');
  const sessionUrl = normalizeHttpUrl(options.sessionUrl, '--session-url');
  const sessionHostname = sessionUrl.hostname.toLowerCase();
  if (
    sessionHostname === 'localhost'
    || sessionHostname === '::1'
    || sessionHostname === '[::1]'
    || isIpv4Loopback(sessionHostname)
    || !sessionHostname.endsWith('.localhost')
  ) {
    throw new Error('--session-url must use a dedicated *.localhost hostname');
  }
  if (sessionUrl.protocol !== base.protocol || sessionUrl.port !== base.port) {
    throw new Error('--session-url must use the same protocol and port as the local bridge base');
  }
  if (sessionUrl.origin === base.origin) {
    throw new Error('--session-url must not share the bridge base origin');
  }
  const marker = sessionUrl.searchParams.get('motionDesignEvidenceSession');
  if (!marker || !marker.trim()) {
    throw new Error('--session-url must include a non-empty motionDesignEvidenceSession marker');
  }

  return { base, baselineDir, output, sessionUrl };
}

async function readBridgeToken() {
  const tokenPath = path.join(repoRoot, '.ai-bridge-token');
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error(`Bridge token file is empty: ${tokenPath}`);
  return token;
}

async function fetchJson(url, token, init = {}, timeoutMs = 35_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const body = await response.text();
    let payload;
    try {
      payload = body ? JSON.parse(body) : {};
    } catch {
      throw new Error(`${response.status} ${response.statusText}: expected JSON, received ${body.slice(0, 200)}`);
    }
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${payload.error ?? body}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function asRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function normalizedComparableUrl(value, label) {
  return normalizeHttpUrl(value, label).href;
}

export function selectExactMd2EvidenceSession(sessionsValue, sessionUrl) {
  const sessions = Array.isArray(sessionsValue) ? sessionsValue : [];
  const expectedUrl = normalizedComparableUrl(sessionUrl, 'expected session URL');
  const expectedOrigin = new URL(expectedUrl).origin;
  const matches = sessions.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    if (typeof candidate.url !== 'string') return false;
    try {
      return normalizedComparableUrl(candidate.url, 'live session URL') === expectedUrl;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one live session matching ${expectedUrl}; found ${matches.length}`);
  }

  const sameOriginSessions = sessions.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    if (typeof candidate.url !== 'string') return false;
    try {
      return new URL(normalizedComparableUrl(candidate.url, 'live session URL')).origin === expectedOrigin;
    } catch {
      return false;
    }
  });
  if (sameOriginSessions.length !== 1) {
    throw new Error('Disposable session origin is shared by another live tab');
  }

  const projectIds = sessions
    .map((candidate) => candidate && typeof candidate === 'object' ? candidate.projectId : null)
    .filter((projectId) => typeof projectId === 'string' && projectId.length > 0);
  if (new Set(projectIds).size !== projectIds.length) {
    throw new Error('Live bridge sessions contain a projectId collision');
  }

  const sessionIds = sessions
    .map((candidate) => candidate && typeof candidate === 'object' ? candidate.sessionId : null)
    .filter((sessionId) => typeof sessionId === 'string' && sessionId.length > 0);
  if (new Set(sessionIds).size !== sessionIds.length) {
    throw new Error('Live bridge sessions contain a sessionId collision');
  }

  const session = asRecord(matches[0], 'matched live session');
  if (typeof session.sessionId !== 'string' || !session.sessionId.trim()) {
    throw new Error('The exact disposable session has no session id');
  }
  if (session.projectId !== null) {
    throw new Error('Target disposable session must have projectId=null');
  }
  if (
    session.projectName !== null
    && session.projectName !== undefined
    && session.projectName !== 'Untitled Project'
  ) {
    throw new Error('Target disposable session must have no open project');
  }
  if (session.projectFileOpen !== false) {
    throw new Error('Target disposable session ProjectFileService must be closed');
  }
  if (session.chatMessageCount !== 0 || session.chatToolCallCount !== 0) {
    throw new Error('Target disposable session must contain no chat activity');
  }
  if (session.timelineClipCount !== 0) {
    throw new Error('Target disposable session must have a blank timeline');
  }

  return session;
}

async function resolveExactSession(base, sessionUrl, token) {
  const response = asRecord(
    await fetchJson(new URL('/api/agent-control/sessions', base), token, {}, 5_000),
    'session response',
  );
  const data = asRecord(response.data, 'session response data');
  return selectExactMd2EvidenceSession(data.sessions, sessionUrl.href);
}

function pngDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function decodePngDataUrl(value, label) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) {
    throw new Error(`${label} is not a base64 PNG data URL`);
  }
  const encoded = value.slice('data:image/png;base64,'.length);
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new Error(`${label} has invalid base64 PNG data`);
  }
  const buffer = Buffer.from(encoded, 'base64');
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buffer.length <= pngSignature.length || !pngSignature.every((byte, index) => buffer[index] === byte)) {
    throw new Error(`${label} does not contain a valid PNG signature`);
  }

  let offset = pngSignature.length;
  let chunkIndex = 0;
  let sawHeader = false;
  let sawImageData = false;
  let sawEnd = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new Error(`${label} has a truncated PNG chunk header`);
    }
    const dataLength = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) {
      throw new Error(`${label} has an invalid PNG chunk type at offset ${offset}`);
    }
    const chunkEnd = offset + 12 + dataLength;
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > buffer.length) {
      throw new Error(`${label} has a truncated ${type} PNG chunk`);
    }
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || dataLength !== 13) {
        throw new Error(`${label} must begin with a 13-byte IHDR chunk`);
      }
      const width = buffer.readUInt32BE(offset + 8);
      const height = buffer.readUInt32BE(offset + 12);
      if (width === 0 || height === 0) {
        throw new Error(`${label} has invalid PNG dimensions`);
      }
      sawHeader = true;
    }
    if (type === 'IDAT') sawImageData = true;
    if (type === 'IEND') {
      if (dataLength !== 0) throw new Error(`${label} has a non-empty IEND chunk`);
      sawEnd = true;
      offset = chunkEnd;
      if (offset !== buffer.length) throw new Error(`${label} has trailing data after IEND`);
      break;
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (!sawHeader || !sawImageData || !sawEnd) {
    throw new Error(`${label} is missing required IHDR, IDAT, or IEND PNG chunks`);
  }
  return buffer;
}

export function validateMd2SurfacePngs(surfacesValue) {
  const surfaces = asRecord(surfacesValue, 'MD2 evidence surfaces');
  return Object.fromEntries(MD2_EVIDENCE_SURFACES.map((surface) => [
    surface,
    decodePngDataUrl(surfaces[surface], surface),
  ]));
}

export function prepareMd2RecordSurfacePngs(resultValue) {
  const result = asRecord(resultValue, 'MD2 evidence result');
  if (result.success !== true) {
    throw new Error(`${result.error ?? 'MD2 evidence failed'}; refusing to write artifacts`);
  }
  const data = asRecord(result.data, 'MD2 evidence data');
  return validateMd2SurfacePngs(data.surfaces);
}

export function shouldWriteMd2EvidenceArtifacts(mode) {
  return mode === 'record';
}

async function loadBaselines(directory) {
  return Object.fromEntries(await Promise.all(MD2_EVIDENCE_SURFACES.map(async (surface) => {
    const dataUrl = pngDataUrl(await fs.readFile(path.join(directory, `${surface}.png`)));
    decodePngDataUrl(dataUrl, `${surface} baseline`);
    return [surface, dataUrl];
  })));
}

async function writeSurfacePngs(directory, decodedSurfaces) {
  await fs.mkdir(directory, { recursive: true });
  const nonce = `${process.pid}-${Date.now()}`;
  const staged = [];
  try {
    for (const surface of MD2_EVIDENCE_SURFACES) {
      const temporaryPath = path.join(directory, `.${surface}.${nonce}.tmp`);
      await fs.writeFile(temporaryPath, decodedSurfaces[surface]);
      staged.push({ temporaryPath, finalPath: path.join(directory, `${surface}.png`) });
    }
    for (const { temporaryPath, finalPath } of staged) {
      await fs.rm(finalPath, { force: true });
      await fs.rename(temporaryPath, finalPath);
    }
  } finally {
    await Promise.all(staged.map(({ temporaryPath }) => fs.rm(temporaryPath, { force: true })));
  }
}

export function createMd2DebugActionRequest(session, sessionUrl, baselines) {
  const targetTabId = typeof session?.sessionId === 'string' ? session.sessionId.trim() : '';
  if (!targetTabId) throw new Error('Cannot create MD2 request without an explicit session id');
  return {
    action: 'run-motion-design-md2-evidence',
    targetTabId,
    sessionId: targetTabId,
    timeoutMs: 120_000,
    args: {
      expectedSessionUrl: sessionUrl.href,
      confirmDisposableSession: true,
      baselines,
    },
  };
}

function compactEvidenceData(data) {
  return {
    ...data,
    surfaces: Object.fromEntries(MD2_EVIDENCE_SURFACES.map((surface) => [
      surface,
      typeof data.surfaces?.[surface] === 'string'
        ? `[PNG data URL omitted: ${data.surfaces[surface].length} chars]`
        : null,
    ])),
  };
}

async function run(options) {
  const { base, baselineDir, output, sessionUrl } = validateMd2DisposableSession(options);
  const token = await readBridgeToken();
  const session = await resolveExactSession(base, sessionUrl, token);
  const baselines = options.mode === 'verify' ? await loadBaselines(baselineDir) : {};
  const result = asRecord(await fetchJson(
    new URL('/api/debug/action', base),
    token,
    {
      method: 'POST',
      body: JSON.stringify(createMd2DebugActionRequest(session, sessionUrl, baselines)),
    },
    130_000,
  ), 'MD2 evidence result');

  const decodedSurfaces = options.mode === 'record'
    ? prepareMd2RecordSurfacePngs(result)
    : (() => {
        if (result.success !== true) throw new Error(result.error ?? 'MD2 evidence failed');
        const data = asRecord(result.data, 'MD2 evidence data');
        return validateMd2SurfacePngs(data.surfaces);
      })();
  const data = asRecord(result.data, 'MD2 evidence data');

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gate: 'MD2_AUTHORING_AND_ANIMATION_COMPLETE',
    mode: options.mode,
    disposableSession: {
      url: sessionUrl.href,
      sessionId: session.sessionId,
      exactUrlMatch: true,
      focusedSessionFallbackAllowed: false,
      explicitTargeting: true,
      blankTimelineBeforeMutation: true,
      chatFreeBeforeMutation: true,
      savedProjectBeforeRun: false,
    },
    baselineDir,
    requiredSurfaces: [...MD2_EVIDENCE_SURFACES],
    result: { ...result, data: compactEvidenceData(data) },
  };

  let reportPath = null;
  if (shouldWriteMd2EvidenceArtifacts(options.mode)) {
    await writeSurfacePngs(baselineDir, decodedSurfaces);
    await fs.mkdir(output, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
    reportPath = path.join(output, `${stamp}-record.report.json`);
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  process.stdout.write(`MD2 evidence: passed\n`);
  if (reportPath) {
    process.stdout.write(`Report: ${path.relative(repoRoot, reportPath)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseMd2EvidenceArgs(argv);
  if (options.help) {
    process.stdout.write(usage());
    return;
  }
  await run(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
