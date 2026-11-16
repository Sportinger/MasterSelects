import { useSyncExternalStore } from 'react';
import { getBackgroundActivity, subscribeBackgroundActivity } from '../../../services/activity/backgroundActivity';
import {
  getSourceVerificationStatus,
  subscribeSourceVerificationStatus,
} from '../../../services/project/repository/artifacts/sourceVerificationStatus';
import {
  isLinkedMediaConnectionRunning,
  subscribeLinkedMediaConnection,
} from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { describeToolbarActivity } from './toolbarActivityText';
import './ToolbarSaveStatus.css';

/** Toolbar note for background work after opening a project: loading, thumbnails, media verification. */
export function ToolbarActivity() {
  const verification = useSyncExternalStore(subscribeSourceVerificationStatus, getSourceVerificationStatus, getSourceVerificationStatus);
  const activity = useSyncExternalStore(subscribeBackgroundActivity, getBackgroundActivity, getBackgroundActivity);
  const connecting = useSyncExternalStore(subscribeLinkedMediaConnection, isLinkedMediaConnectionRunning, isLinkedMediaConnectionRunning);
  const lines = describeToolbarActivity({ connecting, decoders: activity.decoders, thumbnails: activity.thumbnails, verification });
  if (lines.length === 0) return null;
  const [main] = lines;
  return (
    <div className="toolbar-source-verification" role="status" aria-live="polite" title={lines.map(line => line.detail).join('\n')}>
      {main!.percent === undefined && <span className="toolbar-activity-spinner" aria-hidden="true" />}
      <span>{main!.label}{lines.length > 1 ? ` +${lines.length - 1}` : ''}</span>
      {main!.percent !== undefined && <span className="toolbar-source-verification-bar" aria-hidden="true"><span style={{ width: `${main!.percent}%` }} /></span>}
    </div>
  );
}
