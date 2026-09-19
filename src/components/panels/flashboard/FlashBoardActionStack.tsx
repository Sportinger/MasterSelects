import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_FLASHBOARD_DECISION_POLICY,
  type DecisionPolicy,
} from '../../../services/flashboard/FlashBoardChatService';
import { setFlashBoardGuidedMode } from '../../../services/flashboard/FlashBoardGuidedMode';
import {
  DEFAULT_SEEDANCE_STORY_PREFERENCES,
  type SeedanceStoryPreferences,
} from '../../../services/seedancePreproduction/orchestrationContracts';

interface FlashBoardActionStackProps {
  canGenerate: boolean;
  chatButtonLabel: string;
  chatButtonTitle: string;
  chatPanelOpen: boolean;
  generateButtonLabel: string;
  generateButtonTitle: string;
  isChatting: boolean;
  decisionPolicy?: DecisionPolicy;
  onChatButtonClick: () => void | Promise<void>;
  onGenerate: () => void;
  onDecisionPolicyChange?: (policy: DecisionPolicy) => void;
  onSeedanceStart?: () => void | Promise<void>;
  seedanceStartDisabled?: boolean;
  seedanceStartTitle?: string;
  storyPreferences?: SeedanceStoryPreferences;
  onStoryPreferencesChange?: (preferences: SeedanceStoryPreferences) => void;
}

const STORY_PREFERENCE_ROWS = [
  {
    key: 'directionCount',
    label: 'Directions',
    options: [['auto', 'Auto'], ['one', '1'], ['five', '5']],
  },
  {
    key: 'aiGeneration',
    label: 'AI media',
    options: [['auto', 'Auto'], ['enabled', 'On'], ['disabled', 'Off']],
  },
  {
    key: 'commons',
    label: 'Commons',
    options: [['auto', 'Auto'], ['enabled', 'On'], ['disabled', 'Off']],
  },
  {
    key: 'scenePlanning',
    label: 'Scenes',
    options: [['auto', 'Auto'], ['root', 'Root'], ['agents', 'Agents']],
  },
] as const;

export function FlashBoardActionStack({
  canGenerate,
  chatButtonLabel,
  chatButtonTitle,
  chatPanelOpen,
  generateButtonLabel,
  generateButtonTitle,
  isChatting,
  decisionPolicy = DEFAULT_FLASHBOARD_DECISION_POLICY,
  onChatButtonClick,
  onGenerate,
  onDecisionPolicyChange,
  onSeedanceStart,
  seedanceStartDisabled = false,
  seedanceStartTitle = 'Start Story',
  storyPreferences = DEFAULT_SEEDANCE_STORY_PREFERENCES,
  onStoryPreferencesChange,
}: FlashBoardActionStackProps) {
  const storySelected = decisionPolicy !== 'automatic';
  const automaticPathLabel = import.meta.env.DEV ? 'Direkt' : 'Auto';
  const [routeMenuOpen, setRouteMenuOpen] = useState(false);
  const [storyPreferencesMounted, setStoryPreferencesMounted] = useState(storySelected);
  const routeChoiceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (storySelected) {
      const animationFrameId = window.requestAnimationFrame(() => {
        setStoryPreferencesMounted(true);
      });
      return () => window.cancelAnimationFrame(animationFrameId);
    }
    if (!storyPreferencesMounted) return;
    const timeoutId = window.setTimeout(() => setStoryPreferencesMounted(false), 190);
    return () => window.clearTimeout(timeoutId);
  }, [storyPreferencesMounted, storySelected]);
  useEffect(() => {
    if (!routeMenuOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!routeChoiceRef.current?.contains(event.target as Node)) setRouteMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [routeMenuOpen]);
  const selectRoute = (nextPolicy: DecisionPolicy) => {
    setFlashBoardGuidedMode(nextPolicy !== 'automatic');
    onDecisionPolicyChange?.(nextPolicy);
    setRouteMenuOpen(false);
  };
  const startChat = () => {
    setFlashBoardGuidedMode(storySelected);
    if (storySelected && onSeedanceStart) {
      void onSeedanceStart();
      return;
    }
    void onChatButtonClick();
  };
  const setStoryPreference = <Key extends keyof SeedanceStoryPreferences>(
    key: Key,
    value: SeedanceStoryPreferences[Key],
  ) => onStoryPreferencesChange?.({ ...storyPreferences, [key]: value });

  return (
    <div className="fb-action-stack">
      {chatPanelOpen && storyPreferencesMounted && (
        <div
          className={`fb-story-preferences ${storySelected ? 'is-entering' : 'is-exiting'}`}
          aria-label="Story workflow preferences"
        >
          {STORY_PREFERENCE_ROWS.map((row) => (
            <div className="fb-story-preference-row" key={row.key}>
              <span>{row.label}</span>
              <div role="group" aria-label={row.label}>
                {row.options.map(([value, label]) => (
                  <button
                    aria-pressed={storyPreferences[row.key] === value}
                    className={storyPreferences[row.key] === value ? 'active' : ''}
                    data-value={value}
                    key={value}
                    type="button"
                    onClick={() => setStoryPreference(row.key, value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {chatPanelOpen ? (
        <div className="fb-chat-split-button">
          <div
            ref={routeChoiceRef}
            className="fb-chat-route-choice"
          >
            <button
              className="fb-chat-decision-policy"
              type="button"
              aria-label={`Prompt path: ${storySelected ? 'Story' : automaticPathLabel}`}
              aria-haspopup="menu"
              aria-expanded={routeMenuOpen}
              data-value={decisionPolicy}
              disabled={isChatting}
              onClick={() => setRouteMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRouteMenuOpen(false);
              }}
              title="Choose the path for the current prompt."
            >
              <span>{storySelected ? 'Story' : automaticPathLabel}</span>
              <svg
                className="fb-chat-route-chevron"
                viewBox="0 0 12 12"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path d="m3 4.5 3 3 3-3" />
              </svg>
            </button>
            {routeMenuOpen && (
              <div className="fb-chat-route-menu" role="menu" aria-label="Prompt path">
                <button
                  className={!storySelected ? 'active' : ''}
                  type="button"
                  role="menuitemradio"
                  aria-checked={!storySelected}
                  onClick={() => selectRoute('automatic')}
                >
                  {automaticPathLabel}
                </button>
                <button
                  className={storySelected ? 'active' : ''}
                  type="button"
                  role="menuitemradio"
                  aria-checked={storySelected}
                  onClick={() => selectRoute('milestones')}
                >
                  Story
                </button>
              </div>
            )}
          </div>
          <button
            className="fb-generate fb-chat-button active"
            type="button"
            onClick={startChat}
            title={storySelected ? seedanceStartTitle : chatButtonTitle}
            disabled={storySelected && seedanceStartDisabled}
          >
            <svg
              className="fb-generate-icon"
              viewBox="0 0 16 16"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <path d="M3.4 3.5h9.2a1.8 1.8 0 0 1 1.8 1.8v4.4a1.8 1.8 0 0 1-1.8 1.8H7.2L3.6 14v-2.5h-.2a1.8 1.8 0 0 1-1.8-1.8V5.3a1.8 1.8 0 0 1 1.8-1.8Z" />
              <path d="M5 6.5h6M5 8.9h4" />
            </svg>
            <span>{chatButtonLabel}</span>
          </button>
        </div>
      ) : (
        <button
          className="fb-generate"
          disabled={!canGenerate}
          onClick={onGenerate}
          title={generateButtonTitle}
        >
          <svg
            className="fb-generate-icon"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            aria-hidden="true"
          >
            <path d="M8 1.5 9.2 5 13 6.2 9.2 7.4 8 11 6.8 7.4 3 6.2 6.8 5 8 1.5Z" />
            <path d="m12.4 10.4.5 1.4 1.5.5-1.5.5-.5 1.4-.5-1.4-1.5-.5 1.5-.5.5-1.4Z" />
          </svg>
          <span>{generateButtonLabel}</span>
        </button>
      )}
    </div>
  );
}
