import { describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  describeMotionDesignMd0Fixture,
  handleRunMotionDesignMd0Evidence,
  captureMotionDesignMd0RestoreState,
  restoreMotionDesignMd0State,
  type MotionDesignMd0EvidenceDeps,
} from '../../src/services/aiTools/motionDesignMd0Evidence';
import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import type { FrameFingerprint } from '../../src/services/aiTools/frameFingerprint';
import {
  createDefaultMotionLayerDefinition,
  createStrokeAppearance,
} from '../../src/types/motionDesign';
import type { Keyframe } from '../../src/types/keyframes';
import type { TimelineClip, TimelineTrack } from '../../src/types/timeline';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { getHistoryStateView, useHistoryStore } from '../../src/stores/historyStore';
import {
  configureRenderHostSelection,
  renderHostPort,
  type RenderHostPort,
} from '../../src/services/render/renderHostPort';

interface Md0RunnerModule {
  validateBridgeBaseUrl: (value: string) => URL;
  validateDisposableSessionUrl: (
    baseUrl: string,
    sessionUrl: string | null,
  ) => { base: URL; sessionUrl: URL };
  selectExactDisposableSession: (
    sessions: unknown[],
    sessionUrl: URL,
  ) => Record<string, unknown>;
}

async function loadRunnerModule(): Promise<Md0RunnerModule> {
  const moduleUrl = pathToFileURL(path.resolve(
    process.cwd(),
    'scripts/run-motion-design-md0-evidence.mjs',
  )).href;
  return import(/* @vite-ignore */ moduleUrl) as Promise<Md0RunnerModule>;
}

function videoTrack(id: string): TimelineTrack {
  return {
    id,
    name: id,
    type: 'video',
    height: 70,
    muted: false,
    visible: true,
    solo: false,
  };
}

function motionClip(trackId: string): TimelineClip {
  const motion = createDefaultMotionLayerDefinition('shape');
  if (!motion.shape) throw new Error('Expected default shape');
  motion.shape = { ...motion.shape, cornerRadius: 36 };
  const stroke = { ...createStrokeAppearance(), visible: true };
  motion.appearance = {
    ...(motion.appearance ?? { version: 1 as const, items: [] }),
    items: [...(motion.appearance?.items ?? []), stroke],
  };
  return {
    id: 'plate',
    trackId,
    name: 'Lower Third Plate',
    file: new File([], 'plate.msmotion'),
    startTime: 0,
    duration: 6,
    inPoint: 0,
    outPoint: 6,
    source: { type: 'motion-shape', naturalDuration: 6 },
    motion,
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

function opacityKeyframes(clipId: string): Keyframe[] {
  return [
    { id: `${clipId}-in-0`, clipId, property: 'opacity', time: 0, value: 0, easing: 'ease-out' },
    { id: `${clipId}-in-1`, clipId, property: 'opacity', time: 0.5, value: 1, easing: 'ease-out' },
    { id: `${clipId}-out-1`, clipId, property: 'opacity', time: 5.25, value: 1, easing: 'ease-in' },
    { id: `${clipId}-out-0`, clipId, property: 'opacity', time: 6, value: 0, easing: 'ease-in' },
  ];
}

function textClip(trackId: string): TimelineClip {
  return {
    id: 'title',
    trackId,
    name: 'Motion Design',
    file: new File([], 'title.txt'),
    startTime: 0,
    duration: 6,
    inPoint: 0,
    outPoint: 6,
    source: { type: 'text', naturalDuration: 6 },
    textProperties: {
      ...structuredClone(DEFAULT_TEXT_PROPERTIES),
      text: 'Motion Design',
    },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
  };
}

function fingerprint(hash: string): FrameFingerprint {
  return {
    sourceWidth: 1280,
    sourceHeight: 720,
    sampleWidth: 48,
    sampleHeight: 27,
    pixelCount: 1296,
    hash,
    nonBlankRatio: 0.2,
    alphaCoverage: 1,
    avgRgb: { r: 30, g: 40, b: 70 },
    meanLuma: 42,
    colorRange: { r: 220, g: 210, b: 200, luma: 205 },
  };
}

function validFixture() {
  const tracks = [videoTrack('title-track'), videoTrack('plate-track')];
  return describeMotionDesignMd0Fixture({
    plateClipId: 'plate',
    textClipId: 'title',
    tracks,
    clips: [motionClip('plate-track'), textClip('title-track')],
    getClipKeyframes: opacityKeyframes,
    durationSeconds: 6,
    composition: { id: 'fixture-comp', width: 1280, height: 720, frameRate: 30, backgroundColor: '#000000' },
  });
}

describe('Motion Design MD0 disposable evidence helper', () => {
  it('rejects the old same-track lower-third layout before pixel capture', () => {
    const track = videoTrack('video-1');
    const result = describeMotionDesignMd0Fixture({
      plateClipId: 'plate',
      textClipId: 'title',
      tracks: [track],
      clips: [motionClip(track.id), textClip(track.id)],
      getClipKeyframes: opacityKeyframes,
      durationSeconds: 6,
      composition: { id: 'fixture-comp', width: 1280, height: 720, frameRate: 30, backgroundColor: '#000000' },
    });

    expect(result).toEqual({
      ok: false,
      error: 'MD0 evidence requires plate and text on separate video tracks; preview/export resolve one active clip per track.',
    });
  });

  it('describes native motion and editable text on distinct video tracks', () => {
    const result = validFixture();

    expect(result).toMatchObject({
      ok: true,
      view: {
        durationSeconds: 6,
        composition: { id: 'fixture-comp', width: 1280, height: 720, frameRate: 30, backgroundColor: '#000000' },
        tracks: expect.arrayContaining([
          expect.objectContaining({ id: 'plate-track', visible: true, muted: false }),
        ]),
        plate: {
          id: 'plate',
          trackId: 'plate-track',
          sourceType: 'motion-shape',
          timing: { startTime: 0, duration: 6, inPoint: 0, outPoint: 6 },
          transform: DEFAULT_TRANSFORM,
          editableState: expect.objectContaining({
            id: 'plate',
            transform: DEFAULT_TRANSFORM,
            keyframes: expect.arrayContaining([
              expect.objectContaining({ id: 'plate-out-0', time: 6, value: 0 }),
            ]),
          }),
        },
        text: {
          id: 'title',
          trackId: 'title-track',
          sourceType: 'text',
          textProperties: expect.objectContaining({ text: 'Motion Design' }),
        },
      },
    });
  });

  it('rejects hidden tracks, missing stroke, and incomplete opacity envelopes', () => {
    const hiddenTracks = [videoTrack('title-track'), videoTrack('plate-track')];
    hiddenTracks[0].visible = false;
    const common = {
      plateClipId: 'plate',
      textClipId: 'title',
      clips: [motionClip('plate-track'), textClip('title-track')],
      durationSeconds: 6,
      composition: { id: 'fixture-comp', width: 1280, height: 720, frameRate: 30, backgroundColor: '#000000' },
    };
    expect(describeMotionDesignMd0Fixture({
      ...common,
      tracks: hiddenTracks,
      getClipKeyframes: opacityKeyframes,
    })).toMatchObject({ ok: false, error: expect.stringContaining('visible and unmuted') });

    const noStrokePlate = motionClip('plate-track');
    if (noStrokePlate.motion?.appearance) {
      noStrokePlate.motion.appearance.items = noStrokePlate.motion.appearance.items.filter(
        (item) => item.kind !== 'stroke',
      );
    }
    expect(describeMotionDesignMd0Fixture({
      ...common,
      tracks: [videoTrack('title-track'), videoTrack('plate-track')],
      clips: [noStrokePlate, textClip('title-track')],
      getClipKeyframes: opacityKeyframes,
    })).toMatchObject({ ok: false, error: expect.stringContaining('fill and stroke') });

    expect(describeMotionDesignMd0Fixture({
      ...common,
      tracks: [videoTrack('title-track'), videoTrack('plate-track')],
      getClipKeyframes: (clipId) => opacityKeyframes(clipId).slice(0, 2),
    })).toMatchObject({ ok: false, error: expect.stringContaining('fade-in and fade-out') });
  });

  it('runs round-trip, direct, nested, export, stats, and restore evidence in order', async () => {
    const fixture = validFixture();
    expect(fixture.ok).toBe(true);
    if (!fixture.ok) return;

    const directFingerprint = fingerprint('samehash');
    const nestedFingerprint = fingerprint('samehash');
    const capture = vi.fn()
      .mockResolvedValueOnce({
        capturedAt: 1,
        width: 1280,
        height: 720,
        mode: 'gpu',
        canvasSource: 'renderTarget:program',
        fingerprint: directFingerprint,
        dataUrl: 'data:image/png;base64,AA==',
        renderDiagnostics: { requested: true },
      })
      .mockResolvedValueOnce({
        capturedAt: 1,
        width: 1280,
        height: 720,
        mode: 'gpu',
        canvasSource: 'renderTarget:program',
        fingerprint: nestedFingerprint,
        dataUrl: 'data:image/png;base64,AQ==',
        renderDiagnostics: { requested: true },
      });
    const endMutation = vi.fn();
    const restoreTimeline = vi.fn(async () => ({
      verified: true,
      failures: [],
      smokeRestore: { restoredClipCount: 2 },
      renderResolution: {
        before: { width: 1280, height: 720 },
        after: { width: 1280, height: 720 },
      },
      timelineFieldMismatches: [],
      mediaFieldMismatches: [],
      historyFieldMismatches: [],
    }));
    const runExportParity = vi.fn(async () => ({
      success: true,
      data: {
        fastRun: {
          success: true,
          blobSize: 4096,
          bestSample: { fingerprint: directFingerprint },
        },
      },
    }));
    const materializeNested = vi.fn(async () => ({
      childCompositionId: 'child',
      parentCompositionId: 'parent',
      nestedClipId: 'nested',
      parentTrackId: 'parent-track',
    }));
    const deps: MotionDesignMd0EvidenceDeps = {
      beginMutation: vi.fn(() => endMutation),
      captureRestoreState: vi.fn(() => ({ fixture: 'before' })),
      restoreTimeline,
      readFixture: vi.fn(() => fixture),
      roundTrip: vi.fn(async () => ({
        passed: true,
        before: fixture.view,
        after: fixture.view,
        serializedTrackCount: 2,
        serializedClipCount: 2,
        persistenceScope: 'composition-save-reopen',
        projectPersistenceCovered: false,
        limitation: 'Project persistence is not covered.',
      })),
      capture,
      runExportParity,
      materializeNested,
      getStats: vi.fn(async () => ({
        success: true,
        data: {
          engineReady: true,
          motionDesign: { timeline: { clipCount: 1 } },
          gpu: { adapter: 'test' },
        },
      })),
      compareFingerprints: vi.fn((reference, candidate, thresholds) => ({
        passed: true,
        failures: [],
        avgRgbDelta: 0,
        meanLumaDelta: 0,
        nonBlankRatioDelta: 0,
        colorRangeDelta: 0,
        thresholds: {
          maxAvgRgbDelta: thresholds.maxAvgRgbDelta ?? 12,
          maxMeanLumaDelta: thresholds.maxMeanLumaDelta ?? 12,
          maxNonBlankRatioDelta: thresholds.maxNonBlankRatioDelta ?? 0.08,
          minReferenceNonBlankRatio: thresholds.minReferenceNonBlankRatio ?? 0.02,
          minCandidateNonBlankRatio: thresholds.minCandidateNonBlankRatio ?? 0.02,
          maxColorRangeDelta: thresholds.maxColorRangeDelta ?? 32,
        },
        referenceHash: reference.hash,
        candidateHash: candidate.hash,
      } as ReturnType<MotionDesignMd0EvidenceDeps['compareFingerprints']>)),
    };

    const result = await handleRunMotionDesignMd0Evidence({
      plateClipId: 'plate',
      textClipId: 'title',
      sampleTimeSeconds: 1,
    }, deps);

    expect(result.success).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(runExportParity).toHaveBeenCalledTimes(2);
    expect(result.data).toMatchObject({
      roundTrip: { passed: true },
      direct: { fingerprint: { hash: 'samehash' } },
      nestedFixture: { nestedClipId: 'nested' },
      nested: { fingerprint: { hash: 'samehash' } },
      directNestedComparison: { passed: true },
      stats: { engineReady: true },
      restore: { enabled: true, result: { verified: true } },
      failures: [],
    });
    expect(restoreTimeline).toHaveBeenCalledWith({ fixture: 'before' });
    expect(materializeNested).toHaveBeenCalledWith({
      durationSeconds: 6,
      width: 1280,
      height: 720,
      frameRate: 30,
      backgroundColor: '#000000',
    });
    expect(runExportParity).toHaveBeenCalledWith(expect.objectContaining({
      width: 640,
      height: 360,
      fps: 8,
    }));
    expect(endMutation).toHaveBeenCalledTimes(1);
  });

  it('rejects caller-supplied proof data before starting a mutation', async () => {
    const deps = {
      beginMutation: vi.fn(),
      readFixture: vi.fn(),
    } as unknown as MotionDesignMd0EvidenceDeps;

    const result = await handleRunMotionDesignMd0Evidence({
      plateClipId: 'plate',
      textClipId: 'title',
      fingerprint: { hash: 'forged' },
    }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('cannot be caller-supplied');
    expect(deps.readFixture).not.toHaveBeenCalled();
    expect(deps.beginMutation).not.toHaveBeenCalled();
  });

  it('forbids disabling restoration before any evidence mutation', async () => {
    const deps = {
      beginMutation: vi.fn(),
      readFixture: vi.fn(),
    } as unknown as MotionDesignMd0EvidenceDeps;

    const result = await handleRunMotionDesignMd0Evidence({
      plateClipId: 'plate',
      textClipId: 'title',
      restoreTimelineAfterRun: false,
    }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('is forbidden');
    expect(deps.readFixture).not.toHaveBeenCalled();
    expect(deps.beginMutation).not.toHaveBeenCalled();
  });

  it('restores exactly once after a partial evidence failure', async () => {
    const fixture = validFixture();
    expect(fixture.ok).toBe(true);
    if (!fixture.ok) return;
    const endMutation = vi.fn();
    const restoreTimeline = vi.fn(async () => ({
      verified: true,
      failures: [],
      smokeRestore: null,
      renderResolution: {
        before: { width: 1280, height: 720 },
        after: { width: 1280, height: 720 },
      },
      timelineFieldMismatches: [],
      mediaFieldMismatches: [],
      historyFieldMismatches: [],
    }));
    const deps = {
      beginMutation: vi.fn(() => endMutation),
      captureRestoreState: vi.fn(() => ({ state: 'before' })),
      restoreTimeline,
      readFixture: vi.fn(() => fixture),
      roundTrip: vi.fn(async () => { throw new Error('round-trip exploded'); }),
    } as unknown as MotionDesignMd0EvidenceDeps;

    const result = await handleRunMotionDesignMd0Evidence({
      plateClipId: 'plate',
      textClipId: 'title',
    }, deps);

    expect(result.success).toBe(false);
    expect(result.error).toContain('round-trip exploded');
    expect(restoreTimeline).toHaveBeenCalledOnce();
    expect(restoreTimeline).toHaveBeenCalledWith({ state: 'before' });
    expect(endMutation).toHaveBeenCalledOnce();
  });

  it('accepts different sampled hashes when the configured parity comparison passes', async () => {
    const fixture = validFixture();
    expect(fixture.ok).toBe(true);
    if (!fixture.ok) return;
    const endMutation = vi.fn();
    const capture = vi.fn()
      .mockResolvedValueOnce({
        capturedAt: 1,
        width: 1280,
        height: 720,
        mode: 'gpu',
        canvasSource: 'direct',
        fingerprint: fingerprint('spatial-a'),
        dataUrl: 'data:image/png;base64,AA==',
        renderDiagnostics: null,
      })
      .mockResolvedValueOnce({
        capturedAt: 1,
        width: 1280,
        height: 720,
        mode: 'gpu',
        canvasSource: 'nested',
        fingerprint: fingerprint('spatial-b'),
        dataUrl: 'data:image/png;base64,AQ==',
        renderDiagnostics: null,
      });
    const deps = {
      beginMutation: vi.fn(() => endMutation),
      captureRestoreState: vi.fn(() => ({ state: 'before' })),
      restoreTimeline: vi.fn(async () => ({
        verified: true,
        failures: [],
        smokeRestore: null,
        renderResolution: {
          before: { width: 1280, height: 720 },
          after: { width: 1280, height: 720 },
        },
        timelineFieldMismatches: [],
        mediaFieldMismatches: [],
        historyFieldMismatches: [],
      })),
      readFixture: vi.fn(() => fixture),
      roundTrip: vi.fn(async () => ({
        passed: true,
        before: fixture.view,
        after: fixture.view,
        serializedTrackCount: 2,
        serializedClipCount: 2,
        persistenceScope: 'composition-save-reopen',
        projectPersistenceCovered: false,
        limitation: 'Project persistence is not covered.',
      })),
      capture,
      runExportParity: vi.fn(async () => ({ success: true, data: {} })),
      materializeNested: vi.fn(async () => ({
        childCompositionId: 'child',
        parentCompositionId: 'parent',
        nestedClipId: 'nested',
        parentTrackId: 'track',
      })),
      getStats: vi.fn(async () => ({ success: true, data: {} })),
      compareFingerprints: vi.fn(() => ({ passed: true, failures: [] })),
    } as unknown as MotionDesignMd0EvidenceDeps;

    const result = await handleRunMotionDesignMd0Evidence({
      plateClipId: 'plate',
      textClipId: 'title',
    }, deps);

    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({
      directNestedComparison: { passed: true },
      failures: [],
    });
    expect(deps.restoreTimeline).toHaveBeenCalledOnce();
    expect(endMutation).toHaveBeenCalledOnce();
  });

  it('restores full timeline, media, history, and render dimensions', async () => {
    const fallbackTelemetry = renderHostPort.getTelemetry();
    const requestNewFrameRender = renderHostPort.requestNewFrameRender;
    const setIsPlaying = renderHostPort.setIsPlaying;
    let dimensions = { width: 1920, height: 1080 };
    const evidenceRenderHost = {
      getOutputDimensions: () => ({ ...dimensions }),
      setResolution: (width: number, height: number) => { dimensions = { width, height }; },
      requestNewFrameRender,
      setIsPlaying,
      getTelemetry: () => fallbackTelemetry,
    } as unknown as RenderHostPort;
    configureRenderHostSelection({
      workerPrimary: evidenceRenderHost,
      preferWorkerPrimary: true,
      workerPrimaryAvailable: true,
    });
    const outerSnapshot = captureMotionDesignMd0RestoreState();
    const defaultMediaState = useMediaStore.getState();
    const getMediaState = vi.mocked(useMediaStore.getState);
    const setMediaState = vi.mocked(useMediaStore.setState);
    const baselineCompositionId = 'md0-restore-baseline';
    let mediaState = {
      ...defaultMediaState,
      compositions: [{
        id: baselineCompositionId,
        name: 'MD0 Restore Baseline',
        type: 'composition' as const,
        parentId: null,
        createdAt: 1,
        width: 1111,
        height: 777,
        frameRate: 30,
        duration: 6,
        backgroundColor: '#000000',
      }],
      activeCompositionId: baselineCompositionId,
      openCompositionIds: [baselineCompositionId],
    };
    getMediaState.mockImplementation(() => mediaState as ReturnType<typeof useMediaStore.getState>);
    setMediaState.mockImplementation((update) => {
      const patch = typeof update === 'function' ? update(mediaState) : update;
      mediaState = { ...mediaState, ...patch };
    });

    try {
      renderHostPort.setResolution(1111, 777);
      useTimelineStore.setState({
        inPoint: 1,
        outPoint: 5,
        loopPlayback: true,
        trackHeaderWidth: 333,
        targetTrackIdByType: { video: 'baseline-video' },
      });
      useHistoryStore.setState({ maxHistoryNodes: 77, isApplying: true });
      const snapshot = captureMotionDesignMd0RestoreState();

      useTimelineStore.setState({
        inPoint: 9,
        outPoint: 10,
        loopPlayback: false,
        trackHeaderWidth: 222,
        targetTrackIdByType: {},
      });
      useMediaStore.setState({ activeCompositionId: null, openCompositionIds: [] });
      useHistoryStore.setState({ maxHistoryNodes: 13, isApplying: false });
      renderHostPort.setResolution(320, 180);

      const restored = await restoreMotionDesignMd0State(snapshot);

      expect(restored).toMatchObject({ verified: true, failures: [] });
      expect(useTimelineStore.getState()).toMatchObject({
        inPoint: 1,
        outPoint: 5,
        loopPlayback: true,
        trackHeaderWidth: 333,
        targetTrackIdByType: { video: 'baseline-video' },
      });
      expect(useMediaStore.getState()).toMatchObject({
        activeCompositionId: baselineCompositionId,
        openCompositionIds: [baselineCompositionId],
      });
      expect(getHistoryStateView()).toMatchObject({ maxHistorySize: 77, isApplying: true });
      expect(renderHostPort.getOutputDimensions()).toEqual({ width: 1111, height: 777 });
    } finally {
      await restoreMotionDesignMd0State(outerSnapshot);
      configureRenderHostSelection({
        preferWorkerPrimary: false,
        workerPrimaryAvailable: false,
      });
      getMediaState.mockReset().mockReturnValue(defaultMediaState);
      setMediaState.mockReset();
    }
  });
});

describe('Motion Design MD0 evidence runner safety', () => {
  it('accepts only a local bridge base and validates it before session selection', async () => {
    const runner = await loadRunnerModule();

    expect(runner.validateBridgeBaseUrl('http://localhost:5173/').hostname).toBe('localhost');
    expect(runner.validateBridgeBaseUrl('http://127.0.0.2:5173/').hostname).toBe('127.0.0.2');
    expect(() => runner.validateBridgeBaseUrl('https://example.com/')).toThrow('remote bridge hosts are forbidden');
    expect(() => runner.validateBridgeBaseUrl('http://localhost:5173/path')).toThrow('origin only');
    expect(() => runner.validateDisposableSessionUrl(
      'https://example.com/',
      'https://motion-md0-a1b2c3d4.localhost/',
    )).toThrow('remote bridge hosts are forbidden');
  });

  it('requires an explicit run-specific session URL and rejects focused-session fallbacks', async () => {
    const runner = await loadRunnerModule();

    expect(() => runner.validateDisposableSessionUrl('http://localhost:5173/', null))
      .toThrow('focused-session fallback is forbidden');
    expect(() => runner.validateDisposableSessionUrl(
      'http://localhost:5173/',
      'http://localhost:5173/',
    )).toThrow('run-specific host');
    expect(() => runner.validateDisposableSessionUrl(
      'http://localhost:5173/',
      'http://motion-md0.localhost:5173/',
    )).toThrow('run-specific host');
    expect(() => runner.validateDisposableSessionUrl(
      'http://localhost:5173/',
      'http://motion-md0-a1b2c3d4.localhost:4173/',
    )).toThrow('same protocol and port');
  });

  it('selects exactly one blank isolated session and rejects saved, duplicate, or shared-origin targets', async () => {
    const runner = await loadRunnerModule();
    const { sessionUrl } = runner.validateDisposableSessionUrl(
      'http://localhost:5173/',
      'http://motion-md0-a1b2c3d4.localhost:5173/evidence',
    );
    const target = {
      sessionId: 'md0-tab',
      url: sessionUrl.href,
      projectId: null,
      projectName: 'Untitled Project',
      projectFileOpen: false,
      timelineClipCount: 0,
      chatMessageCount: 0,
      chatToolCallCount: 0,
    };
    const userSession = {
      sessionId: 'user-tab',
      url: 'http://localhost:5173/project',
      projectId: 'real-project',
      projectName: 'User Project',
      chatMessageCount: 4,
      chatToolCallCount: 1,
    };

    expect(runner.selectExactDisposableSession([target, userSession], sessionUrl))
      .toMatchObject({ sessionId: 'md0-tab', projectId: null });
    expect(() => runner.selectExactDisposableSession([
      target,
      { ...target, sessionId: 'second-exact' },
    ], sessionUrl)).toThrow('found 2');
    expect(() => runner.selectExactDisposableSession([
      { ...target, projectId: 'saved-project' },
    ], sessionUrl)).toThrow('already has a saved project');
    expect(() => runner.selectExactDisposableSession([
      { ...target, projectId: undefined },
    ], sessionUrl)).toThrow('already has a saved project');
    expect(() => runner.selectExactDisposableSession([
      { ...target, projectName: 'Unsaved User Work' },
    ], sessionUrl)).toThrow('unexpected project name');
    expect(() => runner.selectExactDisposableSession([
      { ...target, chatMessageCount: 1 },
    ], sessionUrl)).toThrow('chat activity');
    expect(() => runner.selectExactDisposableSession([
      target,
      { ...userSession, url: `${sessionUrl.origin}/another-tab` },
    ], sessionUrl)).toThrow('origin is shared');
    expect(() => runner.selectExactDisposableSession([
      target,
      { ...userSession, sessionId: 'md0-tab' },
    ], sessionUrl)).toThrow('session id is not unique');
  });
});
