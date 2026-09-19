import {
  IconCheck,
  IconFileText,
  IconFolderOpen,
  IconPhoto,
  IconVideo,
  IconX,
} from '@tabler/icons-react';

export type LandingProjectMediaType = 'audio' | 'document' | 'image' | 'text' | 'video';

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

interface LandingProjectMediaStripProps {
  disabled?: boolean;
  items: LandingProjectMediaItem[];
  onRemoveItem?: (item: LandingProjectMediaItem) => void;
  onShowProjects?: () => void;
  onToggleSourceItem?: (item: LandingProjectMediaItem) => void;
  removingItemId?: string | null;
  selectedSourceItemIds?: ReadonlySet<string>;
  sourceSelectionMode?: boolean;
}

function formatDuration(duration: number | undefined): string | null {
  if (!duration || !Number.isFinite(duration)) return null;
  const totalSeconds = Math.max(0, Math.round(duration));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function LandingMediaPreview({
  disabled = false,
  item,
  onRemove,
  onToggleSource,
  removing = false,
  sourceSelected = false,
  sourceSelectionMode = false,
}: {
  disabled?: boolean;
  item: LandingProjectMediaItem;
  onRemove?: () => void;
  onToggleSource?: () => void;
  removing?: boolean;
  sourceSelected?: boolean;
  sourceSelectionMode?: boolean;
}) {
  const duration = formatDuration(item.duration);
  const sourceSelectable = sourceSelectionMode
    && (item.type === 'video' || item.type === 'image' || item.type === 'audio')
    && !item.isFinalOutput;

  return (
    <article
      aria-label={item.name}
      className={[
        'landing-media-file',
        `is-${item.type}`,
        item.isFinalOutput ? 'is-final-output' : '',
        sourceSelectionMode && sourceSelected ? 'is-source-selected' : '',
        sourceSelectionMode && !sourceSelected ? 'is-source-excluded' : '',
      ].filter(Boolean).join(' ')}
      title={item.name}
    >
      <div className="landing-media-file-preview">
        {item.type === 'video' && item.mediaUrl ? (
          <video
            aria-hidden="true"
            muted
            playsInline
            poster={item.previewUrl}
            preload="metadata"
            src={item.mediaUrl}
          />
        ) : item.previewUrl ? (
          <img src={item.previewUrl} alt="" draggable={false} />
        ) : item.type === 'audio' ? (
          <span className="landing-audio-waveform" aria-hidden="true">
            {Array.from({ length: 16 }, (_, index) => (
              <i key={index} />
            ))}
          </span>
        ) : item.type === 'document' ? (
          <span className="landing-document-preview">
            <IconFileText aria-hidden="true" />
            <span>{item.textPreview?.trim() || 'Document source'}</span>
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
        {sourceSelectable && onToggleSource && (
          <button
            aria-label={sourceSelected ? `Do not use ${item.name}` : `Use ${item.name}`}
            aria-pressed={sourceSelected}
            className="landing-media-source-toggle"
            disabled={disabled}
            title={sourceSelected ? `Exclude ${item.name}` : `Use ${item.name}`}
            type="button"
            onClick={onToggleSource}
          >
            <span aria-hidden="true"><IconCheck /></span>
          </button>
        )}
        {onRemove && !sourceSelectionMode && (
          <button
            aria-label={`Remove ${item.name}`}
            className="landing-media-file-remove"
            data-removing={removing ? 'true' : 'false'}
            disabled={disabled || removing}
            title={`Remove ${item.name} from project`}
            type="button"
            onClick={onRemove}
          >
            <IconX aria-hidden="true" />
          </button>
        )}
      </div>
      <strong>{item.isFinalOutput ? 'Finished video' : item.name}</strong>
    </article>
  );
}

export function LandingProjectMediaStrip({
  disabled = false,
  items,
  onRemoveItem,
  onShowProjects,
  onToggleSourceItem,
  removingItemId = null,
  selectedSourceItemIds = new Set<string>(),
  sourceSelectionMode = false,
}: LandingProjectMediaStripProps) {
  if (items.length === 0 && !onShowProjects) return null;

  return (
    <section
      className={`landing-project-media ${sourceSelectionMode ? 'is-source-selection' : ''}`}
      aria-label="Project files"
    >
      <div className="landing-project-media-heading">
        <div className="landing-project-media-title">
          <p className="landing-eyebrow">Project files</p>
          {onShowProjects && (
            <button
              aria-label="Show project choices"
              aria-pressed="false"
              className="landing-project-switch"
              disabled={disabled}
              title="Projects"
              type="button"
              onClick={onShowProjects}
            >
              <IconFolderOpen aria-hidden="true" />
            </button>
          )}
        </div>
        {sourceSelectionMode && (
          <p>Select the project media AI may use</p>
        )}
      </div>

      <div className="landing-project-file-strip">
        {items.map((item) => (
          <LandingMediaPreview
            disabled={disabled || removingItemId !== null}
            item={item}
            key={item.id}
            removing={removingItemId === item.id}
            onRemove={!sourceSelectionMode && onRemoveItem ? () => onRemoveItem(item) : undefined}
            onToggleSource={onToggleSourceItem ? () => onToggleSourceItem(item) : undefined}
            sourceSelected={selectedSourceItemIds.has(item.id)}
            sourceSelectionMode={sourceSelectionMode}
          />
        ))}
      </div>
    </section>
  );
}
