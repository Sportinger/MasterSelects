import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupExportMode, prepareClipsForExport } from '../../src/engine/export/ClipPreparation';
import { buildNestedLayersForExport } from '../../src/engine/export/layerBuilder/nestedLayers';
import { collectNestedVideoClips } from '../../src/engine/export/clipPreparation/nestedVideoClips';
import type { ExportSettings } from '../../src/engine/export/types';
import type { Layer } from '../../src/types/layers';
import type { TimelineClip, TimelineTrack } from '../../src/stores/timeline/types';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { mediaRuntimeRegistry } from '../../src/services/mediaRuntime/registry';
import { timelineRuntimeCoordinator } from '../../src/services/timeline/timelineRuntimeCoordinator';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const settings: ExportSettings = {
  width: 1920, height: 1080, fps: 30, codec: 'h264', container: 'mp4',
  bitrate: 8_000_000, startTime: 0.5, endTime: 3.2,
};

function track(id = 'video'): TimelineTrack {
  return { id, name: id, type: 'video', visible: true, muted: false, solo: false } as TimelineTrack;
}

function clip(id: string, overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id, name: id, trackId: 'video', startTime: 0, duration: 300, inPoint: 0, outPoint: 300,
    source: { type: 'video', mediaFileId: 'media-stripe' }, mediaFileId: 'media-stripe',
    transform: structuredClone(DEFAULT_TRANSFORM), effects: [], isLoading: false,
    ...overrides,
  };
}

function composition(id: string, nestedClips: TimelineClip[], overrides: Partial<TimelineClip> = {}): TimelineClip {
  return clip(id, {
    file: new File([], `${id}.composition`), mediaFileId: undefined,
    source: { type: 'video' }, isComposition: true, compositionId: id,
    nestedClips, nestedTracks: [track()], ...overrides,
  });
}

function lastVideoLayer(layer: Layer): Layer {
  const child = layer.source.nestedComposition?.layers[0];
  return child ? lastVideoLayer(child) : layer;
}

describe('PRECISE nested export range preparation', () => {
  let createdVideos: HTMLVideoElement[];
  let mediaFile: MediaFile;

  beforeEach(() => {
    timelineRuntimeCoordinator.clearResources();
    useTimelineStore.setState({ ...initialTimelineState, clipKeyframes: new Map() });
    mediaFile = {
      id: 'media-stripe', name: 'stripe.mp4', type: 'video', duration: 300,
      file: new File(['video'], 'stripe.mp4', { type: 'video/mp4' }),
    } as MediaFile;
    vi.mocked(useMediaStore.getState).mockReturnValue({ ...initialMediaState, files: [mediaFile] });
    createdVideos = [];
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options);
      if (tag === 'video') {
        Object.defineProperties(element, {
          readyState: { configurable: true, value: HTMLMediaElement.HAVE_ENOUGH_DATA },
          duration: { configurable: true, value: 300 },
          seeking: { configurable: true, value: false },
          currentTime: { configurable: true, writable: true, value: 0 },
          load: { configurable: true, value: vi.fn() },
          pause: { configurable: true, value: vi.fn() },
        });
        createdVideos.push(element as HTMLVideoElement);
      }
      return element;
    }) as typeof document.createElement);
    let nextUrl = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:export-${nextUrl++}`);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    timelineRuntimeCoordinator.clearResources();
    vi.restoreAllMocks();
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue(initialMediaState);
  });

  it('prepares only reachable split descendants and renders both sides using owned export videos', async () => {
    const innerSplit = 2.766666666666639;
    const outerSplit = 26 / 30;
    const outerSourceSplit = 0.8727257702515707;
    const makeRoot = (id: string, startTime: number, inPoint: number, duration: number) => composition(id, [
      // These eleven sources are present in both loaded composition instances,
      // but none can contribute to the requested 0.5–3.2 second export.
      ...Array.from({ length: 11 }, (_, index) => clip(`${id}-unused-${index}`, {
        startTime: 100 + index * 3, duration: 3, outPoint: 3,
      })),
      composition(`${id}-inner-a`, [clip(`${id}-stripe-a`)], {
        duration: innerSplit, outPoint: innerSplit,
      }),
      composition(`${id}-inner-b`, [clip(`${id}-stripe-b`)], {
        startTime: innerSplit, duration: 300 - innerSplit, inPoint: innerSplit,
      }),
    ], { startTime, inPoint, duration, outPoint: inPoint + duration });
    const rootA = makeRoot('root-a', 0, 0, outerSplit);
    const rootB = makeRoot('root-b', outerSplit, outerSourceSplit, 539.1);
    useTimelineStore.setState({ tracks: [track()], clips: [rootA, rootB] });
    expect([rootA, rootB].flatMap(root => collectNestedVideoClips(root))).toHaveLength(26);

    const prepared = await prepareClipsForExport(settings, 'precise', 'nested-range-run');
    expect([...prepared.clipStates.keys()]).toEqual(['root-a-stripe-a', 'root-b-stripe-a', 'root-b-stripe-b']);
    expect(createdVideos).toHaveLength(3);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(3);
    for (const [file] of vi.mocked(URL.createObjectURL).mock.calls) expect(file).toBe(mediaFile.file);

    for (const [time, root, leafId] of [
      [0.75, rootA, 'root-a-stripe-a'],
      [0.9, rootB, 'root-b-stripe-a'],
      [2.82, rootB, 'root-b-stripe-b'],
    ] as const) {
      const nestedTime = time - root.startTime + root.inPoint;
      const layers = buildNestedLayersForExport(
        root, nestedTime, time, prepared.clipStates, null, false, [mediaFile], [],
      );
      expect(layers).toHaveLength(1);
      const leaf = lastVideoLayer(layers[0]);
      expect(leaf.source.videoElement).toBe(prepared.clipStates.get(leafId)?.preciseVideoElement);
      expect(leaf.source.mediaTime).toBeCloseTo(nestedTime, 12);
    }
    expect(rootB.nestedClips?.at(-1)?.nestedClips?.[0].source?.videoElement).toBeUndefined();

    cleanupExportMode(prepared.clipStates, prepared.parallelDecoder);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    expect(createdVideos.every(video => !video.hasAttribute('src'))).toBe(true);
  });

  it('fails admission before encoding and cleans all prepared videos and the failing runtime owner', async () => {
    const leaves = Array.from({ length: 25 }, (_, index) => clip(`visible-${index}`, {
      trackId: `track-${index}`,
    }));
    const root = composition('root', leaves, {
      nestedTracks: leaves.map(leaf => track(leaf.trackId)),
    });
    useTimelineStore.setState({ tracks: [track()], clips: [root] });
    const releaseRuntime = vi.spyOn(mediaRuntimeRegistry, 'releaseRuntime');

    await expect(prepareClipsForExport(settings, 'precise', 'nested-budget-run')).rejects.toThrow(
      /Export preparation refused PRECISE video element for "visible-24"/,
    );

    expect(createdVideos).toHaveLength(24);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(24);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(24);
    expect(createdVideos.every(video => !video.hasAttribute('src'))).toBe(true);
    expect(releaseRuntime).toHaveBeenCalledWith(expect.any(String), 'export:visible-24');
    expect(new Set(releaseRuntime.mock.calls.map(([, owner]) => owner)).size).toBe(25);
  });
});
