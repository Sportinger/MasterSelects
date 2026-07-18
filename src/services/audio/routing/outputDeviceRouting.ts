type AudioContextWithSinkId = AudioContext & { setSinkId?: (sinkId: string) => Promise<void> };
type MediaElementWithSinkId = HTMLMediaElement & {
  setSinkId?: (sinkId: string) => Promise<void>;
  sinkId?: string;
};

type OutputDeviceErrorHandler = (message: string, error: unknown) => void;

export async function applyAudioContextOutputDevice(
  context: AudioContext,
  deviceId: string,
  onError: OutputDeviceErrorHandler,
): Promise<boolean> {
  const routedContext = context as AudioContextWithSinkId;
  if (typeof routedContext.setSinkId !== 'function') return false;
  try {
    await routedContext.setSinkId(deviceId);
    return true;
  } catch (error) {
    onError('Failed to apply AudioContext output device:', error);
    return false;
  }
}

// Concurrent setSinkId calls on the same element abort each other with an
// AbortError; route creation and device changes can race exactly like that.
// Coalesce in-flight switches per element and target device instead.
const pendingSinkSwitches = new WeakMap<HTMLMediaElement, Map<string, Promise<boolean>>>();

export async function applyMediaElementOutputDevice(
  element: HTMLMediaElement,
  deviceId: string,
  onError: OutputDeviceErrorHandler,
): Promise<boolean> {
  const routedElement = element as MediaElementWithSinkId;
  if (typeof routedElement.setSinkId !== 'function') return false;
  // Already routed to the requested device — a redundant setSinkId call would
  // only risk aborting a concurrent switch on the same element.
  if (typeof routedElement.sinkId === 'string' && routedElement.sinkId === deviceId) return true;

  let pendingByDevice = pendingSinkSwitches.get(element);
  const pending = pendingByDevice?.get(deviceId);
  if (pending) return pending;
  if (!pendingByDevice) {
    pendingByDevice = new Map();
    pendingSinkSwitches.set(element, pendingByDevice);
  }

  const attempt = (async () => {
    try {
      await routedElement.setSinkId!(deviceId);
      return true;
    } catch (error) {
      onError('Failed to apply media output device:', error);
      return false;
    } finally {
      pendingByDevice.delete(deviceId);
    }
  })();
  pendingByDevice.set(deviceId, attempt);
  return attempt;
}
