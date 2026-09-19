import { useEffect, useLayoutEffect, useRef } from 'react';
import './codec-marquee.css';

const VIDEO_CODECS = [
  'H.264 / AVC',
  'H.265 / HEVC',
  'VP8',
  'VP9',
  'AV1',
  'ProRes 422 Proxy',
  'ProRes 422 LT',
  'ProRes 422',
  'ProRes 422 HQ',
  'ProRes 4444',
  'ProRes 4444 XQ',
] as const;

const VIDEO_CONTAINERS = [
  'MP4',
  'WebM',
  'MOV',
  'AVI',
  'MKV',
  'MXF',
  'WMV',
  'M4V',
  'FLV',
] as const;

const AUDIO_FORMATS = ['WAV', 'MP3', 'FLAC', 'AAC', 'Opus', 'AIFF', 'M4A', 'OGG'] as const;
const IMAGE_FORMATS = ['PNG', 'JPEG', 'WebP', 'GIF', 'TIFF', 'HEIC', 'BMP'] as const;
const MODEL_FORMATS = ['OBJ', 'FBX', 'glTF', 'GLB'] as const;
const SPLAT_FORMATS = ['PLY', 'KSPLAT', 'SPZ', 'SOG'] as const;
const VECTOR_ANIMATION_FORMATS = ['Lottie', 'Rive', 'SVG'] as const;
const DOCUMENT_FORMATS = ['PDF', 'JSON', 'CSV'] as const;

const SEEDANCE_LABEL = 'Seedance 2.5';

interface MarqueeEntry {
  label: string;
  seedance?: boolean;
}

// Hand-ordered so categories interleave, the six ProRes variants sit roughly
// eight items apart, and the Seedance takeover opens the loop and returns at
// the halfway point.
const MARQUEE_ITEMS: readonly MarqueeEntry[] = [
  { label: SEEDANCE_LABEL, seedance: true },
  { label: 'H.264 / AVC' },
  { label: 'MP4' },
  { label: 'PNG' },
  { label: 'WAV' },
  { label: 'ProRes 422 Proxy' },
  { label: 'glTF' },
  { label: 'WebM' },
  { label: 'Lottie' },
  { label: 'MP3' },
  { label: 'VP9' },
  { label: 'JPEG' },
  { label: 'PLY' },
  { label: 'ProRes 422 LT' },
  { label: 'MOV' },
  { label: 'FLAC' },
  { label: 'OBJ' },
  { label: 'WebP' },
  { label: 'H.265 / HEVC' },
  { label: 'PDF' },
  { label: 'KSPLAT' },
  { label: 'ProRes 422' },
  { label: 'MKV' },
  { label: 'AAC' },
  { label: 'GLB' },
  { label: SEEDANCE_LABEL, seedance: true },
  { label: 'GIF' },
  { label: 'AV1' },
  { label: 'Rive' },
  { label: 'SPZ' },
  { label: 'ProRes 422 HQ' },
  { label: 'AVI' },
  { label: 'Opus' },
  { label: 'FBX' },
  { label: 'TIFF' },
  { label: 'VP8' },
  { label: 'SVG' },
  { label: 'SOG' },
  { label: 'ProRes 4444' },
  { label: 'MXF' },
  { label: 'AIFF' },
  { label: 'JSON' },
  { label: 'HEIC' },
  { label: 'WMV' },
  { label: 'CSV' },
  { label: 'M4A' },
  { label: 'ProRes 4444 XQ' },
  { label: 'M4V' },
  { label: 'OGG' },
  { label: 'BMP' },
  { label: 'FLV' },
];
const REFLECTION_PERIOD_MS = 12000;
const REFLECTION_DURATION_MS = 850;
const MARQUEE_DURATION_MS = 200000;
const FIRST_SEEDANCE_ENTRY_DELAY_MS = 1800;
const MARQUEE_RESUME_DURATION_MS = 1000;
const CHARACTER_GROW_DURATION_MS = 25;
const CHARACTER_HOLD_DURATION_MS = 12;
const CHARACTER_SHRINK_DURATION_MS = 800;
const CHARACTER_PULSE_DURATION_MS = CHARACTER_GROW_DURATION_MS
  + CHARACTER_HOLD_DURATION_MS
  + CHARACTER_SHRINK_DURATION_MS;
const CHARACTER_PULSE_SCALE = 1.1;

const easeInOut = (progress: number) => progress * progress * (3 - 2 * progress);

function MarqueeTrack() {
  return (
    <div className="creation-mode-codec-marquee-track">
      {[0, 1].map((copyIndex) => (
        <span
          key={copyIndex}
          className={`creation-mode-codec-marquee-group ${copyIndex === 1 ? 'is-copy' : ''}`}
        >
          {MARQUEE_ITEMS.map((item, itemIndex) => (
            <span
              key={`${copyIndex}-${itemIndex}`}
              className={`creation-mode-codec-marquee-item${item.seedance ? ' creation-mode-codec-marquee-item--seedance' : ''}`}
            >
              {item.seedance && (
                <span className="creation-mode-codec-marquee-seedance-chip">New</span>
              )}
              {Array.from(item.label).map((character, characterIndex) => (
                <span
                  key={`${copyIndex}-${itemIndex}-${characterIndex}`}
                  className="creation-mode-codec-marquee-character"
                >
                  {character === ' ' ? '\u00A0' : character}
                </span>
              ))}
            </span>
          ))}
        </span>
      ))}
    </div>
  );
}

export function CodecMarquee() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const reflectionRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const baseTrack = viewport?.querySelector<HTMLElement>(
      '.creation-mode-codec-marquee-stack > .creation-mode-codec-marquee-track',
    );
    const firstGroup = baseTrack?.querySelector<HTMLElement>(
      '.creation-mode-codec-marquee-group:not(.is-copy)',
    );
    const seedanceItems = firstGroup?.querySelectorAll<HTMLElement>(
      '.creation-mode-codec-marquee-item--seedance',
    );
    const incomingSeedance = seedanceItems?.[1];
    if (!viewport || !firstGroup || !incomingSeedance) return;

    const groupRect = firstGroup.getBoundingClientRect();
    const seedanceRect = incomingSeedance.getBoundingClientRect();
    if (groupRect.width <= 0) return;

    const pixelsPerMillisecond = groupRect.width / MARQUEE_DURATION_MS;
    const delayedEntryDistance = pixelsPerMillisecond * FIRST_SEEDANCE_ENTRY_DELAY_MS;
    const seedanceOffset = seedanceRect.left - groupRect.left;
    const initialTrackOffset = viewport.clientWidth + delayedEntryDistance - seedanceOffset;
    const animationDelay = initialTrackOffset / groupRect.width * MARQUEE_DURATION_MS;

    viewport.style.setProperty(
      '--creation-mode-codec-marquee-delay',
      `${animationDelay.toFixed(2)}ms`,
    );
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let activePointerId: number | null = null;
    let pointerStartX = 0;
    let pixelsPerMillisecond = 0;
    let resumeFrame: number | null = null;
    let dragAnimations: Array<{ animation: Animation; startTime: number }> = [];

    const getScrollAnimations = () => Array.from(
      viewport.querySelectorAll<HTMLElement>('.creation-mode-codec-marquee-track'),
    ).flatMap((track) => track.getAnimations().filter(
      (animation): animation is CSSAnimation => (
        animation instanceof CSSAnimation
        && animation.animationName === 'creation-mode-codec-marquee-scroll'
      ),
    ));

    const cancelResume = () => {
      if (resumeFrame !== null) {
        window.cancelAnimationFrame(resumeFrame);
        resumeFrame = null;
      }
    };

    const normalizeAnimationTime = (time: number) => {
      const normalized = time % MARQUEE_DURATION_MS;
      return normalized < 0 ? normalized + MARQUEE_DURATION_MS : normalized;
    };

    const beginSmoothResume = (animations: Animation[]) => {
      cancelResume();
      const resumeStartedAt = performance.now();

      animations.forEach((animation) => {
        animation.updatePlaybackRate(0.001);
        animation.play();
      });

      const updatePlaybackRate = (now: number) => {
        const progress = Math.min(1, (now - resumeStartedAt) / MARQUEE_RESUME_DURATION_MS);
        const playbackRate = Math.max(0.001, easeInOut(progress));
        animations.forEach((animation) => animation.updatePlaybackRate(playbackRate));

        if (progress < 1) {
          resumeFrame = window.requestAnimationFrame(updatePlaybackRate);
        } else {
          resumeFrame = null;
          animations.forEach((animation) => animation.updatePlaybackRate(1));
        }
      };

      resumeFrame = window.requestAnimationFrame(updatePlaybackRate);
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;

      const firstGroup = viewport.querySelector<HTMLElement>(
        '.creation-mode-codec-marquee-group:not(.is-copy)',
      );
      const animations = getScrollAnimations();
      if (!firstGroup || firstGroup.offsetWidth <= 0 || animations.length === 0) return;

      cancelResume();
      activePointerId = event.pointerId;
      pointerStartX = event.clientX;
      pixelsPerMillisecond = firstGroup.offsetWidth / MARQUEE_DURATION_MS;
      dragAnimations = animations.map((animation) => {
        animation.pause();
        const currentTime = typeof animation.currentTime === 'number' ? animation.currentTime : 0;
        return { animation, startTime: currentTime };
      });

      viewport.classList.add('is-dragging');
      viewport.setPointerCapture(event.pointerId);
      event.preventDefault();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId || pixelsPerMillisecond <= 0) return;

      const dragDistance = event.clientX - pointerStartX;
      const animationTimeDelta = dragDistance / pixelsPerMillisecond;
      dragAnimations.forEach(({ animation, startTime }) => {
        animation.currentTime = normalizeAnimationTime(startTime - animationTimeDelta);
      });
      event.preventDefault();
    };

    const finishDrag = (event: PointerEvent) => {
      if (event.pointerId !== activePointerId) return;

      const animations = dragAnimations.map(({ animation }) => animation);
      activePointerId = null;
      dragAnimations = [];
      viewport.classList.remove('is-dragging');
      if (viewport.hasPointerCapture(event.pointerId)) {
        viewport.releasePointerCapture(event.pointerId);
      }
      beginSmoothResume(animations);
    };

    viewport.addEventListener('pointerdown', handlePointerDown);
    viewport.addEventListener('pointermove', handlePointerMove);
    viewport.addEventListener('pointerup', finishDrag);
    viewport.addEventListener('pointercancel', finishDrag);

    return () => {
      cancelResume();
      dragAnimations.forEach(({ animation }) => {
        animation.updatePlaybackRate(1);
        animation.play();
      });
      viewport.classList.remove('is-dragging');
      viewport.removeEventListener('pointerdown', handlePointerDown);
      viewport.removeEventListener('pointermove', handlePointerMove);
      viewport.removeEventListener('pointerup', finishDrag);
      viewport.removeEventListener('pointercancel', finishDrag);
    };
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    const reflection = reflectionRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!viewport || !reflection || typeof reflection.animate !== 'function' || reducedMotion.matches) return;

    let initialFrame: number | null = null;
    let characterFrame: number | null = null;
    let reflectionAnimation: Animation | null = null;
    let animatedCharacters: HTMLElement[] = [];
    const resetCharacterScales = () => {
      animatedCharacters.forEach((character) => character.style.removeProperty('transform'));
      animatedCharacters = [];
    };
    const pulseVisibleCharacters = () => {
      if (characterFrame !== null) {
        window.cancelAnimationFrame(characterFrame);
        characterFrame = null;
      }
      resetCharacterScales();

      const viewportRect = viewport.getBoundingClientRect();
      const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const reflectionWidth = Math.min(
        rootFontSize * 14,
        Math.max(rootFontSize * 8, window.innerWidth * 0.16),
      );
      const reflectionTravel = viewportRect.width + reflectionWidth;
      const characterStates: Array<{ character: HTMLElement; crossingTime: number }> = [];

      reflectionAnimation?.cancel();
      reflectionAnimation = reflection.animate(
        [
          { maskPosition: `${-reflectionWidth}px 0` },
          { maskPosition: `${viewportRect.width}px 0` },
        ],
        {
          duration: REFLECTION_DURATION_MS,
          easing: 'linear',
          fill: 'forwards',
        },
      );

      viewport
        .querySelectorAll<HTMLElement>('.creation-mode-codec-marquee-character')
        .forEach((character) => {
          const characterRect = character.getBoundingClientRect();
          if (
            characterRect.right < viewportRect.left - reflectionWidth
            || characterRect.left > viewportRect.right + reflectionWidth
          ) return;

          const characterCenter = characterRect.left + characterRect.width / 2 - viewportRect.left;
          const crossingProgress = Math.max(
            0,
            Math.min(1, (characterCenter + reflectionWidth / 2) / reflectionTravel),
          );
          const crossingTime = crossingProgress * REFLECTION_DURATION_MS;
          characterStates.push({ character, crossingTime });
        });

      animatedCharacters = characterStates.map(({ character }) => character);
      const pulseStartedAt = performance.now();
      const updateCharacterScales = (now: number) => {
        const elapsed = now - pulseStartedAt;
        characterStates.forEach(({ character, crossingTime }) => {
          const localTime = elapsed - crossingTime;
          let scale = 1;

          if (localTime >= -CHARACTER_GROW_DURATION_MS && localTime < 0) {
            const progress = (localTime + CHARACTER_GROW_DURATION_MS) / CHARACTER_GROW_DURATION_MS;
            const easedProgress = easeInOut(progress);
            scale = 1 + (CHARACTER_PULSE_SCALE - 1) * easedProgress;
          } else if (localTime >= 0 && localTime < CHARACTER_HOLD_DURATION_MS) {
            scale = CHARACTER_PULSE_SCALE;
          } else if (
            localTime >= CHARACTER_HOLD_DURATION_MS
            && localTime < CHARACTER_PULSE_DURATION_MS - CHARACTER_GROW_DURATION_MS
          ) {
            const progress = (
              localTime - CHARACTER_HOLD_DURATION_MS
            ) / CHARACTER_SHRINK_DURATION_MS;
            const easedProgress = easeInOut(progress);
            scale = 1 + (CHARACTER_PULSE_SCALE - 1) * (1 - easedProgress);
          }

          if (scale === 1) character.style.removeProperty('transform');
          else character.style.transform = `scale(${scale.toFixed(4)})`;
        });

        if (elapsed < REFLECTION_DURATION_MS + CHARACTER_HOLD_DURATION_MS + CHARACTER_SHRINK_DURATION_MS) {
          characterFrame = window.requestAnimationFrame(updateCharacterScales);
        } else {
          characterFrame = null;
          resetCharacterScales();
        }
      };
      characterFrame = window.requestAnimationFrame(updateCharacterScales);
    };

    initialFrame = window.requestAnimationFrame(pulseVisibleCharacters);
    const pulseInterval = window.setInterval(pulseVisibleCharacters, REFLECTION_PERIOD_MS);

    return () => {
      if (initialFrame !== null) window.cancelAnimationFrame(initialFrame);
      if (characterFrame !== null) window.cancelAnimationFrame(characterFrame);
      window.clearInterval(pulseInterval);
      reflectionAnimation?.cancel();
      resetCharacterScales();
    };
  }, []);

  return (
    <section
      className="creation-mode-codec-marquee"
      aria-label="Supported formats and the new Seedance 2.5 video model"
    >
      <span className="creation-mode-codec-marquee-summary">
        New: Seedance 2.5 AI video generation is now available.
        Supported video codecs: {VIDEO_CODECS.join(', ')}. Supported containers:{' '}
        {VIDEO_CONTAINERS.join(', ')}. Audio: {AUDIO_FORMATS.join(', ')}.
        Images: {IMAGE_FORMATS.join(', ')}. 3D models: {MODEL_FORMATS.join(', ')}.
        Gaussian splats: {SPLAT_FORMATS.join(', ')}. Vector animation:{' '}
        {VECTOR_ANIMATION_FORMATS.join(', ')}. Documents and data:{' '}
        {DOCUMENT_FORMATS.join(', ')}.
      </span>
      <div ref={viewportRef} className="creation-mode-codec-marquee-viewport" aria-hidden="true">
        <div className="creation-mode-codec-marquee-stack">
          <MarqueeTrack />
          <div className="creation-mode-codec-marquee-shine">
            <MarqueeTrack />
          </div>
          <div ref={reflectionRef} className="creation-mode-codec-marquee-reflection">
            <MarqueeTrack />
          </div>
        </div>
      </div>
    </section>
  );
}
