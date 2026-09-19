import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { LegalDialog } from './components/common/LegalDialog';
import { APP_BUILD_ID } from './services/appBuild';
import { AppLoadingScreen } from './components/common/AppLoadingScreen';
import { AccountDialogHost } from './components/common/AccountDialogHost';
import { loadEditorAppModule, preloadEditorRuntime } from './editorEntryLoader';
import {
  captureCreationModeMorphSnapshot,
  captureCreationModeTargetSnapshot,
  runCreationModeMorph,
  runCreationModeReverseMorph,
} from './marketing/creationModeMorph';
import type { CreationModeTarget } from './marketing/CreationModeLandingPage';
import {
  createLandingBackedEntryState,
  isEnglishLegalPath,
  resolveEntryExperience,
  type EntryExperience,
} from './routing/entryExperience';
import { productAnalytics } from './services/productAnalytics';
import { readAcquisitionAttribution } from './services/productAnalytics/acquisitionAttribution';
import { getRuntimeDeviceContext } from './utils/runtimeDeviceContext';

const EditorApp = lazy(loadEditorAppModule);
const CreditClaimPage = lazy(() =>
  import('./creditClaims/CreditClaimPage').then((module) => ({ default: module.CreditClaimPage }))
);
const CreationModeLandingPage = lazy(() =>
  import('./marketing/CreationModeLandingPage').then((module) => ({
    default: module.CreationModeLandingPage,
  }))
);

const CREATION_MODE_EXIT_DURATION_MS = 800;

interface RootAppProps {
  initialExperience: EntryExperience;
}

export function RootApp({ initialExperience }: RootAppProps) {
  const [activeExperience, setActiveExperience] = useState(initialExperience);
  const [creationModeEasyViewportReady, setCreationModeEasyViewportReady] = useState(false);
  const [showInitialLandingReveal, setShowInitialLandingReveal] = useState(
    initialExperience === 'landing',
  );
  const [creationModeEnterSource, setCreationModeEnterSource] = useState<CreationModeTarget | null>(null);
  const [creationModeExitTarget, setCreationModeExitTarget] = useState<CreationModeTarget | null>(null);
  const [preloadedEditorApp, setPreloadedEditorApp] = useState<
    typeof import('./App')['default'] | null
  >(null);
  const creationModeExitTimeoutRef = useRef<number | null>(null);
  const creationModeTransitionStartedRef = useRef(false);
  const pendingEasyOpenRef = useRef<{
    nextExperience: CreationModeTarget;
    targetUrl: URL;
  } | null>(null);
  const hasTrackedEntryRef = useRef(false);

  useEffect(() => {
    const isFirstEntry = !hasTrackedEntryRef.current;
    hasTrackedEntryRef.current = true;

    if (activeExperience === 'landing') {
      productAnalytics.track('landing_viewed', {
        entry_source: isFirstEntry ? 'direct' : 'return',
      });
      return;
    }
    if (
      activeExperience !== 'editor'
      && activeExperience !== 'chat'
      && activeExperience !== 'medium'
    ) return;

    const runtime = getRuntimeDeviceContext();
    const query = new URLSearchParams(window.location.search);
    productAnalytics.track('app_opened', {
      build_id: APP_BUILD_ID,
      ...readAcquisitionAttribution(query),
      device_class: runtime.deviceClass,
      experience: activeExperience,
      language: navigator.language || 'unknown',
      platform: runtime.platform,
    });

    if (query.get('billing') === 'success') {
      productAnalytics.track('checkout_returned', {
        plan: query.get('plan') || 'unknown',
      });
    }
  }, [activeExperience]);

  useEffect(() => {
    if (activeExperience !== 'landing') return;
    void preloadEditorRuntime()
      .then((editorAppModule) => {
        setPreloadedEditorApp(() => editorAppModule.default);
      })
      .catch(() => undefined);
  }, [activeExperience]);

  useEffect(() => () => {
    if (creationModeExitTimeoutRef.current !== null) {
      window.clearTimeout(creationModeExitTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      const nextExperience = resolveEntryExperience(window.location);
      const creationModeSource = activeExperience === 'chat'
        ? 'chat'
        : activeExperience === 'editor'
          ? 'editor'
          : activeExperience === 'medium'
            ? 'medium'
            : null;

      if (nextExperience !== 'landing' || !creationModeSource) {
        setActiveExperience(nextExperience);
        return;
      }

      const sourceSnapshot = captureCreationModeTargetSnapshot(creationModeSource);
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      creationModeTransitionStartedRef.current = true;
      setShowInitialLandingReveal(false);
      setCreationModeEasyViewportReady(false);
      setCreationModeEnterSource(creationModeSource);
      setCreationModeExitTarget(null);
      setActiveExperience('landing');

      if (reduceMotion) {
        setCreationModeEnterSource(null);
        creationModeTransitionStartedRef.current = false;
        return;
      }

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const creationModeRoot = document.querySelector<HTMLElement>('.creation-mode-page');
          if (!creationModeRoot) return;
          const destinationSnapshot = captureCreationModeMorphSnapshot(
            creationModeRoot,
            creationModeSource,
          );
          void runCreationModeReverseMorph(
            destinationSnapshot,
            sourceSnapshot,
            720,
          );
        });
      });

      if (creationModeExitTimeoutRef.current !== null) {
        window.clearTimeout(creationModeExitTimeoutRef.current);
      }
      creationModeExitTimeoutRef.current = window.setTimeout(() => {
        setCreationModeEnterSource(null);
        creationModeTransitionStartedRef.current = false;
        creationModeExitTimeoutRef.current = null;
      }, CREATION_MODE_EXIT_DURATION_MS);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [activeExperience]);

  useEffect(() => {
    if (creationModeEnterSource !== 'chat' || !creationModeEasyViewportReady) return;

    if (creationModeExitTimeoutRef.current !== null) {
      window.clearTimeout(creationModeExitTimeoutRef.current);
    }
    creationModeExitTimeoutRef.current = window.setTimeout(() => {
      setCreationModeEnterSource(null);
      creationModeTransitionStartedRef.current = false;
      creationModeExitTimeoutRef.current = null;
    }, CREATION_MODE_EXIT_DURATION_MS);
  }, [creationModeEasyViewportReady, creationModeEnterSource]);

  const runEditorExperienceTransition = useCallback((
    nextExperience: CreationModeTarget,
    targetUrl: URL,
  ) => {
    void preloadEditorRuntime()
      .then((editorAppModule) => {
        const creationModeRoot = document.querySelector<HTMLElement>('.creation-mode-page');
        const morphSnapshot = creationModeRoot
          ? captureCreationModeMorphSnapshot(creationModeRoot, nextExperience)
          : null;

        setPreloadedEditorApp(() => editorAppModule.default);
        setShowInitialLandingReveal(false);
        setCreationModeExitTarget(nextExperience);
        window.history.pushState(
          createLandingBackedEntryState(window.history.state),
          '',
          `${targetUrl.pathname}${targetUrl.search}${targetUrl.hash}`,
        );
        setActiveExperience(nextExperience);

        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
        if (reduceMotion) {
          setCreationModeExitTarget(null);
          creationModeTransitionStartedRef.current = false;
          return;
        }

        if (morphSnapshot) {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              void runCreationModeMorph(morphSnapshot, 720);
            });
          });
        }

        creationModeExitTimeoutRef.current = window.setTimeout(() => {
          setCreationModeExitTarget(null);
          creationModeTransitionStartedRef.current = false;
          creationModeExitTimeoutRef.current = null;
        }, CREATION_MODE_EXIT_DURATION_MS);
      })
      .catch(() => {
        creationModeTransitionStartedRef.current = false;
        window.location.assign(targetUrl.href);
      });
  }, []);

  const openEditorExperience = useCallback((
    nextExperience: CreationModeTarget,
    href: string,
  ) => {
    if (creationModeTransitionStartedRef.current) return;

    const targetUrl = new URL(href, window.location.href);
    if (targetUrl.origin !== window.location.origin) {
      window.location.assign(targetUrl.href);
      return;
    }

    creationModeTransitionStartedRef.current = true;
    if (nextExperience === 'chat' && !creationModeEasyViewportReady) {
      pendingEasyOpenRef.current = { nextExperience, targetUrl };
      void preloadEditorRuntime()
        .then((editorAppModule) => {
          setPreloadedEditorApp(() => editorAppModule.default);
        })
        .catch(() => {
          pendingEasyOpenRef.current = null;
          creationModeTransitionStartedRef.current = false;
          window.location.assign(targetUrl.href);
        });
      return;
    }

    runEditorExperienceTransition(nextExperience, targetUrl);
  }, [creationModeEasyViewportReady, runEditorExperienceTransition]);

  const markCreationModeEasyViewportReady = useCallback(() => {
    setCreationModeEasyViewportReady(true);
    const pendingEasyOpen = pendingEasyOpenRef.current;
    if (!pendingEasyOpen) return;

    pendingEasyOpenRef.current = null;
    runEditorExperienceTransition(
      pendingEasyOpen.nextExperience,
      pendingEasyOpen.targetUrl,
    );
  }, [runEditorExperienceTransition]);

  if (
    activeExperience === 'imprint'
    || activeExperience === 'privacy'
    || activeExperience === 'terms'
    || activeExperience === 'withdrawal'
    || activeExperience === 'cancellation'
  ) {
    return (
      <LegalDialog
        initialLang={isEnglishLegalPath(window.location.pathname) ? 'en' : 'de'}
        initialPage={activeExperience}
        onClose={() => window.location.assign('/editor')}
      />
    );
  }

  if (activeExperience === 'creditClaim') {
    return (
      <Suspense fallback={<AppLoadingScreen label="Opening credit claim" />}>
        <CreditClaimPage />
      </Suspense>
    );
  }

  const EditorAppForRender = preloadedEditorApp ?? EditorApp;
  const explicitEditorExperience = (
    activeExperience === 'editor'
    || activeExperience === 'chat'
    || activeExperience === 'medium'
  ) ? activeExperience : null;
  const editorExperience = explicitEditorExperience ?? (
    activeExperience === 'landing' && preloadedEditorApp
      ? 'chat'
      : null
  );
  const showCreationMode = (
    activeExperience === 'landing'
    || creationModeExitTarget !== null
  );
  const editorStageTransitionClass = creationModeExitTarget === 'chat'
    ? creationModeEasyViewportReady
      ? 'is-opening-easy'
      : 'is-creation-mode-preview'
    : activeExperience === 'landing'
      ? creationModeEnterSource === 'chat'
        ? creationModeEasyViewportReady
          ? 'is-returning-easy'
          : 'is-returning-easy-pending'
        : creationModeEnterSource === 'editor'
          ? 'is-creation-mode-preview is-returning-hard'
          : creationModeEnterSource === 'medium'
            ? 'is-creation-mode-preview is-returning-hard'
          : 'is-creation-mode-preview'
      : '';
  const editorStageIsInert = (
    activeExperience === 'landing'
    || creationModeExitTarget !== null
    || creationModeEnterSource !== null
  );

  return (
    <>
      {editorExperience && (
        <div
          aria-hidden={editorStageIsInert || undefined}
          className={`creation-mode-editor-stage ${editorStageTransitionClass}`.trim()}
          data-creation-mode-editor-stage
          inert={editorStageIsInert || undefined}
          style={{ height: '100%', width: '100%' }}
        >
          <Suspense
            key="editor-experience"
            fallback={<AppLoadingScreen />}
          >
            <EditorAppForRender initialExperience={editorExperience} />
          </Suspense>
        </div>
      )}
      {editorExperience && editorStageTransitionClass && (
        <div
          aria-hidden="true"
          className={`creation-mode-editor-window-shadow ${editorStageTransitionClass}`.trim()}
        />
      )}
      {editorExperience && editorStageTransitionClass && (
        <div
          aria-hidden="true"
          className={`creation-mode-editor-window-mask ${editorStageTransitionClass}`.trim()}
        />
      )}
      {showCreationMode && (
        <Suspense
          key="creation-mode"
          fallback={<AppLoadingScreen />}
        >
          <CreationModeLandingPage
            isEditorReady={preloadedEditorApp !== null}
            isEntering={creationModeEnterSource !== null}
            isExiting={creationModeExitTarget !== null}
            onEasyViewportReady={markCreationModeEasyViewportReady}
            onOpenExperience={openEditorExperience}
            playInitialReveal={showInitialLandingReveal}
          />
        </Suspense>
      )}
      <AccountDialogHost />
    </>
  );
}

export default RootApp;
