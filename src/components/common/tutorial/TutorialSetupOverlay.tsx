import { useCallback, useEffect, useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';
import { ClippyMascot } from './ClippyMascot';
import { productAnalytics } from '../../../services/productAnalytics';
import './TutorialSetupOverlay.css';

const BACKGROUND_CHOICES = [
  { id: 'premiere', label: 'Premiere Pro' },
  { id: 'davinci', label: 'DaVinci Resolve' },
  { id: 'finalcut', label: 'Final Cut Pro' },
  { id: 'aftereffects', label: 'After Effects' },
  { id: 'beginner', label: 'Beginner' },
] as const;

type BackgroundId = typeof BACKGROUND_CHOICES[number]['id'];

interface TutorialSetupOverlayProps {
  onCancel: () => void;
  onComplete: () => void;
}

export function TutorialSetupOverlay({
  onCancel,
  onComplete,
}: TutorialSetupOverlayProps) {
  const [selectedLabel, setSelectedLabel] = useState<string | null>(null);
  const setUserBackground = useSettingsStore((state) => state.setUserBackground);
  const setActiveShortcutPreset = useSettingsStore((state) => state.setActiveShortcutPreset);

  useEffect(() => {
    productAnalytics.track('setup_started');
  }, []);

  const chooseBackground = useCallback((id: BackgroundId) => {
    const choice = BACKGROUND_CHOICES.find((candidate) => candidate.id === id);
    setUserBackground(id);
    setActiveShortcutPreset(id);
    setSelectedLabel(choice?.label ?? id);
    productAnalytics.track('setup_background_selected', { background: id });
  }, [setActiveShortcutPreset, setUserBackground]);

  const cancelSetup = useCallback(() => {
    productAnalytics.track('setup_cancelled', {
      stage: selectedLabel ? 'confirmation' : 'background',
    });
    onCancel();
  }, [onCancel, selectedLabel]);

  const completeSetup = useCallback(() => {
    if (selectedLabel) {
      const selected = BACKGROUND_CHOICES.find((choice) => choice.label === selectedLabel);
      productAnalytics.track('setup_completed', {
        background: selected?.id ?? 'beginner',
      });
    }
    onComplete();
  }, [onComplete, selectedLabel]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelSetup();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [cancelSetup]);

  return (
    <div
      className="tutorial-setup-backdrop"
      onContextMenu={(event) => {
        event.preventDefault();
        if (selectedLabel) setSelectedLabel(null);
      }}
    >
      <section className="tutorial-setup-card" aria-modal="true" role="dialog">
        <div className="tutorial-setup-clippy" aria-hidden="true">
          <ClippyMascot isClosing={false} />
        </div>

        <div className="tutorial-setup-progress">
          <span>Getting started</span>
          <span>{selectedLabel ? '2 / 2' : '1 / 2'}</span>
        </div>

        <div className="tutorial-setup-content">
          {selectedLabel ? (
            <>
            <h1>Shortcuts switched</h1>
            <p>
              Your keyboard shortcuts now follow the <strong>{selectedLabel}</strong> layout.
              You can change this anytime in Settings → Shortcuts.
            </p>
            <div className="tutorial-setup-confirmation">
              <span className="tutorial-setup-confirmation-mark">✓</span>
              <div>
                <strong>{selectedLabel}</strong>
                <span>Shortcut preset is active</span>
              </div>
            </div>
            </>
          ) : (
            <>
            <h1>Where are you coming from?</h1>
            <p>We’ll match familiar shortcuts, then walk through the editor from start to finish.</p>
            <div className="tutorial-setup-grid">
              {BACKGROUND_CHOICES.map((choice) => (
                <button
                  key={choice.id}
                  type="button"
                  className="tutorial-setup-choice"
                  onClick={() => chooseBackground(choice.id)}
                >
                  <span className="tutorial-setup-choice-name">{choice.label}</span>
                </button>
              ))}
            </div>
            </>
          )}
        </div>

        <footer className="tutorial-setup-footer">
          <div className="tutorial-setup-footer-exit">
            <button
              type="button"
              className="tutorial-setup-exit"
              onClick={cancelSetup}
            >
              End walkthrough
            </button>
            <span>Esc anytime</span>
          </div>
          {selectedLabel && (
            <div className="tutorial-setup-actions">
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--quiet"
                onClick={() => setSelectedLabel(null)}
              >
                Back
              </button>
              <button
                type="button"
                className="tutorial-setup-button tutorial-setup-button--primary"
                onClick={completeSetup}
              >
                Start walkthrough
              </button>
            </div>
          )}
        </footer>
      </section>
    </div>
  );
}
