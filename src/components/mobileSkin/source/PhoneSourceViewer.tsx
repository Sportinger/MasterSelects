// The source itself: the picture (video, image) or sound (audio) of one library file, play/pause, a
// frame step back and forward, a scrubber, and the In/Out marks as frames (tap at the shown frame, or
// type the frame number). Marks are written to the editor's source-monitor state right away; they are
// view state of the source monitor, not project edits, so they never enter the undo history.
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { HandleOnlyRange } from '../../panels/properties/transformTab/HandleOnlyRange';
import { useMediaStore } from '../../../stores/mediaStore';
import type { MediaFile } from '../../../stores/mediaStore/types';
import {
  clampPhoneSourceMark, describePhoneSourceRange, formatPhoneSourceTime, phoneSourceFps, phoneSourceFrameAt,
  phoneSourceFrameCount, phoneSourceMarkTimes, phoneSourceMarksFromTimes, phoneSourceSeekTime, type PhoneSourceMarks,
} from './phoneSourceModel';
import { PHONE_SOURCE_TEST_IDS as IDS } from './phoneSourceTestIds';

type PlayableElement = HTMLVideoElement | HTMLAudioElement;

function MarkField({ testId, label, value, max, onCommit }: {
  testId: string; label: string; value: number | null; max: number; onCommit: (frame: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = Number.parseInt(draft, 10);
    setDraft(null);
    if (Number.isFinite(parsed)) onCommit(parsed);
  };
  return (
    <label className="phone-source__mark-field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={0} max={max} data-testid={testId} enterKeyHint="done"
        value={draft ?? (value === null ? '' : String(value))} placeholder="–"
        onChange={(event: ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }} />
    </label>
  );
}

export function PhoneSourceViewer({ file }: { file: MediaFile }) {
  const inPoint = useMediaStore((state) => state.sourceMonitorInPoint);
  const outPoint = useMediaStore((state) => state.sourceMonitorOutPoint);
  const mediaRef = useRef<PlayableElement | null>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const fps = phoneSourceFps(file.fps);
  const playable = file.type === 'video' || file.type === 'audio';
  const frameCount = playable ? phoneSourceFrameCount(file.duration, fps) : 0;
  const frame = Math.min(Math.max(0, frameCount - 1), phoneSourceFrameAt(time, fps));
  const marks = phoneSourceMarksFromTimes(inPoint, outPoint, fps);

  const writeMarks = (next: PhoneSourceMarks) => {
    const times = phoneSourceMarkTimes(next, fps);
    const store = useMediaStore.getState();
    // The marks already keep In <= Out, so In then Out lands exactly on both values.
    store.setSourceMonitorInPoint(times.inPoint);
    store.setSourceMonitorOutPoint(times.outPoint);
  };

  // Follow the element while it plays; one rAF loop, stopped on pause/unmount.
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    const tick = () => {
      const element = mediaRef.current;
      if (element) setTime(element.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => () => { mediaRef.current?.pause(); }, []);

  const seekFrame = useCallback((target: number) => {
    const element = mediaRef.current;
    const clamped = Math.min(Math.max(0, frameCount - 1), Math.max(0, Math.round(target)));
    const seconds = phoneSourceSeekTime(clamped, fps);
    if (element) {
      element.pause();
      element.currentTime = seconds;
    }
    setPlaying(false);
    setTime(seconds);
  }, [fps, frameCount]);

  const togglePlay = () => {
    const element = mediaRef.current;
    if (!element) return;
    if (!element.paused) { element.pause(); return; }
    void element.play().catch((error: unknown) => {
      setLoadError(`The source does not play here: ${error instanceof Error ? error.message : String(error)}.`);
    });
  };

  const bind = (element: PlayableElement | null) => { mediaRef.current = element; };
  const mediaEvents = {
    onPlay: () => setPlaying(true),
    onPause: () => { setPlaying(false); if (mediaRef.current) setTime(mediaRef.current.currentTime); },
    onSeeked: () => { if (mediaRef.current) setTime(mediaRef.current.currentTime); },
    onError: () => setLoadError('The source file cannot be read on this phone. Relink it in the Library item.'),
  };

  return (
    <div className="phone-source__viewer">
      <div className="phone-source__stage">
        {!file.url ? (
          <p className="phone-lib__note">The source file is missing. Relink it in its Library item.</p>
        ) : file.type === 'video' ? (
          <video ref={bind} className="phone-source__media" src={file.url} playsInline preload="auto"
            data-testid={IDS.media} data-frame={frame} {...mediaEvents} />
        ) : file.type === 'audio' ? (
          <>
            <audio ref={bind} src={file.url} preload="auto" data-testid={IDS.media} data-frame={frame} {...mediaEvents} />
            <p className="phone-source__audio-label">{file.name}</p>
          </>
        ) : (
          <img className="phone-source__media" src={file.url} alt={file.name} data-testid={IDS.media} draggable={false} />
        )}
      </div>
      {loadError && <p className="phone-lib__status" data-tone="error" role="alert">{loadError}</p>}

      {playable && frameCount > 0 && (
        <>
          <div className="phone-source__transport">
            <button type="button" className="phone-lib__button" data-testid={IDS.stepBack} aria-label="Previous frame"
              onClick={() => seekFrame(frame - 1)}>‹ 1</button>
            <button type="button" className="phone-lib__button phone-source__play" data-testid={IDS.play}
              aria-pressed={playing} onClick={togglePlay}>{playing ? 'Pause' : 'Play'}</button>
            <button type="button" className="phone-lib__button" data-testid={IDS.stepForward} aria-label="Next frame"
              onClick={() => seekFrame(frame + 1)}>1 ›</button>
            <span className="phone-source__frame" data-testid={IDS.frame} data-frame={frame}>
              Frame {frame} · {formatPhoneSourceTime(time)}
            </span>
          </div>
          <div className="phone-source__scrub" data-testid={IDS.scrub}>
            <HandleOnlyRange aria-label="Source position" min={0} max={Math.max(0, frameCount - 1)} step={1} value={frame}
              onChange={seekFrame} />
          </div>
          <div className="phone-source__marks">
            <button type="button" className="phone-lib__button" data-testid={IDS.markIn}
              onClick={() => writeMarks(clampPhoneSourceMark('in', frame, marks, frameCount))}>In here</button>
            <button type="button" className="phone-lib__button" data-testid={IDS.markOut}
              onClick={() => writeMarks(clampPhoneSourceMark('out', frame, marks, frameCount))}>Out here</button>
            <MarkField testId={IDS.inFrame} label="In" value={marks.inFrame} max={frameCount - 1}
              onCommit={(value) => writeMarks(clampPhoneSourceMark('in', value, marks, frameCount))} />
            <MarkField testId={IDS.outFrame} label="Out" value={marks.outFrame} max={frameCount - 1}
              onCommit={(value) => writeMarks(clampPhoneSourceMark('out', value, marks, frameCount))} />
            <button type="button" className="phone-lib__button" data-testid={IDS.clearMarks}
              aria-disabled={marks.inFrame === null && marks.outFrame === null}
              onClick={() => useMediaStore.getState().clearSourceMonitorInOut()}>Clear</button>
          </div>
        </>
      )}
      <p className="phone-lib__note" data-testid={IDS.range}>{describePhoneSourceRange(marks, frameCount, fps)}</p>
    </div>
  );
}
