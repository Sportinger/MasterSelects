import { beforeEach, describe, expect, it, vi } from 'vitest';

type FakeTrack = MediaStreamTrack;

type FakeDestination = MediaStreamAudioDestinationNode & {
  track: FakeTrack;
};

function createTrack(): FakeTrack {
  return { stop: vi.fn() } as unknown as FakeTrack;
}

function createDestination(): FakeDestination {
  const track = createTrack();
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    stream: {
      getAudioTracks: () => [track],
      getTracks: () => [track],
    } as unknown as MediaStream,
    track,
  } as unknown as FakeDestination;
}

function createContext() {
  const destinations: FakeDestination[] = [];
  const context = {
    createMediaStreamDestination: vi.fn(() => {
      const destination = createDestination();
      destinations.push(destination);
      return destination;
    }),
  } as unknown as AudioContext;
  return { context, destinations };
}

function createTerminal(): AudioNode & {
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
} {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as AudioNode & {
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
  };
}

async function loadModule() {
  vi.resetModules();
  return import('../../audio/routing/masterTap');
}

describe('masterTap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates and connects a tap on acquire', async () => {
    const masterTap = await loadModule();
    const { context, destinations } = createContext();
    const terminal = createTerminal();
    masterTap.setMasterTapActivator(() => {
      masterTap.publishMasterTerminal(context, terminal);
      return context;
    });

    const acquisition = masterTap.acquireMasterTapTrack();

    expect(acquisition?.track).toBe(destinations[0].track);
    expect(context.createMediaStreamDestination).toHaveBeenCalledOnce();
    expect(terminal.connect).toHaveBeenCalledWith(destinations[0]);
  });

  it('reconnects the same active tap node when the master route is rebuilt', async () => {
    const masterTap = await loadModule();
    const { context, destinations } = createContext();
    const firstTerminal = createTerminal();
    const rebuiltTerminal = createTerminal();
    masterTap.setMasterTapActivator(() => {
      masterTap.publishMasterTerminal(context, firstTerminal);
      return context;
    });
    masterTap.acquireMasterTapTrack();

    masterTap.publishMasterTerminal(context, rebuiltTerminal);

    expect(firstTerminal.disconnect).toHaveBeenCalledWith(destinations[0]);
    expect(rebuiltTerminal.connect).toHaveBeenCalledWith(destinations[0]);
    expect(context.createMediaStreamDestination).toHaveBeenCalledOnce();
  });

  it('drops a stale tap on context swap and creates a fresh one', async () => {
    const masterTap = await loadModule();
    const first = createContext();
    const second = createContext();
    const firstTerminal = createTerminal();
    const secondTerminal = createTerminal();
    masterTap.setMasterTapActivator(() => {
      masterTap.publishMasterTerminal(first.context, firstTerminal);
      return first.context;
    });
    const staleAcquisition = masterTap.acquireMasterTapTrack();

    masterTap.publishMasterTerminal(second.context, secondTerminal);

    expect(first.destinations[0].track.stop).toHaveBeenCalledOnce();
    expect(firstTerminal.disconnect).toHaveBeenCalledWith(first.destinations[0]);

    masterTap.setMasterTapActivator(() => second.context);
    const freshAcquisition = masterTap.acquireMasterTapTrack();
    expect(freshAcquisition?.track).toBe(second.destinations[0].track);
    expect(secondTerminal.connect).toHaveBeenCalledWith(second.destinations[0]);

    staleAcquisition?.release();
    expect(second.destinations[0].track.stop).not.toHaveBeenCalled();
  });

  it('disconnects and stops tracks at refcount zero with idempotent release', async () => {
    const masterTap = await loadModule();
    const { context, destinations } = createContext();
    const terminal = createTerminal();
    masterTap.setMasterTapActivator(() => {
      masterTap.publishMasterTerminal(context, terminal);
      return context;
    });
    const first = masterTap.acquireMasterTapTrack();
    const second = masterTap.acquireMasterTapTrack();
    terminal.disconnect.mockClear();

    first?.release();
    first?.release();
    expect(terminal.disconnect).not.toHaveBeenCalled();
    expect(destinations[0].track.stop).not.toHaveBeenCalled();

    second?.release();
    second?.release();
    expect(terminal.disconnect).toHaveBeenCalledTimes(1);
    expect(terminal.disconnect).toHaveBeenCalledWith(destinations[0]);
    expect(destinations[0].disconnect).toHaveBeenCalledOnce();
    expect(destinations[0].track.stop).toHaveBeenCalledOnce();
  });
});
