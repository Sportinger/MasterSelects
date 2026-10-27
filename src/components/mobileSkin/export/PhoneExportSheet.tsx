// 'export' sheet: summary of what will be rendered, Export / progress / Cancel, then Share and Save
// for the finished file. Unsupported cases are explained in place; Share and Save stay visible
// (greyed, with a reason on tap) until a file exists. Share/Save call their delivery function
// directly inside the click handler so Web Share keeps its user activation.
import { useState } from 'react';
import { PHONE_M1_TEST_IDS, type PhoneActionResult, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { sharePhoneExport, savePhoneExport } from './phoneExportDelivery';
import { usePhoneExport } from './usePhoneExport';
import './PhoneExportSheet.css';

export function formatPhoneFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const PhoneExportSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((store) => store.closeSheet);
  const showToast = usePhoneUiStore((store) => store.showToast);
  const projectName = useMediaStore((store) => store.currentProjectName);
  const { plan, state, cancelling, start, cancel, reset } = usePhoneExport();
  const [confirmClose, setConfirmClose] = useState(false);

  const busy = state.status === 'preparing' || state.status === 'exporting';
  const done = state.status === 'done' ? state : null;
  const blockedReason = plan && !plan.supported ? plan.reason : null;
  const checking = plan === null;

  const report = (result: PhoneActionResult) => {
    showToast(result.message ?? (result.ok ? 'Done.' : 'Something went wrong.'), result.ok ? 'info' : 'error');
  };

  const requestClose = () => {
    if (busy) setConfirmClose(true);
    else closeSheet();
  };

  const cancelAndClose = async () => {
    await cancel();
    setConfirmClose(false);
    closeSheet();
  };

  const onExport = () => {
    if (checking) {
      showToast('Still checking what this browser can encode. Try again in a moment.', 'info');
      return;
    }
    if (blockedReason) {
      showToast(blockedReason, 'error');
      return;
    }
    void start();
  };

  const onShare = () => {
    if (!done) {
      showToast('Export the video first, then share it.', 'info');
      return;
    }
    // No await before this call: the click's user activation must still be live.
    void sharePhoneExport(done.blob, done.filename, projectName || 'MasterSelects').then(report);
  };

  const onSave = () => {
    if (!done) {
      showToast('Export the video first, then save it.', 'info');
      return;
    }
    report(savePhoneExport(done.blob, done.filename));
  };

  const progress = state.status === 'exporting' ? state.progress : 0;
  const percent = Math.round(progress * 100);
  const exportLabel = state.status === 'failed' || state.status === 'cancelled' ? 'Export again' : 'Export';

  return (
    <PhoneSheet title="Export" height="half" onCancel={requestClose} cancelLabel="Close">
      <div className="phone-export">
        <p className="phone-export__summary" data-testid={PHONE_M1_TEST_IDS.exportSummary}>
          {plan?.supported
            ? plan.summary
            : checking
              ? 'Checking what this browser can encode…'
              : blockedReason !== null && plan?.width
                ? `${plan.width} × ${plan.height} · not available`
                : 'Not available'}
        </p>

        {plan?.supported && plan.notice ? <p className="phone-export__notice">{plan.notice}</p> : null}
        {blockedReason ? <p className="phone-export__problem" role="alert">{blockedReason}</p> : null}
        {state.status === 'failed' ? <p className="phone-export__problem" role="alert">{state.message}</p> : null}
        {state.status === 'cancelled' ? <p className="phone-export__notice">Export cancelled. Nothing was saved.</p> : null}

        {busy ? (
          <div className="phone-export__running">
            <div
              className="phone-export__bar"
              role="progressbar"
              aria-label="Export progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              data-testid={PHONE_M1_TEST_IDS.exportProgress}
            >
              <div className="phone-export__bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <div className="phone-export__running-row">
              <span className="phone-export__percent">
                {cancelling ? 'Cancelling…' : state.status === 'preparing' ? 'Preparing…' : `${percent}%`}
              </span>
              <button
                type="button"
                className="phone-export__button"
                aria-disabled={cancelling}
                onClick={() => { if (!cancelling) void cancel(); }}
                data-testid={PHONE_M1_TEST_IDS.exportCancel}
              >
                Cancel
              </button>
            </div>
            <p className="phone-export__hint">Keep this screen open until the export finishes.</p>
          </div>
        ) : (
          <button
            type="button"
            className="phone-export__button phone-export__button--primary"
            aria-disabled={checking || blockedReason !== null}
            onClick={onExport}
            data-testid={PHONE_M1_TEST_IDS.exportStart}
          >
            {exportLabel}
          </button>
        )}

        {done ? (
          <p className="phone-export__result" role="status">
            Ready · {formatPhoneFileSize(done.sizeBytes)} · {done.filename}
          </p>
        ) : null}

        <div className="phone-export__delivery">
          <button
            type="button"
            className="phone-export__button phone-export__button--primary"
            aria-disabled={!done}
            onClick={onShare}
            data-testid={PHONE_M1_TEST_IDS.exportShare}
          >
            Share
          </button>
          <button
            type="button"
            className="phone-export__button"
            aria-disabled={!done}
            onClick={onSave}
            data-testid={PHONE_M1_TEST_IDS.exportSave}
          >
            Save
          </button>
        </div>
        {done ? (
          <button type="button" className="phone-export__link" onClick={reset}>
            Discard and export again
          </button>
        ) : null}

        {confirmClose ? (
          <div className="phone-export__confirm" role="alertdialog" aria-label="Cancel the running export?">
            <p>An export is running. Cancel it and close?</p>
            <div className="phone-export__delivery">
              <button type="button" className="phone-export__button" onClick={() => setConfirmClose(false)}>
                Keep exporting
              </button>
              <button
                type="button"
                className="phone-export__button phone-export__button--danger"
                onClick={() => { void cancelAndClose(); }}
              >
                Cancel export
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </PhoneSheet>
  );
};
