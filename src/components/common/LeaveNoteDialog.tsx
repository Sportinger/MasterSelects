import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { submitSupportNote } from '../../services/supportNoteService';
import { useDraggableDialog } from './settings/useDraggableDialog';
import './LeaveNoteDialog.css';

interface LeaveNoteDialogProps {
  onClose: () => void;
  submitNote?: (message: string) => Promise<void>;
}

type SubmitState = 'idle' | 'submitting' | 'success';

export function LeaveNoteDialog({
  onClose,
  submitNote = submitSupportNote,
}: LeaveNoteDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>('idle');
  const isSubmitting = submitState === 'submitting';
  const { position, isDragging, handleMouseDown } = useDraggableDialog(dialogRef);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  useEffect(() => {
    if (submitState !== 'success') return;

    const closeTimer = window.setTimeout(onClose, 1000);
    return () => window.clearTimeout(closeTimer);
  }, [onClose, submitState]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSubmitting) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };

    window.addEventListener('keydown', handleEscape, true);
    return () => window.removeEventListener('keydown', handleEscape, true);
  }, [isSubmitting, onClose]);

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;

    const note = message.trim();
    if (!note) {
      textareaRef.current?.focus();
      return;
    }

    setError(null);
    setSubmitState('submitting');

    try {
      await submitNote(note);
      setSubmitState('success');
    } catch {
      setError('Could not send your note. Please try again.');
      setSubmitState('idle');
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="leave-note-backdrop" role="presentation">
      <div
        ref={dialogRef}
        className={`leave-note-dialog${submitState === 'success' ? ' is-success' : ''}${isDragging ? ' is-dragging' : ''}`}
        style={{
          left: position.x,
          top: position.y,
        }}
        role="dialog"
        aria-labelledby={titleId}
        onKeyDown={handleDialogKeyDown}
      >
        {submitState === 'success' ? (
          <div className="leave-note-thanks" role="status">
            <span aria-hidden="true">✓</span>
            <strong id={titleId}>Thanks!</strong>
            <small>Your note was sent.</small>
          </div>
        ) : (
          <>
            <div className="leave-note-accent" aria-hidden="true" />
            <div className="leave-note-header" onMouseDown={handleMouseDown}>
              <h2 id={titleId}>Leave a note</h2>
              <button
                type="button"
                className="leave-note-close"
                aria-label="Close note dialog"
                disabled={isSubmitting}
                onClick={onClose}
                onMouseDown={(event) => event.stopPropagation()}
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmit}>
              <label className="leave-note-field">
                <span className="sr-only">Your note</span>
                <textarea
                  ref={textareaRef}
                  value={message}
                  maxLength={2000}
                  placeholder="Write your note..."
                  disabled={isSubmitting}
                  aria-invalid={error ? 'true' : undefined}
                  aria-describedby={error ? `${titleId}-error` : undefined}
                  onChange={(event) => {
                    setMessage(event.target.value);
                    if (error) setError(null);
                  }}
                />
              </label>

              {error && (
                <div id={`${titleId}-error`} className="leave-note-error" role="alert">
                  {error}
                </div>
              )}

              <div className="leave-note-actions">
                <button
                  type="button"
                  className="leave-note-button secondary"
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="leave-note-button primary"
                  disabled={isSubmitting || !message.trim()}
                >
                  {isSubmitting ? (
                    <>
                      <span className="leave-note-spinner" aria-hidden="true" />
                      Sending...
                    </>
                  ) : 'Send'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
