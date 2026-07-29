import { describe, expect, it } from 'vitest';
import {
  buildTimelineClipCanvasWorkerDrawMessage,
  createTimelineClipCanvasWorkerPaintClipInput,
  getTimelineClipCanvasWorkerEligibility,
  type TimelineClipCanvasWorkerPaintClipInput,
} from '../../src/components/timeline/utils/timelineClipCanvasWorkerModel';
import type { TimelinePaintSourceClip } from '../../src/timeline';

function createSourceClip(overrides: Partial<TimelinePaintSourceClip> = {}): TimelinePaintSourceClip {
  return {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Clip 1',
    startTime: 2,
    duration: 4,
    source: { type: 'solid' },
    ...overrides,
  };
}

function createClip(overrides: Partial<TimelinePaintSourceClip> = {}): TimelineClipCanvasWorkerPaintClipInput {
  return createTimelineClipCanvasWorkerPaintClipInput(createSourceClip(overrides));
}

function createBitmap(overrides: Partial<ImageBitmap> = {}): ImageBitmap {
  return {
    width: 160,
    height: 48,
    close: () => undefined,
    ...overrides,
  } as ImageBitmap;
}

describe('timeline clip canvas worker model', () => {
  it('builds a structured-clone-safe draw message with resolved geometry and active state', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [
        createClip(),
        createClip({ id: 'clip-2', name: 'Clip 2', startTime: 20, duration: 3 }),
      ],
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 2,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(['clip-1']),
      hoveredClipId: 'clip-1',
      trackColor: '#4c9aff',
      requestId: 42,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.inputClipCount).toBe(2);
    expect(result.visibleClipCount).toBe(1);
    expect(result.message).toMatchObject({
      type: 'draw',
      requestId: 42,
      clips: [{
        id: 'clip-1',
        paintPacket: {
          schemaVersion: 1,
          clipId: 'clip-1',
          trackId: 'track-1',
          bodyRect: { x: 14, y: 0, width: 48, height: 48 },
          label: 'Clip 1',
          state: {
            selected: true,
            hovered: true,
            muted: false,
            disabled: false,
            pending: false,
          },
          facets: [
            { kind: 'body', clipId: 'clip-1', resourceRefIds: [] },
            { kind: 'label', clipId: 'clip-1', resourceRefIds: [] },
          ],
          resourceRefIds: [],
        },
      }],
      height: 48,
      cssWidth: 200,
      dpr: 2,
      trackColor: '#4c9aff',
      paintResources: {
        schemaVersion: 1,
        resources: [],
      },
      paintPayloads: {
        thumbnailStrips: [],
        waveforms: [],
        spectrograms: [],
        midiPreviews: [],
        fadeVisuals: [],
        trimVisuals: [],
        passiveDecorations: [],
        compositionVisuals: [],
      },
    });
    expect(result.message?.clips[0].paintPacket.geometryEpoch).toContain('worker-draw:42');
    expect(structuredClone(result.message)).toEqual(result.message);
  });

  it('rejects worker mode for unsupported passive resources and unprepared trim visuals', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [
        createClip({
          source: { type: 'video', mediaFileId: 'media-1' },
          inPoint: 3,
          outPoint: 7,
          reversed: true,
          isComposition: true,
          waveform: [0, 1],
          fade: { keyframes: [{}, {}] },
        }),
      ],
      waveformsEnabled: true,
      hasPassiveDecorations: true,
      hasClipTrim: true,
    });

    expect(eligibility.eligible).toBe(false);
    expect(eligibility.reasons).toEqual([
      'clip-trim-active',
      'composition-visuals',
      'fade-visuals',
      'passive-decorations',
      'source-timing-visuals',
      'thumbnail-visuals',
    ]);
  });

  it('does not treat video clips with waveform data as audio-resource visuals', () => {
    const videoClip = createClip({
      trackType: 'video',
      source: { type: 'video', mediaFileId: 'media-1' },
      waveform: [0, 0.4, 0.2],
      audioState: {
        sourceAnalysisRefs: { waveformPyramidId: 'video-source-waveform' },
      },
    });

    expect(videoClip.isAudio).toBe(false);
    expect(videoClip.visuals.audioResource).toEqual({
      waveformLike: false,
      analysisRef: false,
    });

    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [videoClip],
      waveformsEnabled: true,
      audioDisplayMode: 'detailed',
      preparedThumbnailClipIds: new Set(['clip-1']),
    });

    expect(eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it('carries prepared waveform resources as cloned transferable columns', () => {
    const preparedColumns = [0, 0.5, 0.25, 0.5, -0.25, 0.75, 0.35, 0.75];
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        trackType: 'audio',
        source: { type: 'audio', naturalDuration: 4 },
        waveform: [0, 0.5, -0.25, 0.75],
      })],
      waveformsEnabled: true,
      audioDisplayMode: 'detailed',
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          waveform: {
            kind: 'waveform',
            columns: preparedColumns,
            columnCount: 2,
            mode: 'detailed',
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 7,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.transferables).toHaveLength(1);
    expect(result.message?.clips[0]).toMatchObject({ id: 'clip-1' });
    expect(result.message?.clips[0].paintPacket.facets.map((facet) => facet.kind)).toContain('waveform');
    expect(result.message?.clips[0].paintPacket.resourceRefIds).toContain('clip-1:waveform-columns');
    const waveformPayload = result.message?.paintPayloads.waveforms[0]?.resource;
    expect(result.message?.paintResources.resources).toContainEqual({
      id: 'clip-1:waveform-columns',
      kind: 'waveform-columns',
      ownerClipId: 'clip-1',
      byteEstimate: waveformPayload?.columns.byteLength,
      transferMode: 'transfer',
    });
    expect(waveformPayload?.columns).toBeInstanceOf(Float32Array);
    expect(Array.from(waveformPayload?.columns ?? [])).toEqual(
      preparedColumns.map((value) => expect.closeTo(value)),
    );
    expect(waveformPayload?.columns).not.toBe(preparedColumns);
    expect(result.transferables[0]).toBe(waveformPayload?.columns.buffer);
    const clonedMessage = structuredClone(result.message);
    expect(clonedMessage).toMatchObject({
      type: 'draw',
      requestId: 7,
      clips: [{ id: 'clip-1' }],
      paintPayloads: {
        waveforms: [{
          resourceId: 'clip-1:waveform-columns',
          resource: {
            kind: 'waveform',
            columnCount: 2,
            mode: 'detailed',
          },
        }],
      },
    });
    expect(Array.from(clonedMessage?.paintPayloads.waveforms[0]?.resource.columns ?? [])).toEqual(
      preparedColumns.map((value) => expect.closeTo(value)),
    );
  });

  it('carries prepared spectrogram resources as cloned transferable values', () => {
    const preparedValues = [0, 0.15, 0.5, 1, 0.1, 0.25];
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        trackType: 'audio',
        source: { type: 'audio', naturalDuration: 4 },
        audioState: {
          sourceAnalysisRefs: { spectrogramTileSetIds: ['spectrogram-ref'] },
        },
      })],
      waveformsEnabled: true,
      audioDisplayMode: 'spectral',
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          spectrogram: {
            kind: 'spectrogram',
            values: preparedValues,
            rasterWidth: 3,
            rasterHeight: 2,
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 8,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.transferables).toHaveLength(1);
    expect(result.message?.clips[0]).toMatchObject({ id: 'clip-1' });
    expect(result.message?.paintPayloads.spectrograms[0]?.resource).toMatchObject({
      kind: 'spectrogram',
      rasterWidth: 3,
      rasterHeight: 2,
    });
    const spectrogramPayload = result.message?.paintPayloads.spectrograms[0]?.resource;
    expect(spectrogramPayload?.values).toBeInstanceOf(Float32Array);
    expect(Array.from(spectrogramPayload?.values ?? [])).toEqual(
      preparedValues.map((value) => expect.closeTo(value)),
    );
    expect(spectrogramPayload?.values).not.toBe(preparedValues);
    expect(result.transferables[0]).toBe(spectrogramPayload?.values.buffer);
  });

  it('uses the shared audio analysis ref rules for prepared waveform clips', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        trackType: 'audio',
        source: { type: 'audio', naturalDuration: 4 },
        audioState: {
          processedAnalysisRefs: { processedWaveformPyramidId: 'processed-waveform-ref' },
        },
      })],
      waveformsEnabled: true,
      audioDisplayMode: 'detailed',
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          waveform: {
            kind: 'waveform',
            columns: [0, 0.5, 0.25, 0.5],
            columnCount: 1,
            mode: 'detailed',
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 18,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.message?.clips[0]).toMatchObject({ id: 'clip-1' });
    expect(result.message?.paintPayloads.waveforms[0]?.resource).toMatchObject({
      kind: 'waveform',
      columnCount: 1,
    });
  });

  it('does not treat empty audio state objects as audio-resource fallback visuals', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip({
        audioState: {
          sourceAnalysisRefs: {},
          processedAnalysisRefs: {},
        },
      })],
      waveformsEnabled: true,
      audioDisplayMode: 'detailed',
    });

    expect(eligibility).toEqual({ eligible: true, reasons: [] });
  });

  it('carries prepared thumbnail strip resources as transfer-owned bitmaps', () => {
    const bitmap = createBitmap();
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        source: { type: 'video', mediaFileId: 'media-1' },
      })],
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          thumbnailStrip: {
            kind: 'thumbnail-strip',
            bitmap,
            x: 24,
            width: 48,
            height: 46,
            drawCount: 2,
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 0,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 9,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.message?.clips[0]).toMatchObject({ id: 'clip-1' });
    expect(result.message?.paintPayloads.thumbnailStrips[0]?.resource).toMatchObject({
      kind: 'thumbnail-strip',
      bitmap,
      x: 24,
      width: 48,
      height: 46,
      drawCount: 2,
    });
    expect(result.transferables).toEqual([bitmap]);
  });

  it('carries prepared passive decorations without transferables', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip()],
      hasPassiveDecorations: true,
      passiveDecorationClipIds: new Set(['clip-1']),
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          passiveDecorations: {
            kind: 'passive-decorations',
            badges: [{ label: 'L', fill: 'rgba(15, 23, 42, 0.86)' }],
            progressBars: [{ progress: 42, color: 'rgba(96, 165, 250, 0.9)' }],
            sceneCutMarkers: new Float32Array([0.25, 0.75]),
            transcriptMarkers: new Float32Array([0.1, 0.2, 0.4, 0.5]),
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 11,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    const passiveDecorations = result.message?.paintPayloads.passiveDecorations[0]?.resource;
    expect(passiveDecorations).toMatchObject({
      kind: 'passive-decorations',
      badges: [{ label: 'L' }],
      progressBars: [{ progress: 42 }],
    });
    expect('passiveDecorations' in (result.message?.clips[0] ?? {})).toBe(false);
    expect(passiveDecorations?.transcriptMarkers).toBeInstanceOf(Float32Array);
    expect(Array.from(passiveDecorations?.transcriptMarkers ?? [])).toEqual([
      expect.closeTo(0.1),
      expect.closeTo(0.2),
      expect.closeTo(0.4),
      expect.closeTo(0.5),
    ]);
    expect(Array.from(passiveDecorations?.sceneCutMarkers ?? [])).toEqual([
      expect.closeTo(0.25),
      expect.closeTo(0.75),
    ]);
    const sceneCutResource = result.message?.paintResources.resources.find(
      (resource) => resource.kind === 'scene-cut-markers',
    );
    const passiveFacet = result.message?.clips[0]?.paintPacket.facets.find(
      (facet) => facet.kind === 'passive-decorations',
    );
    expect(sceneCutResource).toMatchObject({
      byteEstimate: 8,
      transferMode: 'transfer',
    });
    expect(passiveFacet?.resourceRefIds).toContain(sceneCutResource?.id);
    expect(result.message?.clips[0]?.paintPacket.resourceRefIds).toContain(sceneCutResource?.id);
    expect(result.transferables).toEqual([
      passiveDecorations?.transcriptMarkers?.buffer,
      passiveDecorations?.sceneCutMarkers?.buffer,
    ]);
  });

  it('carries prepared analysis overlays as transferables', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip()],
      hasPassiveDecorations: true,
      passiveDecorationClipIds: new Set(['clip-1']),
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          passiveDecorations: {
            kind: 'passive-decorations',
            analysisOverlay: {
              kind: 'analysis-overlay',
              points: new Float32Array([
                0, 0.4, 0.2, 1,
                1, 0.8, 0.5, 0,
              ]),
              pointCount: 2,
            },
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 12,
    });

    const passiveDecorations = result.message?.paintPayloads.passiveDecorations[0]?.resource;
    const analysisOverlay = passiveDecorations?.analysisOverlay;
    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect('passiveDecorations' in (result.message?.clips[0] ?? {})).toBe(false);
    expect(analysisOverlay?.points).toBeInstanceOf(Float32Array);
    expect(analysisOverlay?.pointCount).toBe(2);
    expect(Array.from(analysisOverlay?.points ?? [])).toEqual([
      0,
      expect.closeTo(0.4),
      expect.closeTo(0.2),
      1,
      1,
      expect.closeTo(0.8),
      expect.closeTo(0.5),
      0,
    ]);
    expect(result.transferables).toEqual([
      analysisOverlay?.points.buffer,
    ]);
  });

  it('uses prepared trim visuals for active trim body geometry and source-extension ghosts', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip()],
      hasClipTrim: true,
      activeTrimClipId: 'clip-1',
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          trimVisuals: {
            kind: 'trim-visuals',
            body: {
              x: 18,
              width: 72,
            },
            sourceExtensionGhosts: [
              { edge: 'right', x: 90, width: 24 },
            ],
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 13,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.message?.clips[0]).toMatchObject({
      id: 'clip-1',
      paintPacket: {
        bodyRect: {
          x: 18,
          width: 72,
        },
      },
    });
    expect(result.message?.paintPayloads.trimVisuals[0]?.resource).toMatchObject({
      kind: 'trim-visuals',
      body: {
        x: 18,
        width: 72,
      },
      sourceExtensionGhosts: [
        { edge: 'right', x: 90, width: 24 },
      ],
    });
    expect(result.transferables).toEqual([]);
  });

  it('carries prepared fade visuals as cloned transferable curve geometry', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        fade: { keyframes: [{}, {}] },
      })],
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          fadeVisuals: {
            kind: 'fade-visuals',
            startX: 0,
            startY: 46,
            curves: new Float32Array([10, 46, 20, 0, 30, 0]),
            curveCount: 1,
            points: new Float32Array([0, 46, 30, 0]),
            pointCount: 2,
            isAudioClip: false,
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 14,
    });

    const fadeVisuals = result.message?.paintPayloads.fadeVisuals[0]?.resource;
    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(fadeVisuals?.curves).toBeInstanceOf(Float32Array);
    expect(fadeVisuals?.points).toBeInstanceOf(Float32Array);
    expect(Array.from(fadeVisuals?.curves ?? [])).toEqual([10, 46, 20, 0, 30, 0]);
    expect(Array.from(fadeVisuals?.points ?? [])).toEqual([0, 46, 30, 0]);
    expect(result.transferables).toEqual([
      fadeVisuals?.curves.buffer,
      fadeVisuals?.points.buffer,
    ]);
  });

  it('keeps fade clips on fallback when fade visuals are missing', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip({
        fade: { keyframes: [{}, {}] },
      })],
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: ['fade-visuals'],
    });
  });

  it('keeps composition clips on fallback when composition visuals are missing', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip({
        isComposition: true,
        compositionId: 'comp-1',
      })],
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: ['composition-visuals'],
    });
  });

  it('keeps persistent composition segment bitmaps on the main-thread path', () => {
    const bitmap = createBitmap();
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        isComposition: true,
        compositionId: 'comp-1',
        nestedClipBoundaries: [0.25, 0.75],
        clipSegments: [{ startNorm: 0, endNorm: 1, thumbnails: ['blob:thumb'] }],
        mixdownWaveform: [0, 0.5, -0.25, 0.75],
      })],
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          compositionVisuals: {
            kind: 'composition-visuals',
            outline: true,
            nestedBoundaries: [0.25, 0.75],
            segmentRects: [0, 1],
            segmentThumbnailStrip: {
              kind: 'thumbnail-strip',
              bitmap,
              x: 0,
              width: 48,
              height: 46,
              drawCount: 1,
            },
            mixdownWaveform: {
              kind: 'waveform',
              columns: [0, 0.5, 0.25, 0.5],
              columnCount: 1,
              mode: 'compact',
            },
            mixdownGenerating: true,
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 10,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 15,
    });

    expect(result.eligibility).toEqual({
      eligible: false,
      reasons: ['composition-segment-thumbnails'],
    });
    expect(result.message).toBeNull();
    expect(result.transferables).toEqual([]);
  });

  it('keeps active trim on fallback when trim visuals are missing for the active clip', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip()],
      hasClipTrim: true,
      activeTrimClipId: 'clip-1',
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: ['clip-trim-active'],
    });
  });

  it('allows resolved tool-drag geometry when required resources are prepared', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip()],
    });

    expect(eligibility).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('allows source-timed video clips when a thumbnail strip is prepared', () => {
    const bitmap = createBitmap();
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({
        source: { type: 'video', mediaFileId: 'media-1' },
        inPoint: 1,
        outPoint: 4,
        duration: 3,
      })],
      preparedResourcesByClipId: new Map([
        ['clip-1', {
          thumbnailStrip: {
            kind: 'thumbnail-strip',
            bitmap,
            x: 24,
            width: 36,
            height: 46,
            drawCount: 1,
          },
        }],
      ]),
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 0,
      dpr: 1,
      timeToPixel: (time) => time * 12,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
      requestId: 10,
    });

    expect(result.eligibility).toEqual({ eligible: true, reasons: [] });
    expect(result.message?.paintPayloads.thumbnailStrips[0]?.resource.bitmap).toBe(bitmap);
  });

  it('allows reversed video clips when thumbnail visuals are prepared', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip({
        source: { type: 'video', mediaFileId: 'media-1' },
        reversed: true,
      })],
      preparedThumbnailClipIds: new Set(['clip-1']),
    });

    expect(eligibility).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('keeps reversed video clips on source-timing fallback when thumbnail visuals are missing', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [createClip({
        source: { type: 'video', mediaFileId: 'media-1' },
        reversed: true,
      })],
    });

    expect(eligibility).toEqual({
      eligible: false,
      reasons: ['source-timing-visuals', 'thumbnail-visuals'],
    });
  });

  it('allows source-timed clips when no thumbnail-dependent visuals are present', () => {
    const eligibility = getTimelineClipCanvasWorkerEligibility({
      clips: [
        createClip({
          id: 'audio-trim',
          trackType: 'audio',
          source: { type: 'audio', naturalDuration: 10 },
          inPoint: 2,
          outPoint: 5,
          duration: 3,
        }),
        createClip({
          id: 'solid-trim',
          source: { type: 'solid' },
          inPoint: 1,
          outPoint: 3,
          duration: 2,
        }),
      ],
    });

    expect(eligibility).toEqual({
      eligible: true,
      reasons: [],
    });
  });

  it('does not build a draw message when worker eligibility fails', () => {
    const result = buildTimelineClipCanvasWorkerDrawMessage({
      clips: [createClip({ source: { type: 'video', mediaFileId: 'media-1' } })],
      height: 48,
      cssWidth: 200,
      canvasOffsetX: 0,
      dpr: 1,
      timeToPixel: (time) => time * 10,
      selectedClipIds: new Set(),
      hoveredClipId: null,
      trackColor: '#4c9aff',
    });

    expect(result.eligibility).toEqual({
      eligible: false,
      reasons: ['thumbnail-visuals'],
    });
    expect(result.message).toBeNull();
    expect(result.inputClipCount).toBe(1);
    expect(result.visibleClipCount).toBe(0);
  });
});
