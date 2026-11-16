import { useSyncExternalStore } from 'react';
import {
  getSourceVerificationStatus,
  sourceVerificationPercent,
  subscribeSourceVerificationStatus,
} from '../../../services/project/repository/artifacts/sourceVerificationStatus';
import './ToolbarSaveStatus.css';

const gigabytes = (bytes: number) => `${(bytes / 1e9).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`;

/** Shows while original media are hashed in the background, with the share already read. */
export function ToolbarSourceVerification() {
  const status = useSyncExternalStore(subscribeSourceVerificationStatus, getSourceVerificationStatus, getSourceVerificationStatus);
  if (!status) return null;
  const percent = sourceVerificationPercent(status);
  const files = `${status.files.toLocaleString()} original ${status.files === 1 ? 'file' : 'files'}`;
  return (
    <div className="toolbar-source-verification" role="status" aria-live="polite"
      title={`Checking ${files} byte for byte (${gigabytes(status.bytesDone)} of ${gigabytes(status.bytesTotal)}), `
        + 'so the project can later prove that its originals did not change. Runs in the background.'}>
      <span>Verifying media {percent} %</span>
      <span className="toolbar-source-verification-bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></span>
    </div>
  );
}
