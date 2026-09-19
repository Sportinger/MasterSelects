import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import {
  IconArrowUpRight,
  IconSparkles,
  IconTimeline,
} from '@tabler/icons-react';
import {
  buildChatHref,
  buildEditorHref,
  buildMediumHref,
} from '../routing/entryExperience';
import { trackLandingOptionSelected } from '../services/productAnalytics';
import { useAccountStore } from '../stores/accountStore';
import { CodecMarquee } from './CodecMarquee';
import { CreationModeMediumOption } from './CreationModeMediumOption';
import { creationModeMaskRadius } from './creationModeGeometry';
import './creation-mode-landing.css';
import './creation-mode-medium.css';

export type CreationModeTarget = 'chat' | 'editor' | 'medium';
type CreationModeName = 'easy' | 'medium' | 'hard';

const INITIAL_REVEAL_DURATION_MS = 950;

const setOptionShadowDirection = (
  option: HTMLAnchorElement,
  pointerX: number,
  pointerY: number,
) => {
  const rect = option.getBoundingClientRect();
  const castX = Math.max(-1, Math.min(1, (
    rect.left + rect.width / 2 - pointerX
  ) / Math.max(rect.width / 2, 1)));
  const castY = Math.max(-1, Math.min(1, (
    rect.top + rect.height / 2 - pointerY
  ) / Math.max(rect.height / 2, 1)));
  const style = option.style;

  style.setProperty('--creation-mode-inner-shadow-x', `${castX * 0.35}rem`);
  style.setProperty('--creation-mode-inner-shadow-y', `${castY * 0.35}rem`);
  style.setProperty('--creation-mode-inner-shadow-deep-x', `${castX * 1.5}rem`);
  style.setProperty('--creation-mode-inner-shadow-deep-y', `${castY * 1.5}rem`);
  style.setProperty('--creation-mode-inner-highlight-x', `${castX * -0.65}rem`);
  style.setProperty('--creation-mode-inner-highlight-y', `${castY * -0.65}rem`);
  style.setProperty('--creation-mode-title-highlight-x', `${castX * -0.012}em`);
  style.setProperty('--creation-mode-title-highlight-y', `${castY * -0.012}em`);
  style.setProperty('--creation-mode-title-shadow-near-x', `${castX * 0.018}em`);
  style.setProperty('--creation-mode-title-shadow-near-y', `${castY * 0.018}em`);
  style.setProperty('--creation-mode-title-shadow-mid-x', `${castX * 0.036}em`);
  style.setProperty('--creation-mode-title-shadow-mid-y', `${castY * 0.036}em`);
  style.setProperty('--creation-mode-title-shadow-far-x', `${castX * 0.054}em`);
  style.setProperty('--creation-mode-title-shadow-far-y', `${castY * 0.054}em`);
};

const resetOptionShadowDirection = (option: HTMLAnchorElement) => {
  [
    '--creation-mode-inner-shadow-x',
    '--creation-mode-inner-shadow-y',
    '--creation-mode-inner-shadow-deep-x',
    '--creation-mode-inner-shadow-deep-y',
    '--creation-mode-inner-highlight-x',
    '--creation-mode-inner-highlight-y',
    '--creation-mode-title-highlight-x',
    '--creation-mode-title-highlight-y',
    '--creation-mode-title-shadow-near-x',
    '--creation-mode-title-shadow-near-y',
    '--creation-mode-title-shadow-mid-x',
    '--creation-mode-title-shadow-mid-y',
    '--creation-mode-title-shadow-far-x',
    '--creation-mode-title-shadow-far-y',
  ].forEach((property) => option.style.removeProperty(property));
};

interface CreationModeLandingPageProps {
  isEditorReady?: boolean;
  isEntering?: boolean;
  isExiting?: boolean;
  isPreparing?: boolean;
  onEasyViewportReady?: () => void;
  onOpenExperience?: (experience: CreationModeTarget, href: string) => void;
  playInitialReveal?: boolean;
}

export function CreationModeLandingPage({
  isEditorReady = false,
  isEntering = false,
  isExiting = false,
  isPreparing = false,
  onEasyViewportReady,
  onOpenExperience,
  playInitialReveal = false,
}: CreationModeLandingPageProps) {
  const accountSession = useAccountStore((state) => state.session);
  const accountUser = useAccountStore((state) => state.user);
  const openAccountDialog = useAccountStore((state) => state.openAccountDialog);
  const openAuthDialog = useAccountStore((state) => state.openAuthDialog);
  const easyOptionRef = useRef<HTMLAnchorElement>(null);
  const easyViewportRef = useRef<HTMLSpanElement>(null);
  const mediumOptionRef = useRef<HTMLAnchorElement>(null);
  const hardOptionRef = useRef<HTMLAnchorElement>(null);
  const easyReadinessNotifiedRef = useRef(false);
  const lastMeasurementSignatureRef = useRef<string | null>(null);
  const measurementFrameRef = useRef<number | null>(null);
  const shadowFrameRef = useRef<number | null>(null);
  const pendingShadowPointerRef = useRef<{ x: number; y: number } | null>(null);
  const stableMeasurementFramesRef = useRef(0);
  const [isLiveEasyReady, setIsLiveEasyReady] = useState(false);
  const [initialRevealComplete, setInitialRevealComplete] = useState(false);
  const easyHref = buildChatHref(window.location);
  const mediumHref = buildMediumHref(window.location);
  const hardHref = buildEditorHref(window.location);
  const accountLabel = accountSession?.authenticated
    ? accountUser?.displayName?.trim()
      || accountUser?.email?.split('@')[0]
      || 'Account'
    : 'Login';

  useEffect(() => {
    const previousTitle = document.title;
    const creationModeTitle = 'MasterSelects — Choose how to create';
    document.title = creationModeTitle;

    return () => {
      if (document.title === creationModeTitle) {
        document.title = previousTitle;
      }
    };
  }, []);

  useEffect(() => {
    if (!playInitialReveal || initialRevealComplete) return;
    const timeout = window.setTimeout(
      () => setInitialRevealComplete(true),
      INITIAL_REVEAL_DURATION_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [initialRevealComplete, playInitialReveal]);

  useEffect(() => () => {
    if (shadowFrameRef.current !== null) {
      window.cancelAnimationFrame(shadowFrameRef.current);
    }
  }, []);

  useLayoutEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;

    let animationFrame: number | null = null;
    let marqueeShift = 0;
    const updateOverlapPull = () => {
      animationFrame = null;
      const easyOption = easyOptionRef.current;
      const mediumOption = mediumOptionRef.current;
      const hardOption = hardOptionRef.current;
      if (!easyOption || !mediumOption || !hardOption) return;

      const easyRect = easyOption.getBoundingClientRect();
      const mediumRect = mediumOption.getBoundingClientRect();
      const hardRect = hardOption.getBoundingClientRect();
      const page = easyOption.closest<HTMLElement>('.creation-mode-page');
      const intro = page?.querySelector<HTMLElement>('.creation-mode-intro');
      const logo = page?.querySelector<HTMLElement>('.creation-mode-logo');
      const marquee = page?.querySelector<HTMLElement>('.creation-mode-codec-marquee');
      const getVerticalOverlap = (upperRect: DOMRect, lowerRect: DOMRect) => {
        const isVerticallyStacked = (
          lowerRect.top > upperRect.top
          && Math.abs(lowerRect.left - upperRect.left)
            < Math.min(upperRect.width, lowerRect.width) * 0.25
        );
        return isVerticallyStacked
          ? Math.max(0, Math.min(upperRect.height, upperRect.bottom - lowerRect.top))
          : 0;
      };
      const easyMediumOverlap = getVerticalOverlap(easyRect, mediumRect);
      const mediumHardOverlap = getVerticalOverlap(mediumRect, hardRect);
      const contentPull = -Math.min(116, easyMediumOverlap * 0.46);
      const mediumContentPull = -Math.min(104, mediumHardOverlap * 0.4);
      const hardContentPull = -Math.min(88, mediumHardOverlap * 0.32);
      const pillPull = -Math.min(
        12,
        Math.max(easyMediumOverlap, mediumHardOverlap) * 0.04,
      );

      root.style.setProperty('--creation-mode-easy-compact-content-y', `${contentPull}px`);
      root.style.setProperty('--creation-mode-medium-compact-content-y', `${mediumContentPull}px`);
      root.style.setProperty('--creation-mode-hard-compact-content-y', `${hardContentPull}px`);
      root.style.setProperty('--creation-mode-easy-compact-pill-y', `${pillPull}px`);

      if (intro && marquee) {
        const introRect = intro.getBoundingClientRect();
        const marqueeRect = marquee.getBoundingClientRect();
        const baseMarqueeTop = marqueeRect.top - marqueeShift;
        const availableGap = Math.max(0, easyRect.top - introRect.bottom);
        const desiredMarqueeTop = introRect.bottom
          + Math.max(0, (availableGap - marqueeRect.height) / 2);
        marqueeShift = desiredMarqueeTop - baseMarqueeTop;
        marquee.style.setProperty('--creation-mode-marquee-gap-y', `${marqueeShift}px`);

        if (logo) {
          const logoRect = logo.getBoundingClientRect();
          const shineX = Math.max(
            0,
            Math.min(marqueeRect.width, logoRect.left + logoRect.width / 2 - marqueeRect.left),
          );
          const shineY = logoRect.top + logoRect.height / 2 - marqueeRect.top;
          const shineRadiusY = Math.max(192, Math.abs(shineY) * 3);
          marquee.style.setProperty('--creation-mode-marquee-shine-x', `${shineX}px`);
          marquee.style.setProperty('--creation-mode-marquee-shine-y', `${shineY}px`);
          marquee.style.setProperty('--creation-mode-marquee-shine-radius-y', `${shineRadiusY}px`);
        }
      }
    };
    const scheduleOverlapPull = () => {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(updateOverlapPull);
      }
    };

    scheduleOverlapPull();
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleOverlapPull);
    if (easyOptionRef.current) resizeObserver?.observe(easyOptionRef.current);
    if (mediumOptionRef.current) resizeObserver?.observe(mediumOptionRef.current);
    if (hardOptionRef.current) resizeObserver?.observe(hardOptionRef.current);
    const page = easyOptionRef.current?.closest<HTMLElement>('.creation-mode-page');
    const intro = page?.querySelector<HTMLElement>('.creation-mode-intro');
    const marquee = page?.querySelector<HTMLElement>('.creation-mode-codec-marquee');
    if (intro) resizeObserver?.observe(intro);
    if (marquee) resizeObserver?.observe(marquee);
    window.addEventListener('resize', scheduleOverlapPull);

    return () => {
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleOverlapPull);
      root.style.removeProperty('--creation-mode-easy-compact-content-y');
      root.style.removeProperty('--creation-mode-medium-compact-content-y');
      root.style.removeProperty('--creation-mode-hard-compact-content-y');
      root.style.removeProperty('--creation-mode-easy-compact-pill-y');
      marquee?.style.removeProperty('--creation-mode-marquee-gap-y');
      marquee?.style.removeProperty('--creation-mode-marquee-shine-x');
      marquee?.style.removeProperty('--creation-mode-marquee-shine-y');
      marquee?.style.removeProperty('--creation-mode-marquee-shine-radius-y');
    };
  }, [initialRevealComplete]);

  useLayoutEffect(() => {
    if (!isEditorReady) return;

    const rootStyle = document.documentElement.style;
    const resizingClassName = 'is-creation-mode-viewport-resizing';
    let observedDockContainer: HTMLElement | null = null;
    const scheduleLiveEasyViewportUpdate = () => {
      if (measurementFrameRef.current !== null) return;
      measurementFrameRef.current = window.requestAnimationFrame(() => {
        measurementFrameRef.current = null;
        updateLiveEasyViewport();
      });
    };
    const dockClassObserver = new MutationObserver(scheduleLiveEasyViewportUpdate);
    const updateLiveEasyViewport = () => {
      const viewport = easyViewportRef.current;
      const editorStage = document.querySelector<HTMLElement>('[data-creation-mode-editor-stage]');
      const chatPill = document.querySelector<HTMLElement>(
        '[data-creation-morph-target="start:chat-pill"]',
      );
      if (!viewport || !editorStage) return;
      if (!chatPill) {
        const compactViewport = window.matchMedia?.('(max-width: 900px)').matches ?? false;
        if (!compactViewport) {
          document.documentElement.classList.remove(resizingClassName);
          return;
        }

        // Automatic mobile layouts do not contain the desktop start-layout
        // chat pill. Keep EASY usable without that optional morph target.
        setIsLiveEasyReady(true);
        document.documentElement.classList.remove(resizingClassName);
        if (!easyReadinessNotifiedRef.current) {
          easyReadinessNotifiedRef.current = true;
          mutationObserver.disconnect();
          dockClassObserver.disconnect();
          onEasyViewportReady?.();
        }
        return;
      }

      const dockContainer = editorStage.querySelector<HTMLElement>('.dock-container');
      if (dockContainer && dockContainer !== observedDockContainer) {
        dockClassObserver.disconnect();
        dockClassObserver.observe(dockContainer, {
          attributes: true,
          attributeFilter: ['class'],
        });
        observedDockContainer = dockContainer;
      }
      if (dockContainer?.classList.contains('layout-switch-animating')) {
        lastMeasurementSignatureRef.current = null;
        stableMeasurementFramesRef.current = 0;
        scheduleLiveEasyViewportUpdate();
        return;
      }

      const creationModeRoot = viewport.closest<HTMLElement>('.creation-mode-page');
      creationModeRoot?.classList.add('is-measuring-creation-mode-destinations');
      editorStage.classList.add('is-measuring-creation-mode-preview');
      const viewportRect = viewport.getBoundingClientRect();
      const chatPillRect = chatPill.getBoundingClientRect();
      editorStage.classList.remove('is-measuring-creation-mode-preview');
      creationModeRoot?.classList.remove('is-measuring-creation-mode-destinations');
      if (
        viewportRect.width <= 0
        || viewportRect.height <= 0
        || chatPillRect.width <= 0
        || chatPillRect.height <= 0
      ) return;

      const horizontalPadding = Math.min(18, viewportRect.width * 0.04);
      const pillAreaWidth = viewportRect.width * 0.52;
      const scale = Math.min(
        0.62,
        (pillAreaWidth - horizontalPadding * 2) / chatPillRect.width,
      );
      const viewportCenterX = viewportRect.left + viewportRect.width * 0.71;
      const viewportCenterY = viewportRect.top + viewportRect.height * 0.58;
      const pillCenterX = chatPillRect.left + chatPillRect.width / 2;
      const pillCenterY = chatPillRect.top + chatPillRect.height / 2;
      const viewportStyle = window.getComputedStyle(viewport);
      const viewportRadius = Number.parseFloat(viewportStyle.borderTopLeftRadius) || 20;
      const maskScaleX = viewportRect.width / Math.max(window.innerWidth, 1);
      const maskScaleY = viewportRect.height / Math.max(window.innerHeight, 1);

      rootStyle.setProperty('--creation-mode-easy-top', `${viewportRect.top}px`);
      rootStyle.setProperty('--creation-mode-easy-right', `${window.innerWidth - viewportRect.right}px`);
      rootStyle.setProperty('--creation-mode-easy-bottom', `${window.innerHeight - viewportRect.bottom}px`);
      rootStyle.setProperty('--creation-mode-easy-left', `${viewportRect.left}px`);
      rootStyle.setProperty(
        '--creation-mode-easy-radius',
        viewportStyle.borderRadius,
      );
      rootStyle.setProperty(
        '--creation-mode-easy-mask-radius',
        creationModeMaskRadius(viewportRadius, maskScaleX, maskScaleY),
      );
      rootStyle.setProperty('--creation-mode-easy-scale-x', `${maskScaleX}`);
      rootStyle.setProperty('--creation-mode-easy-scale-y', `${maskScaleY}`);
      rootStyle.setProperty('--creation-mode-pill-x', `${viewportCenterX - pillCenterX}px`);
      rootStyle.setProperty('--creation-mode-pill-y', `${viewportCenterY - pillCenterY}px`);
      rootStyle.setProperty('--creation-mode-pill-scale', `${scale}`);

      const measurementSignature = [
        viewportRect.left,
        viewportRect.top,
        viewportRect.width,
        viewportRect.height,
        chatPillRect.left,
        chatPillRect.top,
        chatPillRect.width,
        chatPillRect.height,
      ].map((value) => Math.round(value * 10) / 10).join(':');
      if (measurementSignature !== lastMeasurementSignatureRef.current) {
        lastMeasurementSignatureRef.current = measurementSignature;
        stableMeasurementFramesRef.current = 0;
        scheduleLiveEasyViewportUpdate();
        return;
      }

      stableMeasurementFramesRef.current += 1;
      if (stableMeasurementFramesRef.current < 2) {
        scheduleLiveEasyViewportUpdate();
        return;
      }

      setIsLiveEasyReady(true);
      document.documentElement.classList.remove(resizingClassName);
      if (!easyReadinessNotifiedRef.current) {
        easyReadinessNotifiedRef.current = true;
        mutationObserver.disconnect();
        dockClassObserver.disconnect();
        onEasyViewportReady?.();
      }
    };

    scheduleLiveEasyViewportUpdate();
    const mutationObserver = new MutationObserver(scheduleLiveEasyViewportUpdate);
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleLiveEasyViewportUpdate);
    if (easyViewportRef.current) resizeObserver?.observe(easyViewportRef.current);
    const handleViewportResize = () => {
      document.documentElement.classList.add(resizingClassName);
      setIsLiveEasyReady(false);
      lastMeasurementSignatureRef.current = null;
      stableMeasurementFramesRef.current = 0;
      scheduleLiveEasyViewportUpdate();
    };
    window.addEventListener('resize', handleViewportResize);

    return () => {
      if (measurementFrameRef.current !== null) {
        window.cancelAnimationFrame(measurementFrameRef.current);
        measurementFrameRef.current = null;
      }
      mutationObserver.disconnect();
      dockClassObserver.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleViewportResize);
      document.documentElement.classList.remove(resizingClassName);
      [
        '--creation-mode-easy-top',
        '--creation-mode-easy-right',
        '--creation-mode-easy-bottom',
        '--creation-mode-easy-left',
        '--creation-mode-easy-radius',
        '--creation-mode-easy-mask-radius',
        '--creation-mode-easy-scale-x',
        '--creation-mode-easy-scale-y',
        '--creation-mode-pill-x',
        '--creation-mode-pill-y',
        '--creation-mode-pill-scale',
      ].forEach((property) => rootStyle.removeProperty(property));
    };
  }, [isEditorReady, onEasyViewportReady]);

  const openExperience = (
    event: MouseEvent<HTMLAnchorElement>,
    mode: CreationModeName,
    experience: CreationModeTarget,
    href: string,
  ) => {
    if (event.button !== 0) return;
    trackLandingOptionSelected(mode, experience);

    if (
      !onOpenExperience
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }

    event.preventDefault();
    onOpenExperience(experience, href);
  };

  const moveOptionShadows = (event: PointerEvent<HTMLElement>) => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    pendingShadowPointerRef.current = { x: event.clientX, y: event.clientY };
    if (shadowFrameRef.current !== null) return;

    shadowFrameRef.current = window.requestAnimationFrame(() => {
      shadowFrameRef.current = null;
      const pointer = pendingShadowPointerRef.current;
      if (!pointer) return;

      if (easyOptionRef.current) {
        setOptionShadowDirection(easyOptionRef.current, pointer.x, pointer.y);
      }
      if (mediumOptionRef.current) {
        setOptionShadowDirection(mediumOptionRef.current, pointer.x, pointer.y);
      }
      if (hardOptionRef.current) {
        setOptionShadowDirection(hardOptionRef.current, pointer.x, pointer.y);
      }
    });
  };

  const resetOptionShadows = () => {
    pendingShadowPointerRef.current = null;
    if (shadowFrameRef.current !== null) {
      window.cancelAnimationFrame(shadowFrameRef.current);
      shadowFrameRef.current = null;
    }
    if (easyOptionRef.current) resetOptionShadowDirection(easyOptionRef.current);
    if (mediumOptionRef.current) resetOptionShadowDirection(mediumOptionRef.current);
    if (hardOptionRef.current) resetOptionShadowDirection(hardOptionRef.current);
  };

  const pageStateClassName = [
    isEditorReady ? 'is-editor-ready' : '',
    isLiveEasyReady ? 'is-live-easy-ready' : '',
    isEntering ? 'is-entering' : '',
    isExiting ? 'is-exiting' : '',
    isPreparing ? 'is-preparing' : '',
    playInitialReveal && !initialRevealComplete ? 'is-initial-reveal' : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <div
        aria-hidden="true"
        className={`creation-mode-backdrop ${pageStateClassName}`.trim()}
      />
      <main
        aria-hidden={isPreparing || isExiting || isEntering || undefined}
        className={`creation-mode-page ${pageStateClassName}`.trim()}
        onPointerLeave={resetOptionShadows}
        onPointerMove={moveOptionShadows}
      >
      <header className="creation-mode-header">
        <span className="creation-mode-kicker">Video creation</span>
        <button
          className="creation-mode-account-button creation-mode-piece"
          type="button"
          aria-label={accountSession?.authenticated ? `Open account for ${accountLabel}` : 'Login'}
          onClick={() => (accountSession?.authenticated ? openAccountDialog() : openAuthDialog())}
        >
          {accountLabel}
        </button>
      </header>

      <section className="creation-mode-intro" aria-labelledby="creation-mode-title">
        <img
          className="creation-mode-logo"
          src="/masterselects-metal-logo-v2.webp"
          alt="MasterSelects"
          decoding="async"
        />
        <h1 id="creation-mode-title">How do you want to create your video?</h1>
      </section>

      <div className="creation-mode-selection">
        <CodecMarquee />

        <nav className="creation-mode-options" aria-label="Video creation mode">
        <a
          ref={easyOptionRef}
          className="creation-mode-option creation-mode-option--easy"
          href={easyHref}
          onClick={(event) => openExperience(event, 'easy', 'chat', easyHref)}
          aria-describedby="creation-mode-easy-description"
          tabIndex={isPreparing || isExiting || isEntering ? -1 : undefined}
        >
          <span
            ref={easyViewportRef}
            className="creation-mode-easy-surface"
            data-creation-mode-easy-viewport
            aria-hidden="true"
          />
          <span className="creation-mode-option-topline">
            <span className="creation-mode-piece creation-mode-option-index">01</span>
            <IconSparkles
              className="creation-mode-piece creation-mode-option-icon"
              aria-hidden="true"
            />
          </span>
          <span className="creation-mode-option-copy">
            <strong className="creation-mode-piece creation-mode-option-title">EASY</strong>
            <span
              className="creation-mode-piece creation-mode-option-description"
              id="creation-mode-easy-description"
            >
              Start with an idea. AI helps you turn it into a finished video.
            </span>
          </span>
          <span className="creation-mode-option-action">
            <span className="creation-mode-piece creation-mode-option-access-label">
              <span className="creation-mode-option-access-copy">
                Available via <strong className="creation-mode-option-access-channel">API</strong>
              </span>
              <span className="creation-mode-option-access-shine" aria-hidden="true">
                Available via <strong className="creation-mode-option-access-channel">API</strong>
              </span>
            </span>
            <span className="creation-mode-piece creation-mode-option-action-label">
              Create with AI
            </span>
            <IconArrowUpRight
              className="creation-mode-piece creation-mode-option-arrow"
              aria-hidden="true"
            />
          </span>
        </a>

        <CreationModeMediumOption
          ref={mediumOptionRef}
          href={mediumHref}
          onClick={(event) => openExperience(event, 'medium', 'medium', mediumHref)}
          tabIndex={isPreparing || isExiting || isEntering ? -1 : undefined}
        />

        <a
          ref={hardOptionRef}
          className="creation-mode-option creation-mode-option--hard"
          href={hardHref}
          onClick={(event) => openExperience(event, 'hard', 'editor', hardHref)}
          aria-describedby="creation-mode-hard-description"
          tabIndex={isPreparing || isExiting || isEntering ? -1 : undefined}
        >
          <span className="creation-mode-option-topline">
            <span className="creation-mode-piece creation-mode-option-index">03</span>
            <IconTimeline
              className="creation-mode-piece creation-mode-option-icon"
              aria-hidden="true"
            />
          </span>
          <span className="creation-mode-option-copy">
            <strong className="creation-mode-piece creation-mode-option-title">HARD</strong>
            <span
              className="creation-mode-piece creation-mode-option-description"
              id="creation-mode-hard-description"
            >
              Open the full editor and shape every detail yourself.
            </span>
          </span>
          <span className="creation-mode-layout-preview creation-mode-layout-preview--hard" aria-hidden="true">
            <span
              className="creation-mode-piece creation-mode-mini-panel creation-mode-mini-media"
              data-creation-mode-target="editor"
              data-creation-morph-id="panel:media"
            >
              <span className="creation-mode-mini-panel-title">Media</span>
              <span className="creation-mode-mini-media-grid"><i /><i /><i /><i /></span>
            </span>
            <span
              className="creation-mode-piece creation-mode-mini-panel creation-mode-mini-preview"
              data-creation-mode-target="editor"
              data-creation-morph-id="panel:preview"
            >
              <span className="creation-mode-mini-panel-title">Preview</span>
              <span className="creation-mode-mini-canvas"><i /></span>
            </span>
            <span
              className="creation-mode-piece creation-mode-mini-panel creation-mode-mini-export"
              data-creation-mode-target="editor"
              data-creation-morph-id="panel:export"
            >
              <span className="creation-mode-mini-panel-title">Export</span>
              <span className="creation-mode-mini-setting" />
              <span className="creation-mode-mini-setting creation-mode-mini-setting--short" />
              <span className="creation-mode-mini-export-button" />
            </span>
            <span
              className="creation-mode-piece creation-mode-mini-panel creation-mode-mini-timeline"
              data-creation-mode-target="editor"
              data-creation-morph-id="panel:timeline"
            >
              <span className="creation-mode-mini-panel-title">Timeline</span>
              <span className="creation-mode-mini-track creation-mode-mini-track--one"><i /><i /></span>
              <span className="creation-mode-mini-track creation-mode-mini-track--two"><i /><i /><i /></span>
            </span>
          </span>
          <span className="creation-mode-option-action">
            <span className="creation-mode-piece creation-mode-option-access-label">
              <span className="creation-mode-option-access-copy">
                Available via <strong className="creation-mode-option-access-channel">MCP</strong>
              </span>
              <span className="creation-mode-option-access-shine" aria-hidden="true">
                Available via <strong className="creation-mode-option-access-channel">MCP</strong>
              </span>
            </span>
            <span className="creation-mode-piece creation-mode-option-action-label">
              Open video editor
            </span>
            <IconArrowUpRight
              className="creation-mode-piece creation-mode-option-arrow"
              aria-hidden="true"
            />
          </span>
        </a>
        </nav>
      </div>
      </main>
    </>
  );
}

export default CreationModeLandingPage;
