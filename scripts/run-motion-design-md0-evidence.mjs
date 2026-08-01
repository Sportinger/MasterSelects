#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const DEFAULT_BASE_URL = 'http://localhost:5173/';
const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'docs', 'evidence', 'motion-design', 'md0');
const EVIDENCE_TOOL = 'runMotionDesignMd0Evidence';

function usage() {
  return `Usage:
  node scripts/run-motion-design-md0-evidence.mjs \\
    --session-url http://motion-md0-a1b2c3d4.localhost:5173/ \\
    [--base-url http://localhost:5173/] \\
    [--output docs/evidence/motion-design/md0]

Safety rules:
  - --base-url is restricted to plain localhost or a numeric loopback address.
  - --session-url is mandatory and must use a run-specific motion-md0-<nonce>.localhost host.
  - The exact URL must identify exactly one live bridge session.
  - The target must have no saved project, chat activity, or same-origin peer tab.
  - Every call targets that session id explicitly. There is no focused-tab fallback.
  - Plain localhost, loopback-IP, and same-origin session URLs are rejected.
`;
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    output: DEFAULT_OUTPUT_DIR,
    sessionUrl: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (arg === '--base-url' || arg === '--output' || arg === '--session-url') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      if (arg === '--base-url') options.baseUrl = value;
      if (arg === '--output') options.output = path.resolve(repoRoot, value);
      if (arg === '--session-url') options.sessionUrl = value;
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
    throw new Error(`${label} must not contain URL credentials`);
  }
  return url;
}

function isIpv4Loopback(hostname) {
  const octets = hostname.split('.');
  return octets.length === 4
    && octets[0] === '127'
    && octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255);
}

export function validateBridgeBaseUrl(baseUrl) {
  const base = normalizeHttpUrl(baseUrl, '--base-url');
  const hostname = base.hostname.toLowerCase();
  if (
    hostname !== 'localhost'
    && hostname !== '::1'
    && hostname !== '[::1]'
    && !isIpv4Loopback(hostname)
  ) {
    throw new Error('--base-url must be plain localhost or a numeric loopback address; remote bridge hosts are forbidden');
  }
  if (base.pathname !== '/' || base.search || base.hash) {
    throw new Error('--base-url must be an origin only, without path, query, or hash');
  }
  return base;
}

export function validateDisposableSessionUrl(baseUrl, sessionUrlValue) {
  const base = validateBridgeBaseUrl(baseUrl);
  if (!sessionUrlValue) {
    throw new Error('--session-url is required; focused-session fallback is forbidden');
  }
  const sessionUrl = normalizeHttpUrl(sessionUrlValue, '--session-url');
  const hostname = sessionUrl.hostname.toLowerCase();
  if (!/^motion-md0-[a-z0-9]{8,64}\.localhost$/.test(hostname)) {
    throw new Error('--session-url must use a run-specific host such as motion-md0-a1b2c3d4.localhost');
  }
  if (sessionUrl.protocol !== base.protocol || sessionUrl.port !== base.port) {
    throw new Error('--session-url must use the same protocol and port as the local bridge base');
  }
  return { base, sessionUrl };
}

async function readBridgeToken() {
  const tokenPath = path.join(repoRoot, '.ai-bridge-token');
  const token = (await fs.readFile(tokenPath, 'utf8')).trim();
  if (!token) throw new Error(`Bridge token file is empty: ${tokenPath}`);
  return token;
}

async function fetchJson(url, token, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`${response.status} ${response.statusText}: expected JSON, received ${text.slice(0, 200)}`);
  }
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${payload.error ?? text}`);
  }
  return payload;
}

function asRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value;
}

function normalizeComparableUrl(value) {
  const url = normalizeHttpUrl(value, 'bridge session URL');
  return url.href;
}

export function selectExactDisposableSession(sessionsValue, sessionUrl) {
  const sessions = Array.isArray(sessionsValue) ? sessionsValue : [];
  const expected = sessionUrl.href;
  const matches = sessions.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
    if (typeof candidate.url !== 'string') return false;
    try {
      return normalizeComparableUrl(candidate.url) === expected;
    } catch {
      return false;
    }
  });
  if (matches.length !== 1) {
    const urls = sessions
      .map((candidate) => candidate && typeof candidate === 'object' ? candidate.url : null)
      .filter((value) => typeof value === 'string');
    throw new Error(
      `Expected exactly one live bridge session for ${expected}; found ${matches.length}. Live URLs: ${urls.join(', ') || '(none)'}`,
    );
  }
  const session = asRecord(matches[0], 'matched session');
  if (typeof session.sessionId !== 'string' || !session.sessionId) {
    throw new Error('Matched disposable session has no sessionId');
  }
  if (session.projectId !== null) {
    throw new Error(`Disposable session already has a saved project: ${String(session.projectId)}`);
  }
  if (session.projectName !== 'Untitled Project') {
    throw new Error(`Disposable session has an unexpected project name: ${String(session.projectName)}`);
  }
  if (session.projectFileOpen !== false) {
    throw new Error('Disposable session ProjectFileService must be closed');
  }
  if (session.timelineClipCount !== 0) {
    throw new Error('Disposable session timeline must contain zero clips');
  }
  if (session.chatMessageCount !== 0 || session.chatToolCallCount !== 0) {
    throw new Error('Disposable session already contains chat activity');
  }
  const sameOriginPeers = sessions.filter((candidate) => {
    if (!candidate || typeof candidate !== 'object' || candidate === session) return false;
    if (typeof candidate.url !== 'string') return false;
    try {
      return normalizeHttpUrl(candidate.url, 'bridge session URL').origin === sessionUrl.origin;
    } catch {
      return false;
    }
  });
  if (sameOriginPeers.length > 0) {
    throw new Error('Disposable session origin is shared by another live tab');
  }
  const duplicateSessionIds = sessions.filter((candidate) => (
    candidate
    && typeof candidate === 'object'
    && candidate.sessionId === session.sessionId
  ));
  if (duplicateSessionIds.length !== 1) {
    throw new Error('Disposable session id is not unique among live sessions');
  }
  return session;
}

async function resolveExactSession(base, sessionUrl, token) {
  const endpoint = new URL('/api/agent-control/sessions', base);
  const response = asRecord(await fetchJson(endpoint, token), 'session response');
  const data = asRecord(response.data, 'session response data');
  return selectExactDisposableSession(data.sessions, sessionUrl);
}

function unwrapAgentControlResult(envelope, tool, expectedSessionId, allowToolFailure = false) {
  const outer = asRecord(envelope, `${tool} agent-control response`);
  const result = asRecord(outer.data, `${tool} tool result`);
  if (outer.sessionId !== expectedSessionId) {
    throw new Error(`${tool} responded from an unexpected bridge session`);
  }
  if (!allowToolFailure && (outer.success === false || result.success === false)) {
    throw new Error(`${tool} failed: ${result.error ?? outer.error ?? 'unknown error'}`);
  }
  return {
    callId: typeof outer.callId === 'string' ? outer.callId : null,
    result,
    sessionId: typeof outer.sessionId === 'string' ? outer.sessionId : null,
    transport: 'agent-control',
  };
}

async function callDefinedTool({
  base,
  token,
  sessionId,
  tool,
  args = {},
  timeoutMs = 120_000,
  allowToolFailure = false,
}) {
  const endpoint = new URL('/api/agent-control/call', base);
  const response = await fetchJson(endpoint, token, {
    method: 'POST',
    body: JSON.stringify({
      tool,
      args,
      sessionId,
      surface: 'devBridge',
      confirm: true,
      timeoutMs,
    }),
  });
  return unwrapAgentControlResult(response, tool, sessionId, allowToolFailure);
}

async function callHiddenEvidenceTool({ base, token, sessionId, args, timeoutMs = 180_000 }) {
  const endpoint = new URL('/api/ai-tools', base);
  const result = asRecord(await fetchJson(endpoint, token, {
    method: 'POST',
    body: JSON.stringify({
      tool: EVIDENCE_TOOL,
      args,
      targetTabId: sessionId,
      timeoutMs,
    }),
  }), `${EVIDENCE_TOOL} response`);
  if (result.success === false) {
    throw new Error(`${EVIDENCE_TOOL} failed: ${result.error ?? 'unknown error'}`);
  }
  return {
    callId: null,
    result,
    sessionId,
    transport: 'targeted-direct',
  };
}

function resultData(call, label) {
  return asRecord(call.result.data, `${label} result data`);
}

function findClipTrackId(timelineData, clipId) {
  for (const trackGroup of ['videoTracks', 'audioTracks']) {
    const tracks = Array.isArray(timelineData[trackGroup]) ? timelineData[trackGroup] : [];
    for (const trackValue of tracks) {
      const track = asRecord(trackValue, `${trackGroup} entry`);
      const clips = Array.isArray(track.clips) ? track.clips : [];
      const clip = clips.find((candidate) => (
        candidate && typeof candidate === 'object' && candidate.id === clipId
      ));
      if (clip) return typeof track.id === 'string' ? track.id : null;
    }
  }
  return null;
}

function extractBatchClipId(batchData, actionIndex, label) {
  const results = Array.isArray(batchData.results) ? batchData.results : [];
  const action = asRecord(results[actionIndex], `${label} action ${actionIndex}`);
  const data = asRecord(action.data, `${label} action ${actionIndex} data`);
  if (typeof data.clipId !== 'string' || !data.clipId) {
    throw new Error(`${label} action ${actionIndex} did not return clipId`);
  }
  return data.clipId;
}

function extractBatchString(batchData, actionIndex, field, label) {
  const results = Array.isArray(batchData.results) ? batchData.results : [];
  const action = asRecord(results[actionIndex], `${label} action ${actionIndex}`);
  const data = asRecord(action.data, `${label} action ${actionIndex} data`);
  if (typeof data[field] !== 'string' || !data[field]) {
    throw new Error(`${label} action ${actionIndex} did not return ${field}`);
  }
  return data[field];
}

function batchReference(action, pathValue) {
  return { $batchResult: { action, path: pathValue } };
}

function buildLowerThirdBatch(baseTrackId) {
  return [
    { tool: 'createTrack', args: { type: 'video' } },
    {
      tool: 'createMotionShapeClip',
      args: {
        trackId: baseTrackId,
        startTime: 0,
        duration: 6,
        name: 'MD0 Evidence - Lower Third Plate',
        primitive: 'rectangle',
        width: 900,
        height: 180,
        cornerRadius: 36,
        fill: { color: '#162040', opacity: 0.92 },
        stroke: { enabled: true, color: '#ffffff', opacity: 0.9, width: 4, alignment: 'inside' },
      },
    },
    {
      tool: 'createTextClip',
      args: {
        trackId: batchReference(0, 'trackId'),
        startTime: 0,
        duration: 6,
        text: 'MOTION DESIGN',
        fontFamily: 'Arial',
        fontSize: 64,
        fontWeight: 700,
        color: '#ffffff',
        textAlign: 'center',
        verticalAlign: 'middle',
      },
    },
    { tool: 'setTransform', args: { clipId: batchReference(1, 'clipId'), x: 0, y: 260 } },
    { tool: 'setTransform', args: { clipId: batchReference(2, 'clipId'), x: 0, y: 260 } },
    { tool: 'addKeyframe', args: { clipId: batchReference(1, 'clipId'), property: 'opacity', value: 0, time: 0, easing: 'ease-out' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(1, 'clipId'), property: 'opacity', value: 1, time: 0.5, easing: 'ease-out' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(2, 'clipId'), property: 'opacity', value: 0, time: 0, easing: 'ease-out' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(2, 'clipId'), property: 'opacity', value: 1, time: 0.65, easing: 'ease-out' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(1, 'clipId'), property: 'opacity', value: 1, time: 5.25, easing: 'ease-in' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(1, 'clipId'), property: 'opacity', value: 0, time: 6, easing: 'ease-in' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(2, 'clipId'), property: 'opacity', value: 1, time: 5.15, easing: 'ease-in' } },
    { tool: 'addKeyframe', args: { clipId: batchReference(2, 'clipId'), property: 'opacity', value: 0, time: 6, easing: 'ease-in' } },
  ];
}

function canonicalTimelineState(value) {
  const cloned = structuredClone(value);
  if (cloned?.occupancy && typeof cloned.occupancy === 'object') {
    delete cloned.occupancy.stateRevision;
  }
  return cloned;
}

function assertSameTimelineState(actual, expected, label) {
  const canonicalActual = canonicalTimelineState(actual);
  const canonicalExpected = canonicalTimelineState(expected);
  const actualJson = JSON.stringify(canonicalActual);
  const expectedJson = JSON.stringify(canonicalExpected);
  if (actualJson !== expectedJson) {
    const keys = [...new Set([
      ...Object.keys(canonicalExpected ?? {}),
      ...Object.keys(canonicalActual ?? {}),
    ])];
    const mismatches = keys.filter((key) => (
      JSON.stringify(canonicalActual?.[key]) !== JSON.stringify(canonicalExpected?.[key])
    )).map((key) => {
      const expectedValue = JSON.stringify(canonicalExpected?.[key]);
      const actualValue = JSON.stringify(canonicalActual?.[key]);
      return `${key}: expected ${expectedValue?.slice(0, 240)}, actual ${actualValue?.slice(0, 240)}`;
    });
    throw new Error(
      `${label} did not restore the complete observable timeline state (${mismatches.join('; ')})`,
    );
  }
}

function assertExactOpacityKeyframes(keyframeData, expected, label) {
  const keyframes = Array.isArray(keyframeData.keyframes) ? keyframeData.keyframes : [];
  const actual = keyframes.map((keyframe) => ({
    id: keyframe.id,
    property: keyframe.property,
    time: keyframe.time,
    value: keyframe.value,
  }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} keyframes were not restored with stable ids, values, and timing`);
  }
}

function decodePngDataUrl(dataUrl, label) {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!match) throw new Error(`${label} is not a base64 PNG data URL`);
  return Buffer.from(match[1], 'base64');
}

function removeCaptureDataUrls(value) {
  if (Array.isArray(value)) return value.map(removeCaptureDataUrls);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    key === 'dataUrl' && typeof entry === 'string'
      ? '<stored-as-png>'
      : removeCaptureDataUrls(entry),
  ]));
}

async function writeEvidence(outputDir, report, directDataUrl, nestedDataUrl) {
  await fs.mkdir(outputDir, { recursive: true });
  const directPath = path.join(outputDir, 'lower-third-direct-t1.png');
  const nestedPath = path.join(outputDir, 'lower-third-nested-t1.png');
  const reportPath = path.join(outputDir, 'report.json');
  await Promise.all([
    fs.writeFile(directPath, decodePngDataUrl(directDataUrl, 'direct capture')),
    fs.writeFile(nestedPath, decodePngDataUrl(nestedDataUrl, 'nested capture')),
    fs.writeFile(reportPath, `${JSON.stringify(removeCaptureDataUrls(report), null, 2)}\n`, 'utf8'),
  ]);
  return { directPath, nestedPath, reportPath };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { base, sessionUrl } = validateDisposableSessionUrl(options.baseUrl, options.sessionUrl);
  const token = await readBridgeToken();
  const session = await resolveExactSession(base, sessionUrl, token);
  const sessionId = session.sessionId;
  const calls = [];
  const call = async (tool, args = {}, timeoutMs, allowToolFailure = false) => {
    const response = await callDefinedTool({
      base,
      token,
      sessionId,
      tool,
      args,
      timeoutMs,
      allowToolFailure,
    });
    calls.push({ tool, args, callId: response.callId, transport: response.transport });
    return response;
  };

  // Read-only proof of a blank, disposable target before the first mutation.
  const preflightTimelineCall = await call('getTimelineState');
  const preflightTimeline = resultData(preflightTimelineCall, 'preflight getTimelineState');
  if (preflightTimeline.totalClips !== 0) {
    throw new Error('Disposable session is not blank: timeline already contains clips');
  }

  const fixtureName = `MD0 Disposable Lower Third ${new Date().toISOString()}`;
  const compositionCall = await call('createComposition', {
    name: fixtureName,
    width: 1280,
    height: 720,
    frameRate: 30,
    duration: 6,
    openAfterCreate: true,
  });
  const compositionData = resultData(compositionCall, 'createComposition');
  const compositionId = compositionData.compositionId;
  if (typeof compositionId !== 'string' || !compositionId) {
    throw new Error('createComposition did not return compositionId');
  }

  const initialTimelineCall = await call('getTimelineState');
  const initialTimeline = resultData(initialTimelineCall, 'initial getTimelineState');
  if (initialTimeline.duration !== 6) {
    throw new Error(`Explicit 6s composition opened with timeline duration ${String(initialTimeline.duration)}s`);
  }
  const videoTracks = Array.isArray(initialTimeline.videoTracks) ? initialTimeline.videoTracks : [];
  const baseTrack = videoTracks.at(-1);
  const baseTrackId = baseTrack && typeof baseTrack === 'object' && typeof baseTrack.id === 'string'
    ? baseTrack.id
    : null;
  if (!baseTrackId) throw new Error('Disposable composition has no base video track');

  const actions = buildLowerThirdBatch(baseTrackId);
  const batchCall = await call('executeBatch', { actions, staggerDelayMs: 0 });
  const batchData = resultData(batchCall, 'executeBatch');
  const createdTrackId = extractBatchString(batchData, 0, 'trackId', 'executeBatch');
  const plateClipId = extractBatchClipId(batchData, 1, 'executeBatch');
  const textClipId = extractBatchClipId(batchData, 2, 'executeBatch');
  const expectedPlateKeyframes = [5, 6, 9, 10].map((actionIndex) => ({
    id: extractBatchString(batchData, actionIndex, 'keyframeId', 'executeBatch'),
    property: 'opacity',
    time: actions[actionIndex].args.time,
    value: actions[actionIndex].args.value,
  }));
  const expectedTextKeyframes = [7, 8, 11, 12].map((actionIndex) => ({
    id: extractBatchString(batchData, actionIndex, 'keyframeId', 'executeBatch'),
    property: 'opacity',
    time: actions[actionIndex].args.time,
    value: actions[actionIndex].args.value,
  }));

  const constructedTimelineCall = await call('getTimelineState');
  const constructedTimeline = resultData(constructedTimelineCall, 'constructed getTimelineState');
  if (constructedTimeline.duration !== 6) {
    throw new Error(`Lower-third batch changed the locked composition duration to ${String(constructedTimeline.duration)}s`);
  }
  const plateTrackId = findClipTrackId(constructedTimeline, plateClipId);
  const textTrackId = findClipTrackId(constructedTimeline, textClipId);
  if (
    !plateTrackId
    || !textTrackId
    || plateTrackId === textTrackId
    || textTrackId !== createdTrackId
  ) {
    throw new Error('Disposable lower third did not resolve to two distinct visible video tracks');
  }

  const undoCall = await call('undo');
  const afterUndoCall = await call('getTimelineState');
  const afterUndo = resultData(afterUndoCall, 'post-undo getTimelineState');
  const afterUndoTracks = [
    ...(Array.isArray(afterUndo.videoTracks) ? afterUndo.videoTracks : []),
    ...(Array.isArray(afterUndo.audioTracks) ? afterUndo.audioTracks : []),
  ];
  if (
    findClipTrackId(afterUndo, plateClipId)
    || findClipTrackId(afterUndo, textClipId)
    || afterUndoTracks.some((track) => track && typeof track === 'object' && track.id === createdTrackId)
  ) {
    throw new Error('One-step undo did not remove the complete lower-third batch');
  }
  assertSameTimelineState(afterUndo, initialTimeline, 'One-step undo');
  const plateKeyframesAfterUndo = await call('getKeyframes', { clipId: plateClipId }, undefined, true);
  const textKeyframesAfterUndo = await call('getKeyframes', { clipId: textClipId }, undefined, true);
  if (plateKeyframesAfterUndo.result.success !== false || textKeyframesAfterUndo.result.success !== false) {
    throw new Error('One-step undo left lower-third keyframes addressable');
  }

  const redoCall = await call('redo');
  const afterRedoCall = await call('getTimelineState');
  const afterRedo = resultData(afterRedoCall, 'post-redo getTimelineState');
  assertSameTimelineState(afterRedo, constructedTimeline, 'One-step redo');
  if (
    findClipTrackId(afterRedo, plateClipId) !== plateTrackId
    || findClipTrackId(afterRedo, textClipId) !== createdTrackId
  ) {
    throw new Error('One-step redo did not restore track and clip identities');
  }
  const plateKeyframesCall = await call('getKeyframes', { clipId: plateClipId });
  const textKeyframesCall = await call('getKeyframes', { clipId: textClipId });
  const plateKeyframes = resultData(plateKeyframesCall, 'plate getKeyframes');
  const textKeyframes = resultData(textKeyframesCall, 'text getKeyframes');
  assertExactOpacityKeyframes(plateKeyframes, expectedPlateKeyframes, 'Plate');
  assertExactOpacityKeyframes(textKeyframes, expectedTextKeyframes, 'Text');
  const plateDetails = resultData(
    await call('getClipDetails', { clipId: plateClipId }),
    'plate getClipDetails',
  );
  const textDetails = resultData(
    await call('getClipDetails', { clipId: textClipId }),
    'text getClipDetails',
  );
  if (plateDetails.transform?.position?.y !== 260 || textDetails.transform?.position?.y !== 260) {
    throw new Error('One-step redo did not restore lower-third transforms');
  }

  const evidenceCall = await callHiddenEvidenceTool({
    base,
    token,
    sessionId,
    args: {
      plateClipId,
      textClipId,
      sampleTimeSeconds: 1,
      captureMode: 'auto',
      // MD0 verifies native composition parity. Cross-resolution composition-
      // pixel scaling is a separate export-integration concern.
      width: 1280,
      height: 720,
      fps: 8,
      // Keep enough spatial samples to resolve fully covered glyph pixels.
      // The old 48x27 grid could miss them and turn color-range parity into
      // a sampling-alignment check rather than a renderer check.
      sampleWidth: 64,
      sampleHeight: 36,
    },
  });
  calls.push({
    tool: EVIDENCE_TOOL,
    args: { plateClipId, textClipId, sampleTimeSeconds: 1 },
    callId: evidenceCall.callId,
    transport: evidenceCall.transport,
  });
  const evidence = resultData(evidenceCall, EVIDENCE_TOOL);
  const direct = asRecord(evidence.direct, 'direct evidence');
  const nested = asRecord(evidence.nested, 'nested evidence');
  if (typeof direct.dataUrl !== 'string' || typeof nested.dataUrl !== 'string') {
    throw new Error('MD0 evidence helper did not return direct and nested PNG captures');
  }

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    gate: 'MD0_EXISTING_MVP_COMPLETE',
    disposableSession: {
      url: sessionUrl.href,
      sessionId,
      exactUrlMatch: true,
      uniqueOriginAmongLiveSessions: true,
      blankTimelineBeforeMutation: true,
      savedProjectBeforeRun: false,
      focusedSessionFallbackAllowed: false,
      projectId: session.projectId ?? null,
      projectNameBeforeRun: session.projectName ?? null,
    },
    composition: {
      id: compositionId,
      name: fixtureName,
      width: 1280,
      height: 720,
      frameRate: 30,
      durationSeconds: 6,
    },
    toolSequence: calls,
    lowerThirdBatch: {
      actions,
      result: batchCall.result,
      plateClipId,
      textClipId,
      createdTrackId,
      expectedPlateKeyframes,
      expectedTextKeyframes,
      plateTrackId,
      textTrackId,
    },
    undoRedo: {
      undo: undoCall.result,
      afterUndo,
      redo: redoCall.result,
      afterRedo,
      plateKeyframes,
      textKeyframes,
      plateDetails,
      textDetails,
    },
    evidence,
  };
  const paths = await writeEvidence(options.output, report, direct.dataUrl, nested.dataUrl);
  process.stdout.write(`${JSON.stringify({ success: true, ...paths }, null, 2)}\n`);
}

const invokedAsScript = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
