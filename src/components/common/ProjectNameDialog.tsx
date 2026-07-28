import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import './ProjectNameDialog.css';
import { validateProjectName } from './projectNameValidation';

export type ProjectNameDialogMode = 'new' | 'save' | 'saveAs';

export interface ProjectNameDialogRequest {
  mode: ProjectNameDialogMode;
  initialName: string;
  hasUnsavedChanges?: boolean;
}

interface ProjectNameDialogProps extends ProjectNameDialogRequest {
  onClose: () => void;
  onSubmit: (name: string) => Promise<string | null>;
  restoreFocusTo?: HTMLElement | null;
}

const MODE_COPY: Record<ProjectNameDialogMode, {
  action: string;
  description: string;
  kicker: string;
  title: string;
}> = {
  new: {
    action: 'Choose Location',
    description: 'Name the project before choosing where its files should be stored.',
    kicker: 'Project setup',
    title: 'Create a new project',
  },
  save: {
    action: 'Choose Location',
    description: 'Give this project a name before choosing where to save it.',
    kicker: 'Project setup',
    title: 'Save your project',
  },
  saveAs: {
    action: 'Save As',
    description: 'Create a separate project folder with the current edit.',
    kicker: 'Project copy',
    title: 'Save project as',
  },
};

export function ProjectNameDialog({
  mode,
  initialName,
  hasUnsavedChanges = false,
  onClose,
  onSubmit,
  restoreFocusTo,
}: ProjectNameDialogProps) {
  const copy = MODE_COPY[mode];
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const previouslyFocused = restoreFocusTo ?? document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();

    return () => {
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [restoreFocusTo]);

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
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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

    const normalizedName = draft.trim();
    const validationError = validateProjectName(normalizedName);
    if (validationError) {
      setError(validationError);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const submitError = await onSubmit(normalizedName);
      if (submitError) {
        setError(submitError);
        setIsSubmitting(false);
        inputRef.current?.focus();
        return;
      }
      onClose();
    } catch {
      setError('The project could not be created. Please try again.');
      setIsSubmitting(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div
      className="project-name-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="project-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onKeyDown={handleDialogKeyDown}
      >
        <div className="project-name-dialog-accent" aria-hidden="true" />

        <div className="project-name-dialog-header">
          <div className="project-name-dialog-icon" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3.75 6.75h5l1.6 2h9.9v8.5a2 2 0 0 1-2 2H5.75a2 2 0 0 1-2-2V6.75Z" />
              <path d="M3.75 9.1h16.5" />
              <path d="M12 12v4M10 14h4" />
            </svg>
          </div>
          <div>
            <div className="project-name-dialog-kicker">{copy.kicker}</div>
            <h2 id={titleId}>{copy.title}</h2>
          </div>
          <button
            type="button"
            className="project-name-dialog-close"
            aria-label="Close project dialog"
            disabled={isSubmitting}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <p id={descriptionId} className="project-name-dialog-description">
            {copy.description}
          </p>

          {mode === 'new' && hasUnsavedChanges && (
            <div className="project-name-dialog-warning" role="note">
              <span aria-hidden="true">!</span>
              <div>
                <strong>Unsaved changes</strong>
                <p>The current edit will be replaced after the new project is created.</p>
              </div>
            </div>
          )}

          <label className="project-name-dialog-field">
            <span>Project name</span>
            <input
              ref={inputRef}
              type="text"
              value={draft}
              maxLength={120}
              autoComplete="off"
              spellCheck={false}
              disabled={isSubmitting}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? `${descriptionId}-error` : `${descriptionId}-hint`}
              onChange={(event) => {
                setDraft(event.target.value);
                if (error) setError(null);
              }}
            />
          </label>

          <div className="project-name-dialog-feedback">
            {error ? (
              <div id={`${descriptionId}-error`} className="project-name-dialog-error" role="alert">
                {error}
              </div>
            ) : (
              <div id={`${descriptionId}-hint`} className="project-name-dialog-hint">
                Spaces are allowed. The project folder will use this name.
              </div>
            )}
          </div>

          <div className="project-name-dialog-actions">
            <button
              type="button"
              className="project-name-dialog-button secondary"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Cancel
              <kbd>Esc</kbd>
            </button>
            <button
              type="submit"
              className="project-name-dialog-button primary"
              disabled={isSubmitting || !draft.trim()}
            >
              {isSubmitting ? (
                <>
                  <span className="project-name-dialog-spinner" aria-hidden="true" />
                  Working...
                </>
              ) : (
                <>
                  {copy.action}
                  <kbd>Enter</kbd>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
