import type { LiveInputSource } from '../../types/liveInput';
import { liveInputRuntime, type ConnectedLiveInput } from './liveInputRuntime';

function connectedTrack(connected: ConnectedLiveInput): MediaStreamTrack | undefined {
  const stream = connected.video.srcObject as MediaStream | null;
  return typeof stream?.getVideoTracks === 'function'
    ? stream.getVideoTracks()[0]
    : undefined;
}

export function resolveConnectedLiveInputSource(
  requestedSource: LiveInputSource,
  connected: ConnectedLiveInput,
): LiveInputSource {
  const connectedLabel = connected.label && connected.label !== 'Live Input'
    ? connected.label
    : undefined;

  if (requestedSource.kind === 'display') {
    return {
      kind: 'display',
      displayLabel: connectedLabel ?? requestedSource.displayLabel,
    };
  }

  if (requestedSource.kind === 'video-device') {
    return {
      kind: 'video-device',
      deviceId: connectedTrack(connected)?.getSettings?.().deviceId ?? requestedSource.deviceId,
      deviceLabel: connectedLabel ?? requestedSource.deviceLabel,
    };
  }

  return requestedSource;
}

export async function connectAndPersistLiveInput(
  id: string,
  source: LiveInputSource,
  persist: (id: string, source: LiveInputSource) => void,
): Promise<ConnectedLiveInput> {
  const connected = await liveInputRuntime.connect(id, source);
  persist(id, resolveConnectedLiveInputSource(source, connected));
  return connected;
}
