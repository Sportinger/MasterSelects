import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  IconArrowRight,
  IconArrowUp,
  IconPhoto,
  IconUpload,
  IconVideo,
} from '@tabler/icons-react';
import type {
  LandingBackgroundStatus,
  LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';
import './landing.css';

const MAX_INPUT_HEIGHT = 152;
const COMPLETION_STATUS_DURATION_MS = 1800;

export type LandingProjectMediaType = 'audio' | 'image' | 'text' | 'video';

export interface LandingProjectMediaItem {
  duration?: number;
  id: string;
  isFinalOutput?: boolean;
  mediaUrl?: string;
  name: string;
  previewUrl?: string;
  textPreview?: string;
  type: LandingProjectMediaType;
}

export interface LandingPageProps {
  backgroundActivityStatus?: LandingBackgroundStatus | null;
  backgroundJobRunning?: boolean;
  isOpeningEditor?: boolean;
  onOpenEditor?: () => void;
  onOpenChat?: (
    prompt?: string,
    onStatus?: LandingBackgroundStatusReporter,
  ) => Promise<void> | void;
  onDropProjectMedia?: (dataTransfer: DataTransfer) => Promise<number | void>;
  projectMedia?: LandingProjectMediaItem[];
}

function formatDuration(duration: number | undefined): string | null {
  if (!duration || !Number.isFinite(duration)) return null;
  const totalSeconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function LandingMediaPreview({
  compact = false,
  item,
}: {
  compact?: boolean;
  item: LandingProjectMediaItem;
}) {
  const duration = formatDuration(item.duration);

  return (
    <article
      className={`landing-media-file is-${item.type} ${item.isFinalOutput ? 'is-final-output' : ''}`}
      title={item.name}
    >
      <div className="landing-media-file-preview">
        {item.type === 'video' && item.mediaUrl ? (
          compact ? (
            <video
              aria-hidden="true"
              muted
              playsInline
              poster={item.previewUrl}
              preload="metadata"
              src={item.mediaUrl}
            />
          ) : (
            <video
              controls
              playsInline
              poster={item.previewUrl}
              preload="metadata"
              src={item.mediaUrl}
            />
          )
        ) : item.previewUrl ? (
          <img src={item.previewUrl} alt="" draggable={false} />
        ) : item.type === 'audio' ? (
          <span className="landing-audio-waveform" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        ) : item.type === 'text' ? (
          <span className="landing-text-preview">
            {item.textPreview?.trim() || 'Text'}
          </span>
        ) : (
          <span className="landing-file-placeholder" aria-hidden="true">
            {item.type === 'video' ? <IconVideo /> : <IconPhoto />}
          </span>
        )}
        {duration && <span className="landing-media-file-duration">{duration}</span>}
      </div>
      <strong>{item.isFinalOutput ? 'Finished video' : item.name}</strong>
    </article>
  );
}

export function LandingPage({
  backgroundActivityStatus = null,
  backgroundJobRunning = false,
  isOpeningEditor = false,
  onOpenEditor,
  onOpenChat,
  onDropProjectMedia,
  projectMedia = [],
}: LandingPageProps) {
  const [draft, setDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [activityStatus, setActivityStatus] = useState<LandingBackgroundStatus | null>(null);
  const [isFileDragActive, setIsFileDragActive] = useState(false);
  const [isImportingDrop, setIsImportingDrop] = useState(false);
  const dragDepthRef = useRef(0);
  const completionStatusTimeoutRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const projectFiles = useMemo(
    () => projectMedia.filter((item) => !item.isFinalOutput),
    [projectMedia],
  );
  const latestFinalOutput = projectMedia.find((item) => (
    item.type === 'video' && item.isFinalOutput
  ));
  const displayedActivityStatus = backgroundActivityStatus ?? activityStatus;
  const isChatBusy = backgroundJobRunning || isSubmitting;

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'MasterSelects — Start creating';

    return () => {
      document.title = previousTitle;
    };
  }, []);

  useEffect(() => () => {
    if (completionStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionStatusTimeoutRef.current);
    }
  }, []);

  const resizeInput = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, MAX_INPUT_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > MAX_INPUT_HEIGHT ? 'auto' : 'hidden';
  };

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (completionStatusTimeoutRef.current !== null) {
      window.clearTimeout(completionStatusTimeoutRef.current);
      completionStatusTimeoutRef.current = null;
    }
    setActivityStatus(null);
    setDraft(event.target.value);
    resizeInput(event.target);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim();

    if (!prompt || displayedActivityStatus || isChatBusy || isOpeningEditor) {
      textareaRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    setAnnouncement('');
    setActivityStatus({ label: 'Thinking…' });

    try {
      await onOpenChat?.(prompt || undefined, setActivityStatus);
      setDraft('');
      setAnnouncement('AI task completed.');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
        textareaRef.current.style.overflowY = 'hidden';
      }
      completionStatusTimeoutRef.current = window.setTimeout(() => {
        setActivityStatus(null);
        completionStatusTimeoutRef.current = null;
        textareaRef.current?.focus();
      }, COMPLETION_STATUS_DURATION_MS);
    } catch {
      setAnnouncement('The AI task could not be completed. Please try again.');
      setActivityStatus({ label: 'Something went wrong' });
      textareaRef.current?.focus();
      completionStatusTimeoutRef.current = window.setTimeout(() => {
        setActivityStatus(null);
        completionStatusTimeoutRef.current = null;
      }, COMPLETION_STATUS_DURATION_MS);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const hasDraggedFiles = (dataTransfer: DataTransfer) => (
    Array.from(dataTransfer.types ?? []).includes('Files')
  );

  const handleDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsFileDragActive(true);
  };

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setIsFileDragActive(false);
  };

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsFileDragActive(false);
    setIsImportingDrop(true);
    setAnnouncement('');

    const importPromise = onDropProjectMedia
      ? onDropProjectMedia(event.dataTransfer)
      : Promise.resolve(0);

    void importPromise
      .then((count) => {
        if (typeof count === 'number' && count > 0) {
          setAnnouncement(`${count} ${count === 1 ? 'file' : 'files'} added to the project.`);
        }
      })
      .catch(() => {
        setAnnouncement('The files could not be imported.');
      })
      .finally(() => setIsImportingDrop(false));
  };

  return (
    <main
      className={`landing-page ${isOpeningEditor ? 'is-opening-editor' : ''} ${isFileDragActive ? 'is-file-drag-active' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
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

      <div className="landing-content">
        {projectFiles.length > 0 && (
          <section
            className="landing-project-media"
            aria-label="Project files"
          >
            <div className="landing-project-media-heading">
              <p className="landing-eyebrow">Project files</p>
            </div>

            <div className="landing-project-file-strip">
              {projectFiles.map((item) => (
                <LandingMediaPreview compact item={item} key={item.id} />
              ))}
            </div>
          </section>
        )}

        <section className="landing-chat-section" aria-labelledby="landing-chat-heading">
          <p className="landing-eyebrow" id="landing-chat-heading">Start with AI</p>
          <form
            className={`landing-chat-pill ${displayedActivityStatus ? 'is-reporting' : ''}`}
            aria-label="Open MasterSelects AI Chat"
            onSubmit={handleSubmit}
          >
            <span className="landing-chat-orb" aria-hidden="true" />
            <label className="landing-visually-hidden" htmlFor="landing-chat-input">
              Message for AI Chat
            </label>
            <textarea
              ref={textareaRef}
              id="landing-chat-input"
              className="landing-chat-input"
              aria-describedby="landing-chat-status"
              autoComplete="off"
              autoFocus
              enterKeyHint="go"
              maxLength={4000}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="What would you like to create?"
              rows={1}
              value={draft}
            />
            {displayedActivityStatus && (
              <div className="landing-chat-activity" aria-live="polite" role="status">
                <span className="landing-chat-activity-dot" aria-hidden="true" />
                <span className="landing-chat-activity-copy">
                  <strong>{displayedActivityStatus.label}</strong>
                  {displayedActivityStatus.detail && <span>{displayedActivityStatus.detail}</span>}
                </span>
                {displayedActivityStatus.progress !== undefined && (
                  <span className="landing-chat-activity-progress">
                    {displayedActivityStatus.progress}%
                  </span>
                )}
              </div>
            )}
            <button
              className="landing-chat-send"
              type="submit"
              aria-label={isChatBusy ? 'AI is creating the video' : 'Create with AI'}
              data-busy={isChatBusy ? 'true' : 'false'}
              disabled={!draft.trim() || displayedActivityStatus !== null || isChatBusy || isOpeningEditor}
            >
              {isChatBusy ? <span className="landing-chat-spinner" aria-hidden="true" /> : <IconArrowUp aria-hidden="true" />}
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
        </section>

        {latestFinalOutput && (
          <section className="landing-final-output" aria-label="Finished video">
            <div className="landing-final-output-heading">
              <p className="landing-eyebrow">Finished video</p>
              <span>{latestFinalOutput.name}</span>
            </div>
            <div className="landing-final-player">
              {latestFinalOutput.mediaUrl ? (
                <video
                  controls
                  playsInline
                  poster={latestFinalOutput.previewUrl}
                  preload="metadata"
                  src={latestFinalOutput.mediaUrl}
                />
              ) : (
                <span className="landing-file-placeholder" aria-hidden="true">
                  <IconVideo />
                </span>
              )}
            </div>
          </section>
        )}
      </div>

      {(isFileDragActive || isImportingDrop) && (
        <div className="landing-drop-overlay" aria-live="polite" role="status">
          <span className="landing-drop-overlay-icon" aria-hidden="true">
            <IconUpload />
          </span>
          <strong>{isImportingDrop ? 'Adding media...' : 'Drop files anywhere'}</strong>
          <span>{isImportingDrop ? 'The project is being updated.' : 'Videos, images and audio will be imported.'}</span>
        </div>
      )}
    </main>
  );
}
