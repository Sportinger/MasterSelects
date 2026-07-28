import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { IconArrowRight, IconArrowUp } from '@tabler/icons-react';
import './landing.css';

const MAX_INPUT_HEIGHT = 152;

export interface LandingPageProps {
  isOpeningEditor?: boolean;
  onOpenEditor?: () => void;
  onSubmitPrompt?: (prompt: string) => Promise<void> | void;
}

export function LandingPage({
  isOpeningEditor = false,
  onOpenEditor,
  onSubmitPrompt,
}: LandingPageProps) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'MasterSelects — Start creating';

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const resizeInput = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(event.target.value);
    resizeInput(event.target);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();

    if (!prompt || isSubmitting) {
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setAnnouncement('');

    try {
      await onSubmitPrompt?.(prompt);
      setDraft('');
      setAnnouncement(
        onSubmitPrompt
          ? 'Message sent.'
          : 'Prompt received in the design preview. The live chat connection comes next.',
      );

      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
    } catch {
      setAnnouncement('The message could not be sent. Please try again.');
    } finally {
      setIsSubmitting(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return (
    <main className={`landing-page ${isOpeningEditor ? 'is-opening-editor' : ''}`}>
      <div className="landing-atmosphere" aria-hidden="true" />

      {onOpenEditor && (
        <button
          className="landing-open-editor"
          type="button"
          aria-label="Open MasterSelects editor"
          disabled={isOpeningEditor}
          onClick={onOpenEditor}
        >
          <span>{isOpeningEditor ? 'Opening' : 'Open'}</span>
          <IconArrowRight aria-hidden="true" />
        </button>
      )}

      <form
        className="landing-chat-pill"
        aria-label="Start a MasterSelects conversation"
        onSubmit={handleSubmit}
      >
        <span className="landing-chat-orb" aria-hidden="true" />
        <label className="landing-visually-hidden" htmlFor="landing-chat-input">
          Message
        </label>
        <textarea
          ref={textareaRef}
          id="landing-chat-input"
          className="landing-chat-input"
          aria-describedby="landing-chat-status"
          autoComplete="off"
          autoFocus
          enterKeyHint="send"
          maxLength={4000}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="What would you like to create?"
          rows={1}
          value={draft}
        />
        <button
          className="landing-chat-send"
          type="submit"
          aria-label="Send message"
          disabled={!draft.trim() || isSubmitting}
        >
          {isSubmitting ? <span className="landing-chat-spinner" aria-hidden="true" /> : <IconArrowUp aria-hidden="true" />}
        </button>
        <span
          id="landing-chat-status"
          className="landing-visually-hidden"
          aria-live="polite"
          role="status"
        >
          {announcement}
        </span>
      </form>
    </main>
  );
}
