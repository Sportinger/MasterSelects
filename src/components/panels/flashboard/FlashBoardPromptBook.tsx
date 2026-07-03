import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardPromptHistoryEntry,
} from '../../../stores/flashboardStore';
import type { MediaFile } from '../../../stores/mediaStore/types';

interface FlashBoardPromptBookProps {
  entries: FlashBoardPromptHistoryEntry[];
  generationRecords: FlashBoardActiveGenerationRecord[];
  mediaFiles: MediaFile[];
  copiedEntryId: string | null;
  onClose: () => void;
  onCopy: (prompt: string, pageId: string) => void;
}

type PromptBookPageStyle = CSSProperties & {
  '--fb-prompt-book-stack'?: number;
};

interface PromptBookMedia {
  id: string;
  name: string;
  thumbnailUrl?: string;
  type: 'image' | 'video';
  url: string;
}

interface PromptBookPage {
  id: string;
  kind: FlashBoardPromptHistoryEntry['kind'];
  createdAt: number;
  userPrompt: string;
  magicPrompt?: string;
  media: PromptBookMedia[];
}

function trimPrompt(prompt: string | null | undefined): string {
  return prompt?.trim() ?? '';
}

function formatPromptBookTime(createdAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(createdAt));
}

function buildPromptBookPages(
  entries: FlashBoardPromptHistoryEntry[],
  generationRecords: FlashBoardActiveGenerationRecord[],
  mediaFiles: MediaFile[],
): PromptBookPage[] {
  const mediaFilesById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile]));
  const generationPagesByPrompt = new Map<string, PromptBookPage>();

  for (const record of generationRecords) {
    const finalPrompt = trimPrompt(record.request?.prompt);
    const originalPrompt = trimPrompt(record.request?.originalPrompt);
    const userPrompt = originalPrompt || finalPrompt;
    if (!userPrompt) continue;

    const pageId = `generation:${userPrompt}`;
    const magicPrompt = originalPrompt && finalPrompt && originalPrompt !== finalPrompt
      ? finalPrompt
      : undefined;
    let page = generationPagesByPrompt.get(pageId);
    if (!page) {
      page = {
        id: pageId,
        kind: 'generation',
        createdAt: record.createdAt,
        userPrompt,
        magicPrompt,
        media: [],
      };
      generationPagesByPrompt.set(pageId, page);
    } else {
      page.createdAt = Math.max(page.createdAt, record.createdAt);
      page.magicPrompt ??= magicPrompt;
    }

    const mediaFileId = record.result?.mediaFileId;
    const mediaFile = mediaFileId ? mediaFilesById.get(mediaFileId) : undefined;
    if (
      mediaFile
      && (mediaFile.type === 'image' || mediaFile.type === 'video')
      && !page.media.some((item) => item.id === mediaFile.id)
    ) {
      page.media.push({
        id: mediaFile.id,
        name: mediaFile.name,
        thumbnailUrl: mediaFile.thumbnailUrl,
        type: mediaFile.type,
        url: mediaFile.url,
      });
    }
  }

  const generationPromptKeys = new Set<string>();
  for (const page of generationPagesByPrompt.values()) {
    generationPromptKeys.add(page.userPrompt);
    if (page.magicPrompt) generationPromptKeys.add(page.magicPrompt);
  }

  const pages = [...generationPagesByPrompt.values()];
  for (const entry of entries) {
    const prompt = trimPrompt(entry.prompt);
    if (!prompt) continue;
    if (entry.kind === 'generation' && generationPromptKeys.has(prompt)) continue;
    pages.push({
      id: entry.id,
      kind: entry.kind,
      createdAt: entry.createdAt,
      userPrompt: prompt,
      media: [],
    });
  }

  return pages.toSorted((left, right) => right.createdAt - left.createdAt);
}

function PromptBookVideo({
  active,
  media,
}: {
  active: boolean;
  media: PromptBookMedia;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = true;
    video.volume = 0;
    if (active) {
      void video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  }, [active, media.url]);

  return (
    <video
      ref={videoRef}
      src={media.url}
      poster={media.thumbnailUrl}
      muted
      loop
      playsInline
      preload={active ? 'auto' : 'metadata'}
    />
  );
}

export function FlashBoardPromptBook({
  entries,
  generationRecords,
  mediaFiles,
  copiedEntryId,
  onClose,
  onCopy,
}: FlashBoardPromptBookProps) {
  const pages = useMemo(
    () => buildPromptBookPages(entries, generationRecords, mediaFiles),
    [entries, generationRecords, mediaFiles],
  );
  const [pageIndex, setPageIndex] = useState(0);
  const lastPageIndex = Math.max(0, pages.length - 1);
  const canGoBack = pageIndex > 0;
  const canGoForward = pageIndex < lastPageIndex;
  const visiblePages = pages
    .map((page, index) => ({ page, index }))
    .filter(({ index }) => index >= pageIndex - 2 && index <= pageIndex + 3);

  useEffect(() => {
    setPageIndex((current) => Math.min(current, lastPageIndex));
  }, [lastPageIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      } else if (event.key === 'ArrowLeft') {
        setPageIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'ArrowRight') {
        setPageIndex((current) => Math.min(lastPageIndex, current + 1));
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lastPageIndex, onClose]);

  const promptBook = (
    <div className="fb-prompt-book-backdrop" role="presentation" onMouseDown={onClose}>
      <div className="fb-prompt-book" role="dialog" aria-modal="true" aria-label="Prompt book" onMouseDown={(event) => event.stopPropagation()}>
        <button type="button" className="fb-prompt-book-close" onClick={onClose} aria-label="Close prompt book">
          &times;
        </button>

        <div className="fb-prompt-book-stage">
          <button
            type="button"
            className="fb-prompt-book-nav previous"
            onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            disabled={!canGoBack}
            aria-label="Previous prompt"
          >
            <span aria-hidden="true">&lt;</span>
          </button>

          <div className="fb-prompt-book-volume" aria-live="polite">
            <div className="fb-prompt-book-left-cover" aria-hidden="true">
              <div className="fb-prompt-book-left-title">Prompt Book</div>
            </div>
            <div className="fb-prompt-book-spine" aria-hidden="true" />

            {pages.length === 0 ? (
              <article className="fb-prompt-book-page is-active is-empty">
                <div className="fb-prompt-book-page-face front">
                  <div className="fb-prompt-book-empty">No prompts yet.</div>
                </div>
              </article>
            ) : visiblePages.map(({ page, index }) => (
              <article
                className={`fb-prompt-book-page ${page.kind} ${pageIndex === index ? 'is-active' : ''} ${pageIndex > index ? 'is-turned' : ''}`}
                key={page.id}
                style={{
                  '--fb-prompt-book-stack': Math.min(8, Math.max(0, index - pageIndex)),
                  zIndex: pageIndex > index ? pages.length + index : pages.length - index,
                } as PromptBookPageStyle}
                aria-hidden={pageIndex !== index}
              >
                <div className="fb-prompt-book-page-face front">
                  <div className="fb-prompt-book-entry-meta">
                    <span>{page.kind === 'chat' ? 'Chat' : 'Gen'}</span>
                    <time dateTime={new Date(page.createdAt).toISOString()}>{formatPromptBookTime(page.createdAt)}</time>
                  </div>
                  <div className="fb-prompt-book-page-scroll">
                    <section className="fb-prompt-book-prompt-section">
                      <div className="fb-prompt-book-section-label">User prompt</div>
                      <p>{page.userPrompt}</p>
                    </section>
                    {page.magicPrompt && (
                      <section className="fb-prompt-book-prompt-section is-magic">
                        <div className="fb-prompt-book-section-label">Magic wand prompt</div>
                        <p>{page.magicPrompt}</p>
                      </section>
                    )}
                    {page.media.length > 0 && (
                      <div className="fb-prompt-book-media-grid">
                        {page.media.map((media) => (
                          <div className="fb-prompt-book-media-tile" key={media.id} title={media.name}>
                            {media.type === 'video' ? (
                              <PromptBookVideo active={pageIndex === index} media={media} />
                            ) : (
                              <img src={media.thumbnailUrl ?? media.url} alt="" draggable={false} />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onCopy(page.magicPrompt ?? page.userPrompt, page.id)}
                    tabIndex={pageIndex === index ? 0 : -1}
                  >
                    {copiedEntryId === page.id ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="fb-prompt-book-page-face back" aria-hidden="true" />
              </article>
            ))}
          </div>

          <button
            type="button"
            className="fb-prompt-book-nav next"
            onClick={() => setPageIndex((current) => Math.min(lastPageIndex, current + 1))}
            disabled={!canGoForward}
            aria-label="Next prompt"
          >
            <span aria-hidden="true">&gt;</span>
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return promptBook;
  }

  return createPortal(promptBook, document.body);
}
