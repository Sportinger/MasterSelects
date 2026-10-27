// Callable dialog and feedback hosts that live in the desktop Toolbar/App. Services open these
// dialogs from anywhere (relink media, legacy import target, source fit), so the phone skin must
// keep them mounted or those flows would wait forever on a dialog nobody renders.

import { EditRejectedToast } from '../../common/EditRejectedToast';
import { HistoryActionToast } from '../../common/HistoryActionToast';
import { LiveInputReconnectPrompt } from '../../common/LiveInputReconnectPrompt';
import { PremiereSequenceImportDialog } from '../../common/PremiereSequenceImportDialog';
import { PhoneBackgroundLoadStatus } from './PhoneBackgroundLoadStatus';
import { ProjectMediaCopyToast } from '../../common/ProjectMediaCopyToast';
import { SourceFitDialogHost } from '../../common/SourceFitDialog';
import { LegacyImportTargetHost } from '../../common/toolbar/LegacyImportDialog';
import { MediaReconnectHost } from '../../common/toolbar/MediaReconnectOverlay';
import type { HistoryFeedbackNotice } from '../../../hooks/useGlobalHistory';
// Styles of the shared project-load progress and live-input reconnect prompt (class-scoped only).
import '../../../styles/app-shell.css';

interface PhoneRuntimeOverlaysProps {
  /** While booting, PhoneBootStatus shows the restore progress full-screen instead. */
  bootPending: boolean;
  historyNotice: HistoryFeedbackNotice | null;
  onHistoryNoticeDone: (id?: number) => void;
}

export function PhoneRuntimeOverlays({
  bootPending,
  historyNotice,
  onHistoryNoticeDone,
}: PhoneRuntimeOverlaysProps) {
  return (
    <>
      <LegacyImportTargetHost />
      <MediaReconnectHost />
      <SourceFitDialogHost />
      {/* The desktop load toast is translucent; blocking loads show PhoneProjectLoadingView instead. */}
      {!bootPending && <PhoneBackgroundLoadStatus />}
      <LiveInputReconnectPrompt />
      <PremiereSequenceImportDialog />
      <HistoryActionToast notice={historyNotice} onDone={onHistoryNoticeDone} />
      <EditRejectedToast />
      <ProjectMediaCopyToast />
    </>
  );
}
