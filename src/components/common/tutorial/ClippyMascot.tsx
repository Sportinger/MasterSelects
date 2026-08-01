import { useEffect, useRef, useState } from 'react';
import './ClippyMascot.css';

interface ClippyMascotProps {
  isClosing: boolean;
}

let hasPlayedIntro = false;

export function ClippyMascot({ isClosing }: ClippyMascotProps) {
  const [useWebP, setUseWebP] = useState(false);
  const [phase, setPhase] = useState<'intro' | 'loop' | 'outro'>(() => (
    hasPlayedIntro ? 'loop' : 'intro'
  ));
  const introRef = useRef<HTMLVideoElement>(null);
  const loopRef = useRef<HTMLVideoElement>(null);
  const outroRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (phase === 'intro') hasPlayedIntro = true;
  }, [phase]);

  useEffect(() => {
    const intro = introRef.current;
    if (!intro) return;
    const source = intro.querySelector('source');
    if (source) {
      source.addEventListener('error', () => setUseWebP(true), { once: true });
    }
    const onEnded = () => setPhase('loop');
    intro.addEventListener('ended', onEnded);
    return () => intro.removeEventListener('ended', onEnded);
  }, []);

  useEffect(() => {
    if (!isClosing || phase === 'outro') return;

    const frame = requestAnimationFrame(() => {
      setPhase('outro');
      const outro = outroRef.current;
      if (outro) {
        outro.currentTime = 0;
        outro.play().catch(() => {});
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [isClosing, phase]);

  if (useWebP) {
    return <img src="/clippy.webp" alt="" className="clippy-mascot" draggable={false} />;
  }

  return (
    <>
      <video
        ref={introRef}
        className="clippy-mascot"
        autoPlay
        muted
        playsInline
        disablePictureInPicture
        style={{ display: phase === 'intro' ? undefined : 'none' }}
      >
        <source src="/clippy-intro.webm" type="video/webm" />
      </video>
      <video
        ref={loopRef}
        className="clippy-mascot"
        autoPlay
        loop
        muted
        playsInline
        disablePictureInPicture
        style={{ display: phase === 'loop' ? undefined : 'none' }}
      >
        <source src="/clippy.webm" type="video/webm" />
      </video>
      <video
        ref={outroRef}
        className="clippy-mascot"
        preload="auto"
        muted
        playsInline
        disablePictureInPicture
        style={{ display: phase === 'outro' ? undefined : 'none' }}
      >
        <source src="/clippy-outro.webm" type="video/webm" />
      </video>
    </>
  );
}
