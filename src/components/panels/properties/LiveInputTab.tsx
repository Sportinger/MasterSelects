import { useEffect, useState, useSyncExternalStore } from 'react';
import { liveInputRuntime } from '../../../services/mediaRuntime/liveInputRuntime';
import { isLiveInputUsedOutsideComposition } from '../../../services/liveInputTimeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { LiveInputSource } from '../../../types/liveInput';
import './LiveInputTab.css';

interface LiveInputTabProps {
  clipId?: string | null;
}

type SourceKind = LiveInputSource['kind'];

function sourceLabel(source: LiveInputSource): string {
  if (source.kind === 'display') return 'Screen, window, or browser tab';
  if (source.kind === 'video-device') return source.deviceLabel || 'Camera or capture device';
  return 'Composition feedback';
}

function useLiveInputRuntimeRevision(): number {
  return useSyncExternalStore(
    (listener) => liveInputRuntime.subscribe(listener),
    () => liveInputRuntime.getRevision(),
    () => 0,
  );
}

export function LiveInputTab({ clipId = null }: LiveInputTabProps) {
  const clips = useTimelineStore((state) => state.clips);
  const files = useMediaStore((state) => state.files);
  const compositions = useMediaStore((state) => state.compositions);
  const activeCompositionId = useMediaStore((state) => state.activeCompositionId);
  const updateLiveInputSource = useMediaStore((state) => state.updateLiveInputSource);
  useLiveInputRuntimeRevision();

  const clip = clipId ? clips.find((candidate) => candidate.id === clipId) : null;
  const liveInputId = clip?.source?.liveInputId ?? null;
  const item = liveInputId ? files.find((candidate) => candidate.id === liveInputId) ?? null : null;
  const activeComposition = compositions.find((candidate) => candidate.id === activeCompositionId) ?? null;
  const reconnectRequiredIds = liveInputRuntime.getReconnectRequiredIds();
  const reconnectItems = reconnectRequiredIds.flatMap((id) => {
    const file = files.find((candidate) => candidate.id === id);
    return file?.liveInput ? [file] : [];
  });

  const [kind, setKind] = useState<SourceKind>(item?.liveInput?.kind ?? 'display');
  const [deviceId, setDeviceId] = useState(item?.liveInput?.kind === 'video-device' ? item.liveInput.deviceId ?? '' : '');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!item?.liveInput) return;
    setKind(item.liveInput.kind);
    setDeviceId(item.liveInput.kind === 'video-device' ? item.liveInput.deviceId ?? '' : '');
    setError('');
  }, [item?.id, item?.liveInput]);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let active = true;
    const refresh = () => {
      void mediaDevices.enumerateDevices().then((availableDevices) => {
        if (active) setDevices(availableDevices.filter((device) => device.kind === 'videoinput'));
      }).catch(() => undefined);
    };
    refresh();
    mediaDevices.addEventListener?.('devicechange', refresh);
    return () => {
      active = false;
      mediaDevices.removeEventListener?.('devicechange', refresh);
    };
  }, []);

  const connect = async (id: string, source: LiveInputSource, persistSource: boolean) => {
    setConnectingId(id);
    setError('');
    try {
      await liveInputRuntime.connect(id, source);
      if (persistSource) updateLiveInputSource(id, source);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The live source could not be opened.');
    } finally {
      setConnectingId(null);
    }
  };

  const applySelectedSource = () => {
    if (!item?.liveInput) return;
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    const source: LiveInputSource | null = kind === 'display'
      ? { kind: 'display' }
      : kind === 'video-device'
        ? { kind: 'video-device', deviceId: deviceId || undefined, deviceLabel: device?.label || undefined }
        : activeComposition
          ? { kind: 'composition-feedback', compositionId: activeComposition.id }
          : null;
    if (!source) {
      setError('Open a composition before selecting composition feedback.');
      return;
    }
    if (
      source.kind === 'composition-feedback' &&
      isLiveInputUsedOutsideComposition(item.id, source.compositionId, activeCompositionId, clips, compositions)
    ) {
      setError('This Live Input is also used in another composition. Duplicate the Media Panel item before binding it to composition feedback.');
      return;
    }
    void connect(item.id, source, true);
  };

  return (
    <div className="live-input-tab">
      {reconnectItems.length > 0 && (
        <section className="properties-section live-input-reconnect-section">
          <h4>Reconnect after project load</h4>
          <p className="live-input-help">
            Browser capture permissions do not survive a reload. Reconnect each source used on a timeline.
          </p>
          <div className="live-input-reconnect-list">
            {reconnectItems.map((reconnectItem) => (
              <div className="live-input-reconnect-row" key={reconnectItem.id}>
                <div>
                  <strong>{reconnectItem.name}</strong>
                  <span>{sourceLabel(reconnectItem.liveInput!)}</span>
                </div>
                <button
                  type="button"
                  disabled={connectingId !== null}
                  onClick={() => { void connect(reconnectItem.id, reconnectItem.liveInput!, false); }}
                >
                  {connectingId === reconnectItem.id ? 'Connecting…' : 'Reconnect'}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {item?.liveInput ? (
        <section className="properties-section">
          <div className="live-input-heading">
            <div>
              <h4>Source</h4>
              <strong>{item.name}</strong>
            </div>
            <span className={liveInputRuntime.getVideoElement(item.id) ? 'connected' : 'disconnected'}>
              {liveInputRuntime.getVideoElement(item.id) ? 'Connected' : 'Disconnected'}
            </span>
          </div>

          <label className="live-input-field" htmlFor={`live-input-kind-${item.id}`}>
            <span>Input</span>
            <select
              id={`live-input-kind-${item.id}`}
              value={kind}
              onChange={(event) => setKind(event.target.value as SourceKind)}
            >
              <option value="display">Screen, window, or browser tab</option>
              <option value="video-device">Camera or capture device</option>
              <option value="composition-feedback" disabled={!activeComposition}>Current composition feedback</option>
            </select>
          </label>

          {kind === 'video-device' && (
            <label className="live-input-field" htmlFor={`live-input-device-${item.id}`}>
              <span>Device</span>
              <select
                id={`live-input-device-${item.id}`}
                value={deviceId}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                <option value="">Default video device</option>
                {devices.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Video device ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}

          {kind === 'composition-feedback' && activeComposition && (
            <p className="live-input-help">
              Uses the previous preview frame of “{activeComposition.name}” and applies this source to every clip using the Media Panel item.
            </p>
          )}

          <button
            className="live-input-primary-button"
            type="button"
            disabled={connectingId !== null || (kind === 'composition-feedback' && !activeComposition)}
            onClick={applySelectedSource}
          >
            {connectingId === item.id ? 'Connecting…' : 'Apply & Connect'}
          </button>
        </section>
      ) : reconnectItems.length === 0 ? (
        <div className="panel-empty"><p>Select a Live Input clip to configure its source</p></div>
      ) : null}

      {error && <p className="live-input-error" role="alert">{error}</p>}
    </div>
  );
}
