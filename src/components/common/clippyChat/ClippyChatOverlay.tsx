import { useRef, useState, type FormEvent } from 'react';
import { IconArrowUpRight, IconPlayerPlay, IconVolume, IconVolumeOff, IconX } from '@tabler/icons-react';
import { queueLandingEntryRequest } from '../../../marketing/landingEntryRequest';
import { useDockStore } from '../../../stores/dockStore';
import { isMobileAppleWebKit } from '../../../utils/mobileAppleWebKit';
import './ClippyChatOverlay.css';

// Replace this source with the keyed chat performance when that asset is ready.
const DEFAULT_VIDEO_SRC = '/clippy-intro.webm';
const DISMISSED_KEY = 'ms.clippy-chat.dismissed';

function initiallyOpen() {
  try { return sessionStorage.getItem(DISMISSED_KEY) !== 'true'; }
  catch { return true; }
}

export function ClippyChatOverlay({ videoSrc = DEFAULT_VIDEO_SRC }: { videoSrc?: string }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [draft, setDraft] = useState('');
  const [muted, setMuted] = useState(true);
  const [videoFailed, setVideoFailed] = useState(isMobileAppleWebKit);
  const [playError, setPlayError] = useState('');
  const [reduceMotion] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);

  const dismiss = () => {
    setOpen(false);
    try { sessionStorage.setItem(DISMISSED_KEY, 'true'); } catch { /* Session storage is optional. */ }
  };

  const play = async (withSound = !muted) => {
    const video = videoRef.current;
    if (!video) return;
    setPlayError('');
    video.muted = !withSound;
    setMuted(!withSound);
    video.currentTime = 0;
    try { await video.play(); }
    catch { setPlayError('Playback could not start. Try again.'); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt) return;
    // Reuse the existing composer handoff; the user sends from its normal controls.
    useDockStore.getState().activatePanelType('media');
    queueLandingEntryRequest({ mode: 'chat', prompt });
    setDraft('');
    dismiss();
  };

  if (!open) return (
    <button
      ref={launcherRef}
      className="clippy-chat-launcher"
      type="button"
      aria-label="Open Clippy chat"
      onClick={() => setOpen(true)}
    >
      <img src="/clippy.webp" alt="" draggable={false} />
      <span>Ask Clippy</span>
    </button>
  );

  return (
    <aside
      className="clippy-chat-overlay"
      aria-label="Clippy chat"
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          dismiss();
          requestAnimationFrame(() => launcherRef.current?.focus());
        }
      }}
    >
      <div className="clippy-chat-character">
        {videoFailed ? (
          <img src="/clippy.webp" alt="Clippy" draggable={false} />
        ) : (
          <video
            ref={videoRef}
            src={videoSrc}
            poster="/clippy.webp"
            aria-label="Clippy introduction"
            autoPlay={!reduceMotion}
            muted={muted}
            playsInline
            preload="metadata"
            disablePictureInPicture
            onError={() => setVideoFailed(true)}
          />
        )}
      </div>
      <div className="clippy-chat-controls">
        {!videoFailed && <>
          <button type="button" aria-label="Replay Clippy" title="Replay" onClick={() => void play()}>
            <IconPlayerPlay aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={muted ? 'Play Clippy with sound' : 'Mute Clippy'}
            title={muted ? 'Play with sound' : 'Mute'}
            onClick={() => {
              if (muted) void play(true);
              else {
                if (videoRef.current) videoRef.current.muted = true;
                setMuted(true);
              }
            }}
          >
            {muted ? <IconVolumeOff aria-hidden="true" /> : <IconVolume aria-hidden="true" />}
          </button>
        </>}
        <button type="button" aria-label="Close Clippy chat" title="Close" onClick={dismiss}>
          <IconX aria-hidden="true" />
        </button>
      </div>
      <form className="clippy-chat-composer" onSubmit={submit} aria-label="Continue in AI chat">
        <textarea
          aria-label="Message for AI chat"
          placeholder="inside me"
          rows={2}
          maxLength={4000}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Continue in AI chat" title="Continue in AI chat">
          <IconArrowUpRight aria-hidden="true" />
        </button>
      </form>
      {playError && <p className="clippy-chat-error" role="status">{playError}</p>}
    </aside>
  );
}
