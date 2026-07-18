import { useEffect, useState } from 'react';
import { screenCaptureService } from '../../../services/capture/ScreenCaptureService';
import type { CaptureRecoveryEntry } from '../../../services/capture/recording/recoveryPersistence';
import type { CaptureSessionSnapshot } from '../../../services/capture/recording/sessionTypes';

interface CaptureControlsProps {
  snapshot: CaptureSessionSnapshot;
  busy: boolean;
  error: string | null;
  resultMessage: string | null;
  estimatedBytesPerSecond: number;
  recoveryEntries: CaptureRecoveryEntry[];
  onStart(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onCancelPreview(): void;
  onRestore(sessionId: string): void;
  onDismiss(sessionId: string): void;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60).toString().padStart(2, '0')}:${(total % 60).toString().padStart(2, '0')}`;
}

export function CaptureControls(props: CaptureControlsProps) {
  const [elapsed, setElapsed] = useState(props.snapshot.elapsedSeconds);
  const [levels, setLevels] = useState(() => screenCaptureService.getAudioLevels());
  useEffect(() => {
    if (props.snapshot.phase !== 'recording') return;
    const update = () => setElapsed(screenCaptureService.getSnapshot().elapsedSeconds);
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 250);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [props.snapshot.phase]);
  useEffect(() => {
    if (props.snapshot.phase !== 'recording' && props.snapshot.phase !== 'paused') return;
    const update = () => setLevels(screenCaptureService.getAudioLevels());
    const frame = window.requestAnimationFrame(update);
    const timer = window.setInterval(update, 100);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, [props.snapshot.phase]);
  const displayedElapsed = props.snapshot.phase === 'recording' ? elapsed : props.snapshot.elapsedSeconds;
  const displayedLevels = props.snapshot.phase === 'recording' || props.snapshot.phase === 'paused'
    ? levels
    : { display: 0, microphone: 0 };
  const estimatedMb = displayedElapsed * props.estimatedBytesPerSecond / (1024 * 1024);

  return (
    <div className="capture-controls">
      <div className="capture-status-strip">
        <div><small>Duration</small><strong>{formatTime(displayedElapsed)}</strong></div>
        <div><small>Estimated size</small><strong>~{estimatedMb.toFixed(1)} MB</strong></div>
        <div><small>Dropped frames</small><strong>{props.snapshot.droppedFrames}</strong></div>
      </div>
      {(props.snapshot.hasDisplayAudio || props.snapshot.hasMicrophoneAudio) && (
        <div className="capture-meters">
          {props.snapshot.hasDisplayAudio && <label><span>Source</span><meter min={0} max={1} value={displayedLevels.display} /></label>}
          {props.snapshot.hasMicrophoneAudio && <label><span>Mic</span><meter min={0} max={1} value={displayedLevels.microphone} /></label>}
        </div>
      )}
      <div className="capture-action-row">
        {props.snapshot.phase === 'previewing' && <button className="btn btn-active" type="button" onClick={props.onStart} disabled={props.busy}><span className="capture-record-dot" />Record</button>}
        {props.snapshot.phase === 'previewing' && <button className="btn" type="button" onClick={props.onCancelPreview} disabled={props.busy}>Release source</button>}
        {props.snapshot.phase === 'recording' && <button className="btn" type="button" onClick={props.onPause} disabled={props.busy}>Pause</button>}
        {props.snapshot.phase === 'paused' && <button className="btn btn-active" type="button" onClick={props.onResume} disabled={props.busy}>Resume</button>}
        {(props.snapshot.phase === 'recording' || props.snapshot.phase === 'paused') && (
          <button className="btn btn-danger" type="button" onClick={props.onStop} disabled={props.busy}>Stop &amp; import</button>
        )}
        {props.snapshot.phase === 'requesting-source' && <span className="capture-progress-label">Waiting for the browser picker…</span>}
        {props.snapshot.phase === 'stopping' && <span className="capture-progress-label">Finalizing recording…</span>}
      </div>
      {props.error && <div role="alert" className="capture-notice capture-notice-error">{props.error}</div>}
      {props.resultMessage && <div role="status" className="capture-notice capture-notice-success">{props.resultMessage}</div>}
      {props.snapshot.storageWarnings.map(warning => (
        <div key={warning.code} className="capture-notice capture-notice-warning">{warning.message}</div>
      ))}
      {props.recoveryEntries.length > 0 && (
        <section className="capture-recovery">
          <strong>Unfinished recordings</strong>
          <p>WebCodecs MP4 recovery uses a fragmented playable prefix. MediaRecorder recovery is best-effort and may be shorter.</p>
          {props.recoveryEntries.map(entry => (
            <div key={entry.sessionId} className="capture-recovery-row">
              <span>{new Date(entry.startedAt).toLocaleString()} · {entry.chunks.length} {entry.tier === 'webcodecs' ? 'runs' : 'chunks'} · {entry.tier === 'webcodecs' ? 'fragmented MP4' : 'best-effort'}</span>
              <span>
                {entry.chunks.length > 0 && (entry.tier === 'media-recorder' || entry.recoverable) && (
                  <button className="btn btn-active btn-sm" type="button" onClick={() => props.onRestore(entry.sessionId)} disabled={props.busy}>Restore</button>
                )}
                <button className="btn btn-sm" type="button" onClick={() => props.onDismiss(entry.sessionId)} disabled={props.busy}>Dismiss</button>
              </span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
