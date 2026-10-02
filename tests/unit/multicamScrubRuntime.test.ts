import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CompositionMulticam } from '../../src/types/multicam';
import type { TimelineClip } from '../../src/types/timeline';
import type { Layer } from '../../src/types/layers';

const state = vi.hoisted(() => ({ providers: new Map<string, any>() }));
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: { getState: () => ({
  files: ['one', 'two'].map(id => ({ id, file: new File([], `${id}.mxf`), duration: 100 })),
}) } }));
vi.mock('../../src/services/mediaRuntime/clipBindings', () => ({
  bindSourceRuntimeForOwner: ({ source }: any) => ({ ...source, runtimeSourceId: source.mediaFileId, runtimeSessionKey: 'clip' }),
}));
vi.mock('../../src/services/mediaRuntime/registry', () => ({ mediaRuntimeRegistry: { releaseRuntime: vi.fn() } }));
vi.mock('../../src/services/mediaRuntime/runtimePlayback', () => ({
  isProviderBackedRuntimeSource: () => true,
  getPreviewRuntimeSource: (source: any) => ({ ...source, runtimeSessionKey: `track:${source.runtimeSourceId}` }),
  getRuntimeFrameProvider: (source: any) => source?.webCodecsPlayer ?? state.providers.get(source?.runtimeSessionKey),
  updateRuntimePlaybackTime: vi.fn(), ensureRuntimeFrameProvider: vi.fn(),
}));
import { getMulticamAngleLayer, releaseMulticamAngles, syncMulticamAngles } from '../../src/services/multicam/multicamAngleRuntime';

function setup() {
  const provider = () => ({ currentTime: 0, isPlaying: false, seek: vi.fn(), pause: vi.fn(), advanceToTime: vi.fn() });
  const one = provider(); const two = provider(); const scrub = provider();
  state.providers.set('track:one', one); state.providers.set('track:two', two);
  const multicam = { version: 1, active: true, groupId: 'g', angles: ['one', 'two'].map(id => ({
    trackId: id, label: id, sources: [{ mediaFileId: id, startTime: 0, duration: 100, inPoint: 0,
      template: { name: id, effects: [], transform: { position: { x: 0, y: 0 }, scale: { x: 1, y: 1 }, rotation: {} } },
    }],
  })) } as unknown as CompositionMulticam;
  const clip = { id: 'program', trackId: 'one', startTime: 0, duration: 100,
    source: { type: 'video', mediaFileId: 'one', runtimeSourceId: 'one' },
  } as TimelineClip;
  const layer = { sourceClipId: clip.id, visible: true, opacity: 1,
    source: { type: 'video', runtimeSourceId: 'one', runtimeSessionKey: 'scrub:one', mediaTime: 10, webCodecsPlayer: scrub },
  } as unknown as Layer;
  const args = { compositionId: 'comp', multicam, time: 10, isPlaying: false, isDragging: false, programClips: [clip], programLayers: [layer] };
  return { one, two, scrub, args };
}
afterEach(() => { releaseMulticamAngles(); state.providers.clear(); vi.restoreAllMocks(); });

describe('multicam scrub decoder ownership', () => {
  it('borrows the current program scrub frame without seeking a second decoder', () => {
    const { args, one, two, scrub } = setup();
    syncMulticamAngles(args);
    expect(one.seek).not.toHaveBeenCalled();
    expect(two.seek).toHaveBeenCalledWith(10);
    expect(getMulticamAngleLayer('comp', args.multicam, 0, 10)?.source?.webCodecsPlayer).toBe(scrub);
  });
  it('holds off-air seeks through a long pointer stall and catches up on release', () => {
    const { args, one, two } = setup();
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    syncMulticamAngles({ ...args, isDragging: true });
    now.mockReturnValue(1000);
    syncMulticamAngles({ ...args, isDragging: true });
    expect(one.seek).not.toHaveBeenCalled();
    expect(two.seek).not.toHaveBeenCalled();
    syncMulticamAngles(args);
    expect(two.seek).toHaveBeenCalledOnce();
  });
  it('shares the program source when its frame-grid time differs from the pointer time', () => {
    const { args, one, scrub } = setup();
    syncMulticamAngles({ ...args, time: 10.03, frameDurationSeconds: 1 / 25 });
    expect(one.seek).not.toHaveBeenCalled();
    expect(getMulticamAngleLayer('comp', args.multicam, 0, 10.03)?.source?.webCodecsPlayer).toBe(scrub);
  });
  it('waits for a late main snapshot but independently seeks a retimed camera', () => {
    const { args, one } = setup();
    syncMulticamAngles({ ...args, programLayers: undefined });
    expect(one.seek).not.toHaveBeenCalled();
    syncMulticamAngles({ ...args, programLayers: [{ ...args.programLayers[0], source: { ...args.programLayers[0].source!, mediaTime: 20 } }] });
    expect(one.seek).toHaveBeenCalledWith(10);
  });
});
