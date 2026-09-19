import {
  useCallback,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { appendPromptDictationText } from '../components/common/PromptDictationButton';
import type { LandingBackgroundStatus } from './runLandingBackgroundCreation';
import { resizeLandingChatInput } from './landingInputLayout';

export function useLandingPromptDictation(
  setDraft: Dispatch<SetStateAction<string>>,
  setActivityStatus: Dispatch<SetStateAction<LandingBackgroundStatus | null>>,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  maximumInputHeight: number,
) {
  return useCallback((transcript: string) => {
    setDraft(current => appendPromptDictationText(current, transcript).slice(0, 4000));
    setActivityStatus(null);
    window.requestAnimationFrame(() => {
      if (textareaRef.current) resizeLandingChatInput(textareaRef.current, maximumInputHeight);
      textareaRef.current?.focus();
    });
  }, [maximumInputHeight, setActivityStatus, setDraft, textareaRef]);
}
