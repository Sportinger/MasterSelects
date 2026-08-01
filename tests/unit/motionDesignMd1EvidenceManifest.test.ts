import { describe, expect, it } from 'vitest';
import {
  MD1_GOLDEN_CROPS,
  MD1_GOLDEN_HEIGHT,
  MD1_GOLDEN_REQUIRED_COVERAGE,
  MD1_GOLDEN_SURFACES,
  MD1_GOLDEN_WIDTH,
  createMd1GoldenFixture,
} from '../../src/services/motionDesign/evidence/md1GoldenFixture';
import {
  MD1_GOLDEN_PIXEL_THRESHOLDS,
  compareMd1PixelBuffers,
  cropMd1PixelBuffer,
  flattenPremultipliedMd1PixelBufferOnBlack,
  measureMd1PixelCoverage,
} from '../../src/services/motionDesign/evidence/md1PixelComparison';
// The production evidence runner is intentionally plain ESM so it can execute
// without a build step. These exported guards are its unit-testable safety seam.
// @ts-expect-error JavaScript CLI module has no declaration file.
import {
  createMd1DebugActionRequest,
  prepareMd1RecordSurfacePngs,
  requireMd1EvidenceData,
  selectExactMd1EvidenceSession,
  shouldWriteMd1EvidenceArtifacts,
  validateMd1DisposableSession,
} from '../../scripts/run-motion-design-md1-evidence.mjs';

describe('MD1 golden fixture manifest', () => {
  it('is deterministic, isolated, and covers every required MD1 surface', () => {
    const first = createMd1GoldenFixture();
    const second = createMd1GoldenFixture();

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.clips).not.toBe(second.clips);
    expect(first.clips[0].motion).not.toBe(second.clips[0].motion);
    expect([...MD1_GOLDEN_SURFACES]).toEqual([
      'direct-preview',
      'direct-export',
      'nested-preview',
      'nested-export',
    ]);

    const primitives = first.clips.map((clip) => clip.motion?.shape?.primitive);
    expect(new Set(primitives)).toEqual(new Set(MD1_GOLDEN_REQUIRED_COVERAGE.primitives));

    const appearances = first.clips.flatMap((clip) => clip.motion?.appearance?.items ?? []);
    expect(new Set(appearances.map((item) => item.kind))).toEqual(
      new Set(MD1_GOLDEN_REQUIRED_COVERAGE.appearanceKinds),
    );
    expect(appearances.filter((item) => item.kind === 'stroke')).toHaveLength(5);
    expect(first.clips.some((clip) => (clip.masks?.length ?? 0) > 0)).toBe(true);
    expect(first.clips.some((clip) => clip.effects.length > 0)).toBe(true);
    expect(first.clips.some((clip) => clip.transform.opacity < 1)).toBe(true);
    expect(first.clips.some((clip) => clip.transform.blendMode !== 'normal')).toBe(true);
    expect(first.nestedWrapperClip.isComposition).toBe(true);
    expect(first.nestedWrapperClip.nestedClips).toHaveLength(first.clips.length);
    const nestedRectangle = first.nestedWrapperClip.nestedClips?.find(
      (clip) => clip.id === 'md1-clip-rectangle',
    ) as (typeof first.clips)[number] & { keyframes?: unknown[] };
    expect(nestedRectangle.keyframes).toEqual(first.keyframes.get('md1-clip-rectangle'));
    expect(first.sampleTime).toBeGreaterThan(0);
    expect(first.sampleTime).toBeLessThan(1);
  });

  it('uses stable, unique appearance, stop, clip, and keyframe ids', () => {
    const fixture = createMd1GoldenFixture();
    const appearanceIds = fixture.clips.flatMap((clip) =>
      (clip.motion?.appearance?.items ?? []).map((item) => item.id),
    );
    const stopIds = fixture.clips.flatMap((clip) =>
      (clip.motion?.appearance?.items ?? []).flatMap((item) =>
        item.kind === 'linear-gradient' || item.kind === 'radial-gradient'
          ? item.stops.map((stop) => stop.id)
          : [],
      ),
    );
    const keyframes = [...fixture.keyframes.values()].flat();

    expect(new Set(appearanceIds).size).toBe(appearanceIds.length);
    expect(new Set(stopIds).size).toBe(stopIds.length);
    expect(new Set(fixture.clips.map((clip) => clip.id)).size).toBe(fixture.clips.length);
    expect(new Set(keyframes.map((keyframe) => keyframe.id)).size).toBe(keyframes.length);
    expect(keyframes.map((keyframe) => keyframe.property)).toContain('appearance.md1-rect-gradient.opacity');
  });

  it('defines valid, non-overlapping primitive crop regions', () => {
    for (const crop of MD1_GOLDEN_CROPS) {
      expect(crop.x).toBeGreaterThanOrEqual(0);
      expect(crop.y).toBeGreaterThanOrEqual(0);
      expect(crop.x + crop.width).toBeLessThanOrEqual(MD1_GOLDEN_WIDTH);
      expect(crop.y + crop.height).toBeLessThanOrEqual(MD1_GOLDEN_HEIGHT);
    }

    for (let index = 0; index < MD1_GOLDEN_CROPS.length; index += 1) {
      for (let other = index + 1; other < MD1_GOLDEN_CROPS.length; other += 1) {
        const a = MD1_GOLDEN_CROPS[index];
        const b = MD1_GOLDEN_CROPS[other];
        const overlaps = a.x < b.x + b.width && a.x + a.width > b.x
          && a.y < b.y + b.height && a.y + a.height > b.y;
        expect(overlaps).toBe(false);
      }
    }
  });
});

describe('MD1 evidence runner safety', () => {
  const disposableUrl = new URL(
    'http://motion-md1.localhost:5173/?motionDesignEvidenceSession=unit-test',
  );
  const pngChunk = (type: string, data = Buffer.alloc(0)) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const structurallyValidPngDataUrl = () => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(1, 0);
    header.writeUInt32BE(1, 4);
    header[8] = 8;
    header[9] = 6;
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      pngChunk('IHDR', header),
      pngChunk('IDAT', Buffer.from([0])),
      pngChunk('IEND'),
    ]);
    return `data:image/png;base64,${png.toString('base64')}`;
  };

  it('rejects a non-loopback bridge base before any token or session work', () => {
    expect(() => validateMd1DisposableSession({
      baseUrl: 'https://example.com/',
      sessionUrl: disposableUrl.href,
      baselineDir: 'unused',
      mode: 'verify',
    })).toThrow(/base-url must be loopback-only/);
  });

  it('targets one exact disposable URL among multiple live sessions', () => {
    const sessions = [
      { sessionId: 'other-a', url: 'http://other.localhost:5173/', projectId: 'project-a', projectName: 'A' },
      {
        sessionId: 'target-tab',
        url: disposableUrl.href,
        projectId: null,
        projectName: 'Untitled Project',
        projectFileOpen: false,
        timelineClipCount: 0,
      },
      { sessionId: 'other-b', url: 'http://other-b.localhost:5173/', projectId: 'project-b', projectName: 'B' },
    ];
    const target = selectExactMd1EvidenceSession(sessions, disposableUrl.href);
    expect(target.sessionId).toBe('target-tab');
    expect(createMd1DebugActionRequest(target, disposableUrl, {})).toMatchObject({
      action: 'run-motion-design-md1-evidence',
      targetTabId: 'target-tab',
      sessionId: 'target-tab',
      timeoutMs: 120_000,
    });
  });

  it('rejects open target projects and project-id collisions', () => {
    expect(() => selectExactMd1EvidenceSession([{
      sessionId: 'target-tab',
      url: disposableUrl.href,
      projectId: 'open-project',
      projectName: 'Open',
    }], disposableUrl.href)).toThrow(/projectId=null/);

    expect(() => selectExactMd1EvidenceSession([
      { sessionId: 'target-tab', url: disposableUrl.href, projectId: null, projectName: null },
      { sessionId: 'a', url: 'http://a.localhost:5173/', projectId: 'collision', projectName: 'A' },
      { sessionId: 'b', url: 'http://b.localhost:5173/', projectId: 'collision', projectName: 'B' },
    ], disposableUrl.href)).toThrow(/projectId collision/);

    expect(() => selectExactMd1EvidenceSession([{
      sessionId: 'target-tab',
      url: disposableUrl.href,
      projectId: null,
      projectName: 'Untitled Project',
      projectFileOpen: true,
      timelineClipCount: 0,
    }], disposableUrl.href)).toThrow(/ProjectFileService must be closed/);
  });

  it('refuses failed/incomplete record results and keeps verify mode read-only', () => {
    expect(() => prepareMd1RecordSurfacePngs({ success: false, error: 'capture failed' }))
      .toThrow(/refusing to write baselines/);
    expect(() => prepareMd1RecordSurfacePngs({
      success: true,
      data: { surfaces: { 'direct-preview': 'data:image/png;base64,AAAA' } },
    })).toThrow(/valid PNG signature|base64 PNG/);

    const valid = structurallyValidPngDataUrl();
    const validSurfaces = Object.fromEntries([
      'direct-preview', 'direct-export', 'nested-preview', 'nested-export',
    ].map((surface) => [surface, valid]));
    expect(Object.keys(prepareMd1RecordSurfacePngs({
      success: true,
      data: { surfaces: validSurfaces },
    }))).toHaveLength(4);

    const truncated = Buffer.from(valid.slice('data:image/png;base64,'.length), 'base64').subarray(0, -3);
    expect(() => prepareMd1RecordSurfacePngs({
      success: true,
      data: {
        surfaces: Object.fromEntries(Object.keys(validSurfaces).map((surface) => [
          surface,
          `data:image/png;base64,${truncated.toString('base64')}`,
        ])),
      },
    })).toThrow(/truncated|missing required|IEND/);
    expect(shouldWriteMd1EvidenceArtifacts('record')).toBe(true);
    expect(shouldWriteMd1EvidenceArtifacts('verify')).toBe(false);
  });

  it('preserves a bridge refusal reason when the action returns no data', () => {
    expect(() => requireMd1EvidenceData({
      success: false,
      error: 'MD1 evidence refuses a tab with an open project',
    })).toThrow('MD1 evidence refuses a tab with an open project');
  });
});

describe('MD1 RGBA pixel comparison', () => {
  const pixelBuffer = (pixels: number[], width = 2, height = 2) => ({
    width,
    height,
    data: new Uint8ClampedArray(pixels),
  });

  it('passes identical full-resolution pixels and fails a material difference', () => {
    const reference = pixelBuffer([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 0, 0, 0, 0,
    ]);
    const identical = compareMd1PixelBuffers(reference, pixelBuffer([...reference.data]));
    expect(identical.passed).toBe(true);
    expect(identical.changedPixelRatio).toBe(0);

    const changed = pixelBuffer([...reference.data]);
    changed.data[0] = 0;
    changed.data[3] = 0;
    const comparison = compareMd1PixelBuffers(reference, changed);
    expect(comparison.passed).toBe(false);
    expect(comparison.changedPixelCount).toBe(1);
    expect(comparison.changedPixelRatio).toBe(0.25);
    expect(comparison.alphaCoverageDelta).toBe(0.25);
  });

  it('allows a sparse preview/export edge outlier but keeps its golden cap bounded', () => {
    const reference = pixelBuffer(new Array(100 * 4).fill(0), 100, 1);
    const antialiasedEdge = pixelBuffer([...reference.data], 100, 1);
    antialiasedEdge.data[0] = 81;

    const accepted = compareMd1PixelBuffers(
      reference,
      antialiasedEdge,
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    );
    expect(accepted.passed).toBe(true);
    expect(accepted.maxChannelDelta).toBe(81);
    expect(accepted.p99ChannelDelta).toBe(0);

    antialiasedEdge.data[0] = MD1_GOLDEN_PIXEL_THRESHOLDS.maxChannelDelta + 1;
    expect(compareMd1PixelBuffers(
      reference,
      antialiasedEdge,
      MD1_GOLDEN_PIXEL_THRESHOLDS,
    ).failures).toContain('maxChannelDelta 97 exceeds 96');
  });

  it('normalizes premultiplied Preview transparency to an opaque black export surface', () => {
    const preview = pixelBuffer([
      0, 0, 0, 0, 20, 40, 60, 128,
      80, 100, 120, 255, 0, 0, 0, 0,
    ]);

    const flattened = flattenPremultipliedMd1PixelBufferOnBlack(preview);

    expect([...flattened.data]).toEqual([
      0, 0, 0, 255, 20, 40, 60, 255,
      80, 100, 120, 255, 0, 0, 0, 255,
    ]);
    expect(preview.data[3]).toBe(0);
    expect(compareMd1PixelBuffers(flattened, pixelBuffer([...flattened.data])).passed).toBe(true);
  });

  it('crops exact RGBA rows and reports visible coverage', () => {
    const source = pixelBuffer([
      0, 0, 0, 0, 10, 20, 30, 255,
      40, 50, 60, 255, 70, 80, 90, 255,
    ]);
    const crop = cropMd1PixelBuffer(source, { x: 1, y: 0, width: 1, height: 2 });

    expect([...crop.data]).toEqual([10, 20, 30, 255, 70, 80, 90, 255]);
    expect(measureMd1PixelCoverage(crop)).toEqual({
      alphaCoverage: 1,
      nonBlackCoverage: 1,
      lumaRange: 60,
    });
  });

  it('rejects dimension and RGBA-length mismatches', () => {
    const valid = pixelBuffer(new Array(16).fill(0));
    expect(() => compareMd1PixelBuffers(valid, pixelBuffer(new Array(8).fill(0), 1, 2)))
      .toThrow(/dimensions differ/);
    expect(() => compareMd1PixelBuffers(valid, { width: 2, height: 2, data: [0] }))
      .toThrow(/RGBA length/);
  });
});
