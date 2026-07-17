import { useEffect, useState } from 'react';
import type { LiveInputSource } from '../../../types/liveInput';

interface LiveInputDialogProps {
  activeComposition: { id: string; name: string } | null;
  onCreate: (source: LiveInputSource) => Promise<void>;
  onCancel: () => void;
}

type SourceKind = LiveInputSource['kind'];

const fieldStyle = {
  width: '100%',
  padding: '7px 8px',
  background: '#2a2a2a',
  border: '1px solid #444',
  borderRadius: '4px',
  color: '#fff',
} as const;

export function LiveInputDialog({ activeComposition, onCreate, onCancel }: LiveInputDialogProps) {
  const [kind, setKind] = useState<SourceKind>('display');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void navigator.mediaDevices?.enumerateDevices().then((allDevices) => {
      if (!cancelled) setDevices(allDevices.filter((device) => device.kind === 'videoinput'));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel, pending]);

  const submit = async () => {
    setPending(true);
    setError('');
    const device = devices.find((candidate) => candidate.deviceId === deviceId);
    const source: LiveInputSource = kind === 'display'
      ? { kind: 'display' }
      : kind === 'video-device'
        ? { kind: 'video-device', deviceId: deviceId || undefined, deviceLabel: device?.label || undefined }
        : { kind: 'composition-feedback', compositionId: activeComposition!.id };
    try {
      await onCreate(source);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The live source could not be opened.');
      setPending(false);
    }
  };

  return (
    <div
      role="presentation"
      onClick={() => { if (!pending) onCancel(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 10002, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.35)' }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-input-title"
        onClick={(event) => event.stopPropagation()}
        style={{ width: 380, maxWidth: 'calc(100vw - 32px)', padding: 20, borderRadius: 6, border: '1px solid #444', background: '#1e1e1e', boxShadow: '0 12px 36px rgba(0,0,0,.55)' }}
      >
        <h3 id="live-input-title" style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 500 }}>New Live Input</h3>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 11, color: '#aaa' }} htmlFor="live-input-kind">Source</label>
        <select id="live-input-kind" value={kind} onChange={(event) => setKind(event.target.value as SourceKind)} style={fieldStyle}>
          <option value="display">Screen, window, or browser tab</option>
          <option value="video-device">Camera or capture device</option>
          <option value="composition-feedback" disabled={!activeComposition}>Current composition feedback</option>
        </select>

        {kind === 'video-device' && (
          <>
            <label style={{ display: 'block', margin: '14px 0 6px', fontSize: 11, color: '#aaa' }} htmlFor="live-input-device">Device</label>
            <select id="live-input-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} style={fieldStyle}>
              <option value="">Default video device</option>
              {devices.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Video device ${index + 1}`}
                </option>
              ))}
            </select>
          </>
        )}

        {kind === 'composition-feedback' && activeComposition && (
          <p style={{ margin: '12px 0 0', color: '#aaa', fontSize: 12, lineHeight: 1.45 }}>
            Uses the previous preview frame of "{activeComposition.name}". Transform the clip to create feedback trails.
          </p>
        )}

        {error && <p role="alert" style={{ margin: '12px 0 0', color: '#ff7b7b', fontSize: 12 }}>{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" disabled={pending} onClick={onCancel} style={{ padding: '6px 14px', color: '#fff', background: '#2a2a2a', border: '1px solid #444', borderRadius: 4 }}>Cancel</button>
          <button type="button" disabled={pending || (kind === 'composition-feedback' && !activeComposition)} onClick={() => { void submit(); }} style={{ padding: '6px 14px', color: '#fff', background: '#4a90e2', border: 0, borderRadius: 4 }}>
            {pending ? 'Connecting...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
