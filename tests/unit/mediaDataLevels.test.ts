// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const reset = vi.hoisted(() => vi.fn(() => 1));
vi.mock('../../src/services/mediaRuntime/registry', () => ({ mediaRuntimeRegistry: { resetMediaDecoders: reset } }));
vi.mock('../../src/services/render/renderHostPort', () => ({ renderHostPort: { requestNewFrameRender: vi.fn() } }));
vi.mock('../../src/stores/historyStore', () => ({ captureSnapshot: vi.fn() }));
// Minimal media store with subscribeWithSelector semantics; only the files matter here.
const media = vi.hoisted(() => {
  let state = { files: [] as unknown[] };
  const listeners = new Set<(s: typeof state, p: typeof state) => void>();
  const store = {
    getState: () => state,
    setState: (patch: unknown) => {
      const prev = state;
      const next = typeof patch === 'function' ? (patch as (s: typeof state) => object)(state) : patch;
      state = { ...state, ...(next as object) };
      listeners.forEach(listener => listener(state, prev));
    },
    subscribe: (selector: (s: typeof state) => unknown, listener: (v: unknown) => void) => {
      const wrapped = (s: typeof state, p: typeof state) => { if (selector(s) !== selector(p)) listener(selector(s)); };
      listeners.add(wrapped);
      return () => listeners.delete(wrapped);
    },
  };
  return { store };
});
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: media.store }));

import type { MediaFile } from '../../src/stores/mediaStore';
import { mediaDecodesFullRange, setMediaDataLevels, supportsDataLevelsOverride } from '../../src/services/mediaRuntime/mediaDataLevels';
import { createAvcDecoderConfig } from '../../src/services/mediaRuntime/mxf/webCodecsGopDecoder';
import { createLibavOpenRequest } from '../../src/services/mediaRuntime/mxf/MxfLibavFrameProvider';
import { convertMediaFiles } from '../../src/services/project/projectMediaSerialization';
import { splitNestedDomain } from '../../src/services/project/repository/domains/nestedOwnership';

const camera = { id: 'jonas', name: 'Jonas1.MXF', type: 'video', videoCodecId: 'mxf:avc-lgop', parentId: null, createdAt: 1, url: '', duration: 900 } as unknown as MediaFile;
const useMediaStore = media.store as unknown as { getState(): { files: MediaFile[] }; setState(patch: object): void };
afterEach(() => { reset.mockClear(); vi.unstubAllGlobals(); });

describe('media data levels (superwhites)', () => {
  it('switches an MXF camera file to full range, re-creates its decoders and persists the choice', () => {
    useMediaStore.setState({ files: [camera, { ...camera, id: 'mp4', videoCodecId: 'avc1' } as MediaFile] });
    expect(supportsDataLevelsOverride(useMediaStore.getState().files[1])).toBe(false);
    expect(setMediaDataLevels('mp4', 'full')).toBe(false);

    expect(setMediaDataLevels('jonas', 'full')).toBe(true);
    expect(mediaDecodesFullRange('jonas')).toBe(true);
    expect(reset).toHaveBeenCalledWith('jonas');

    const [persisted] = convertMediaFiles([useMediaStore.getState().files[0]!]);
    expect(persisted!.dataLevels).toBe('full');
    expect(splitNestedDomain(persisted as never, 'ProjectMediaFile').content).toMatchObject({ dataLevels: 'full' });

    expect(setMediaDataLevels('jonas', 'video')).toBe(true);
    expect(mediaDecodesFullRange('jonas')).toBe(false);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('hands the decoders a full-range color space', async () => {
    vi.stubGlobal('VideoDecoder', { isConfigSupported: async (config: VideoDecoderConfig) => ({ supported: true, config: { codec: config.codec } }) });
    const key = new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x33, 0xac]);
    const source = {
      metadata: { width: 3840, height: 2160, codedWidth: 3840, codedHeight: 2160 },
      keyframeStoredIndexFor: () => 0,
      getPacketByStoredIndex: async () => ({ data: key }),
    };
    expect((await createAvcDecoderConfig(source as never)).colorSpace).toBeUndefined();
    expect((await createAvcDecoderConfig(source as never, true)).colorSpace).toEqual({ primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true });

    const mxf = { mxf: { video: { width: 1920, height: 1080, codedHeight: 1080, displayYOffset: 0, fps: 25 } } };
    expect(createLibavOpenRequest(mxf as never, 'dnxhd', false, true).fullRange).toBe(true);
    expect(createLibavOpenRequest(mxf as never, 'dnxhd', false).fullRange).toBe(false);
  });
});
