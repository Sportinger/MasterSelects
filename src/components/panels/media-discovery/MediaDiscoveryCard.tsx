import {
  IconArrowUpRight,
  IconCheck,
  IconDownload,
  IconInfoCircle,
  IconLoader2,
  IconMusic,
} from '@tabler/icons-react';
import type { MediaDiscoveryAsset } from '../../../services/mediaDiscovery';
import './MediaDiscoveryCard.css';

export interface MediaDiscoveryImportState {
  status: 'idle' | 'importing' | 'added' | 'error';
  message?: string;
}

interface MediaDiscoveryCardProps {
  asset: MediaDiscoveryAsset;
  importState: MediaDiscoveryImportState;
  onImport: (asset: MediaDiscoveryAsset) => void;
}

function formatBytes(bytes?: number): string | undefined {
  if (!bytes || bytes <= 0) return undefined;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.ceil(bytes / 1024)} KB`;
}

function formatDuration(durationMs?: number): string | undefined {
  if (!durationMs || durationMs <= 0) return undefined;
  const seconds = Math.round(durationMs / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function MediaPreview({ asset }: { asset: MediaDiscoveryAsset }) {
  if (asset.kind === 'image') {
    return (
      <img
        className="media-discovery-card-image"
        src={asset.previewUrl ?? asset.downloadUrl}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          const image = event.currentTarget;
          if (image.dataset.fallbackApplied === 'true') return;
          image.dataset.fallbackApplied = 'true';
          image.src = asset.downloadUrl;
        }}
      />
    );
  }
  if (asset.kind === 'video') {
    return (
      <video
        className="media-discovery-card-video"
        src={asset.downloadUrl}
        poster={asset.previewUrl}
        controls
        preload="none"
      />
    );
  }
  return (
    <div className="media-discovery-card-audio">
      {asset.previewUrl ? (
        <img src={asset.previewUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      ) : (
        <IconMusic aria-hidden="true" />
      )}
      <audio src={asset.downloadUrl} controls preload="none" />
    </div>
  );
}

export function MediaDiscoveryCard({ asset, importState, onImport }: MediaDiscoveryCardProps) {
  const detail = [formatDuration(asset.durationMs), formatBytes(asset.fileSize)].filter(Boolean).join(' · ');
  const isBusy = importState.status === 'importing';
  const isAdded = importState.status === 'added';

  return (
    <article className="media-discovery-card">
      <div className={`media-discovery-card-preview is-${asset.kind}`}>
        <MediaPreview asset={asset} />
        {detail && <span className="media-discovery-card-detail">{detail}</span>}
      </div>
      <div className="media-discovery-card-body">
        <div className="media-discovery-card-heading">
          <h3 title={asset.title}>{asset.title}</h3>
          {asset.creator && <p title={asset.creator}>{asset.creator}</p>}
        </div>
        <div
          className={`media-discovery-card-license is-${asset.rightsStatus}`}
          title={asset.rightsNote}
        >
          {asset.licenseUrl ? (
            <a href={asset.licenseUrl} target="_blank" rel="noreferrer">{asset.licenseName}</a>
          ) : (
            <span>{asset.licenseName}</span>
          )}
        </div>
        {importState.status === 'error' && (
          <p className="media-discovery-card-error" role="alert">{importState.message}</p>
        )}
        <div className="media-discovery-card-actions">
          <button
            type="button"
            className={isAdded ? 'is-added' : ''}
            disabled={isBusy || isAdded}
            onClick={() => onImport(asset)}
            aria-label={`${isAdded ? 'Added' : 'Add to Media'}: ${asset.title}`}
          >
            {isBusy ? <IconLoader2 className="is-spinning" aria-hidden="true" /> : isAdded ? <IconCheck aria-hidden="true" /> : <IconDownload aria-hidden="true" />}
            {isBusy ? 'Importing' : isAdded ? 'Added' : 'Add to Media'}
          </button>
          <a
            href={asset.sourcePageUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open source page for ${asset.title}`}
            title="Open source page"
          >
            <IconArrowUpRight aria-hidden="true" />
          </a>
          {asset.contextUrl && (
            <a
              href={asset.contextUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open meme context for ${asset.title}`}
              title="Meme context on Know Your Meme"
            >
              <IconInfoCircle aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </article>
  );
}
