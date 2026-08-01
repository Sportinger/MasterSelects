import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The production evidence runner is plain ESM so it can run without a build step.
// These exports form its unit-testable fail-closed boundary.
// @ts-expect-error JavaScript CLI module has no declaration file.
import {
  MD2_EVIDENCE_SURFACES,
  createMd2DebugActionRequest,
  parseMd2EvidenceArgs,
  prepareMd2RecordSurfacePngs,
  selectExactMd2EvidenceSession,
  shouldWriteMd2EvidenceArtifacts,
  validateMd2DisposableSession,
  validateMd2SurfacePngs,
} from '../../scripts/run-motion-design-md2-evidence.mjs';

const disposableUrl = new URL(
  'http://motion-md2.localhost:5173/?motionDesignEvidenceSession=unit-test',
);
const baselineDir = path.resolve('docs/evidence/motion-design/md2/baselines');
const output = path.resolve('docs/evidence/motion-design/md2');

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'md2-target-tab',
    url: disposableUrl.href,
    projectId: null,
    projectName: 'Untitled Project',
    projectFileOpen: false,
    chatMessageCount: 0,
    chatToolCallCount: 0,
    timelineClipCount: 0,
    ...overrides,
  };
}

function pngChunk(type: string, data = Buffer.alloc(0)) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function structurallyValidPngDataUrl() {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', Buffer.from([0])),
    pngChunk('IEND'),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function validSurfaceManifest(dataUrl = structurallyValidPngDataUrl()) {
  return Object.fromEntries(MD2_EVIDENCE_SURFACES.map((surface: string) => [surface, dataUrl]));
}

describe('MD2 evidence runner manifest', () => {
  it('requires every preview, export, graph, and viewport surface exactly once', () => {
    expect([...MD2_EVIDENCE_SURFACES]).toEqual([
      'direct-preview',
      'direct-export',
      'nested-preview',
      'nested-export',
      'global-graph',
      'motion-path-overlay',
    ]);
    expect(new Set(MD2_EVIDENCE_SURFACES).size).toBe(6);
  });

  it('parses explicit record/verify inputs without inventing a target', () => {
    const parsed = parseMd2EvidenceArgs([
      '--session-url', disposableUrl.href,
      '--mode', 'verify',
      '--baseline-dir', 'docs/evidence/motion-design/md2/baselines',
    ]);
    expect(parsed).toMatchObject({
      baseUrl: 'http://localhost:5173/',
      sessionUrl: disposableUrl.href,
      mode: 'verify',
      baselineDir,
    });
  });
});

describe('MD2 evidence runner isolation', () => {
  it('rejects a non-loopback bridge before filesystem or session work', () => {
    expect(() => validateMd2DisposableSession({
      baseUrl: 'https://example.com/',
      sessionUrl: disposableUrl.href,
      baselineDir: 'unused',
      output,
      mode: 'verify',
    })).toThrow(/base-url must be loopback-only/);

    expect(() => validateMd2DisposableSession({
      baseUrl: 'http://192.168.1.8:5173/',
      sessionUrl: disposableUrl.href,
      baselineDir,
      output,
      mode: 'verify',
    })).toThrow(/base-url must be loopback-only/);
  });

  it('requires an exact dedicated marked localhost session on the bridge port', () => {
    const valid = {
      baseUrl: 'http://localhost:5173/',
      sessionUrl: disposableUrl.href,
      baselineDir,
      output,
      mode: 'verify',
    };
    expect(validateMd2DisposableSession(valid).sessionUrl.href).toBe(disposableUrl.href);
    expect(() => validateMd2DisposableSession({ ...valid, sessionUrl: null }))
      .toThrow(/focused\/live localhost fallback is forbidden/);
    expect(() => validateMd2DisposableSession({
      ...valid,
      sessionUrl: 'http://localhost:5173/?motionDesignEvidenceSession=x',
    })).toThrow(/dedicated \*\.localhost/);
    expect(() => validateMd2DisposableSession({
      ...valid,
      sessionUrl: 'http://motion-md2.localhost:5173/',
    })).toThrow(/motionDesignEvidenceSession/);
    expect(() => validateMd2DisposableSession({
      ...valid,
      sessionUrl: 'http://motion-md2.localhost:5174/?motionDesignEvidenceSession=x',
    })).toThrow(/same protocol and port/);
  });

  it('keeps baseline and report directories inside the repository', () => {
    const valid = {
      baseUrl: 'http://localhost:5173/',
      sessionUrl: disposableUrl.href,
      baselineDir,
      output,
      mode: 'record',
    };
    expect(() => validateMd2DisposableSession({
      ...valid,
      baselineDir: path.resolve('..', 'outside-md2-baselines'),
    })).toThrow(/baseline-dir must be a dedicated directory inside this repository/);
    expect(() => validateMd2DisposableSession({
      ...valid,
      output: path.resolve('..', 'outside-md2-reports'),
    })).toThrow(/output must be a dedicated directory inside this repository/);
  });

  it('selects one exact blank chat-free target among unrelated sessions', () => {
    const sessions = [
      session(),
      {
        sessionId: 'user-tab',
        url: 'http://localhost:5173/',
        projectId: 'user-project',
        projectName: 'User project',
        chatMessageCount: 4,
        chatToolCallCount: 2,
        projectFileOpen: true,
        timelineClipCount: 12,
      },
    ];
    const selected = selectExactMd2EvidenceSession(sessions, disposableUrl.href);
    expect(selected.sessionId).toBe('md2-target-tab');
    expect(createMd2DebugActionRequest(selected, disposableUrl, {})).toEqual({
      action: 'run-motion-design-md2-evidence',
      targetTabId: 'md2-target-tab',
      sessionId: 'md2-target-tab',
      timeoutMs: 120_000,
      args: {
        expectedSessionUrl: disposableUrl.href,
        confirmDisposableSession: true,
        baselines: {},
      },
    });
  });

  it('rejects duplicate exact URLs, shared origins, and id collisions', () => {
    expect(() => selectExactMd2EvidenceSession([
      session(),
      session({ sessionId: 'second-exact' }),
    ], disposableUrl.href)).toThrow(/found 2/);

    expect(() => selectExactMd2EvidenceSession([
      session(),
      session({
        sessionId: 'same-origin-peer',
        url: 'http://motion-md2.localhost:5173/other?motionDesignEvidenceSession=other',
      }),
    ], disposableUrl.href)).toThrow(/origin is shared/);

    expect(() => selectExactMd2EvidenceSession([
      session(),
      {
        ...session({ sessionId: 'other-a', url: 'http://a.localhost:5173/' }),
        projectId: 'collision',
      },
      {
        ...session({ sessionId: 'other-b', url: 'http://b.localhost:5173/' }),
        projectId: 'collision',
      },
    ], disposableUrl.href)).toThrow(/projectId collision/);

    expect(() => selectExactMd2EvidenceSession([
      session(),
      session({ url: 'http://other.localhost:5173/' }),
    ], disposableUrl.href)).toThrow(/sessionId collision/);
  });

  it('rejects saved/open projects, chat activity, and nonblank timelines', () => {
    expect(() => selectExactMd2EvidenceSession([
      session({ projectId: 'saved-project', projectName: 'Saved' }),
    ], disposableUrl.href)).toThrow(/projectId=null/);
    expect(() => selectExactMd2EvidenceSession([
      session({ projectName: 'Unsaved user work' }),
    ], disposableUrl.href)).toThrow(/no open project/);
    expect(() => selectExactMd2EvidenceSession([
      session({ projectFileOpen: true }),
    ], disposableUrl.href)).toThrow(/ProjectFileService must be closed/);
    expect(() => selectExactMd2EvidenceSession([
      session({ chatMessageCount: 1 }),
    ], disposableUrl.href)).toThrow(/no chat activity/);
    expect(() => selectExactMd2EvidenceSession([
      session({ chatToolCallCount: undefined }),
    ], disposableUrl.href)).toThrow(/no chat activity/);
    expect(() => selectExactMd2EvidenceSession([
      session({ timelineClipCount: 1 }),
    ], disposableUrl.href)).toThrow(/blank timeline/);
  });
});

describe('MD2 evidence artifact gate', () => {
  it('accepts all six structurally valid PNG surfaces only after action success', () => {
    const surfaces = validSurfaceManifest();
    expect(Object.keys(validateMd2SurfacePngs(surfaces))).toEqual([...MD2_EVIDENCE_SURFACES]);
    expect(Object.keys(prepareMd2RecordSurfacePngs({ success: true, data: { surfaces } })))
      .toHaveLength(6);

    expect(() => prepareMd2RecordSurfacePngs({ success: false, error: 'capture failed' }))
      .toThrow(/refusing to write artifacts/);
    expect(() => prepareMd2RecordSurfacePngs({
      success: true,
      data: { surfaces: { 'direct-preview': structurallyValidPngDataUrl() } },
    })).toThrow(/base64 PNG|valid PNG signature/);
  });

  it('rejects malformed, truncated, and trailing PNG payloads', () => {
    const valid = structurallyValidPngDataUrl();
    const raw = Buffer.from(valid.slice('data:image/png;base64,'.length), 'base64');

    expect(() => validateMd2SurfacePngs(validSurfaceManifest('data:image/png;base64,%%%=')))
      .toThrow(/invalid base64/);
    expect(() => validateMd2SurfacePngs(validSurfaceManifest(
      `data:image/png;base64,${raw.subarray(0, -3).toString('base64')}`,
    ))).toThrow(/truncated|missing required|IEND/);
    expect(() => validateMd2SurfacePngs(validSurfaceManifest(
      `data:image/png;base64,${Buffer.concat([raw, Buffer.from([1])]).toString('base64')}`,
    ))).toThrow(/trailing data/);
  });

  it('keeps verify mode write-free', () => {
    expect(shouldWriteMd2EvidenceArtifacts('record')).toBe(true);
    expect(shouldWriteMd2EvidenceArtifacts('verify')).toBe(false);
    expect(shouldWriteMd2EvidenceArtifacts(undefined)).toBe(false);
  });
});
