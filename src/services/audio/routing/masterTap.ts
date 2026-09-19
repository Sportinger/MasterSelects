interface PublishedMasterTerminal {
  context: AudioContext;
  terminalNode: AudioNode;
}

interface ActiveMasterTap {
  context: AudioContext;
  node: MediaStreamAudioDestinationNode;
  refCount: number;
}

let publishedMasterTerminal: PublishedMasterTerminal | null = null;
let activeMasterTap: ActiveMasterTap | null = null;
let masterTapActivator: (() => AudioContext) | null = null;

function stopTapTracks(tap: ActiveMasterTap): void {
  tap.node.stream.getTracks().forEach(track => track.stop());
}

function disconnectPublishedTerminal(tap: ActiveMasterTap): void {
  const published = publishedMasterTerminal;
  if (!published || published.context !== tap.context) return;
  try {
    published.terminalNode.disconnect(tap.node);
  } catch {
    // The route may already have been disconnected during a graph rebuild.
  }
}

export function setMasterTapActivator(activator: () => AudioContext): void {
  masterTapActivator = activator;
}

export function publishMasterTerminal(context: AudioContext, terminalNode: AudioNode): void {
  const previousTerminal = publishedMasterTerminal;
  publishedMasterTerminal = { context, terminalNode };

  const tap = activeMasterTap;
  if (!tap) return;

  if (tap.context !== context) {
    try {
      previousTerminal?.terminalNode.disconnect(tap.node);
    } catch {
      // The old context graph may already be torn down.
    }
    stopTapTracks(tap);
    activeMasterTap = null;
    return;
  }

  try {
    previousTerminal?.terminalNode.disconnect(tap.node);
  } catch {
    // The terminal may already have been disconnected during the rebuild.
  }
  terminalNode.connect(tap.node);
}

export function acquireMasterTapTrack(): { track: MediaStreamTrack; release(): void } | null {
  if (!masterTapActivator) return null;

  const context = masterTapActivator();
  const published = publishedMasterTerminal;
  if (!published || published.context !== context) {
    throw new Error('Master audio terminal was not published by the routing activator.');
  }

  if (!activeMasterTap) {
    const node = context.createMediaStreamDestination();
    published.terminalNode.connect(node);
    activeMasterTap = { context, node, refCount: 0 };
  }

  const tap = activeMasterTap;
  const track = tap.node.stream.getAudioTracks()[0];
  if (!track) {
    disconnectPublishedTerminal(tap);
    stopTapTracks(tap);
    activeMasterTap = null;
    throw new Error('Master audio tap did not expose an audio track.');
  }

  tap.refCount += 1;
  let released = false;
  return {
    track,
    release: () => {
      if (released) return;
      released = true;
      if (activeMasterTap !== tap) return;

      tap.refCount -= 1;
      if (tap.refCount > 0) return;

      disconnectPublishedTerminal(tap);
      try {
        tap.node.disconnect();
      } catch {
        // A destination node normally has no outputs, but cleanup stays best-effort.
      }
      stopTapTracks(tap);
      activeMasterTap = null;
    },
  };
}
