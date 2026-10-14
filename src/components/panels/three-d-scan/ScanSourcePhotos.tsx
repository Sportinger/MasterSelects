import { IconAlertTriangle, IconCheck, IconTrash, IconX } from '@tabler/icons-react';
import type { ScanSourceRow } from '../../../services/photogrammetry/ScanSourceManager';

interface Props {
  sources: ScanSourceRow[];
  busy: boolean;
  goodPhotoCount: number;
  canSolve: boolean;
  showSolve: boolean;
  solving: boolean;
  onRemove: (key?: string) => Promise<void>;
  onSolve: () => Promise<void>;
}

/** The list displays source dimensions while using bounded preview images. */
export function ScanSourcePhotos({ sources, busy, goodPhotoCount, canSolve, showSolve, solving, onRemove, onSolve }: Props) {
  if (!sources.length) return null;
  return <section className="scan-section">
    <div className="scan-section-heading">
      <div><strong>Source photos</strong><span>{goodPhotoCount} ready · {sources.length - goodPhotoCount} need attention</span></div>
      <button className="scan-icon-button" disabled={busy} onClick={() => void onRemove()} title="Clear photos"><IconTrash size={15} /></button>
    </div>
    <div className="scan-photo-list">
      {sources.map(source => <div className="scan-photo-row" key={source.key}>
        {source.previewUrl ? <img src={source.previewUrl} alt="" loading="lazy" decoding="async" /> : <IconAlertTriangle size={20} />}
        <div className="scan-photo-name"><strong>{source.file.name}</strong><span>{source.width} × {source.height} · {source.megapixels.toFixed(1)} MP</span></div>
        <span className={`scan-quality ${source.quality}`} title={source.note}>
          {source.quality === 'good' ? <IconCheck size={14} /> : <IconAlertTriangle size={14} />}
        </span>
        <button className="scan-icon-button" disabled={busy} onClick={() => void onRemove(source.key)} title="Remove photo"><IconX size={14} /></button>
      </div>)}
    </div>
    <p className="scan-inline-note">Original source photos are retained. Camera matching uses smaller working images. Nothing is uploaded.</p>
    {showSolve && <button className="btn btn-export scan-train-button" disabled={!canSolve || busy} onClick={() => void onSolve()}>
      {solving ? 'Solving camera poses…' : 'Solve camera poses locally'}
    </button>}
  </section>;
}
