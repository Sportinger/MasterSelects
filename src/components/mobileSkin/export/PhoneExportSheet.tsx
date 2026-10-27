// 'export' sheet: summary of what will be rendered, Export / progress / Cancel, then Share and Save
// for the finished file. Unsupported cases are explained in place; Share and Save stay visible
// (greyed, with a reason on tap) until a file exists. Share/Save call their delivery function
// directly inside the click handler so Web Share keeps its user activation. 'Advanced' opens every
// format and setting the editor exports; 'Batch queue' converts project media files.
import { useState } from 'react';
import { PHONE_M1_TEST_IDS, type PhoneActionResult, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { sharePhoneExport, savePhoneExport } from './phoneExportDelivery';
import { PhoneExportAdvanced } from './PhoneExportAdvanced';
import { PhoneExportBatch } from './PhoneExportBatch';
import { releasePointerFocus } from './PhoneExportControls';
import { PHONE_EXPORT_TEST_IDS } from './phoneExportTestIds';
import { usePhoneAdvancedExport } from './usePhoneAdvancedExport';
import { usePhoneExport } from './usePhoneExport';
import './PhoneExportSheet.css';
import './PhoneExportAdvanced.css';

export function formatPhoneFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const PhoneExportSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((store) => store.closeSheet);
  const showToast = usePhoneUiStore((store) => store.showToast);
  const projectName = useMediaStore((store) => store.currentProjectName);
  const { plan, state, cancelling, start, cancel, canFinishEarly, finishing, finishEarly, reset } = usePhoneExport();
  const [confirmClose, setConfirmClose] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [batchOpen, setBatchOpen] = useState(false);
  const advanced = usePhoneAdvancedExport(advancedOpen);

  const busy = state.status === 'preparing' || state.status === 'exporting';
  const done = state.status === 'done' ? state : null;
  const advancedPlan = advancedOpen ? advanced.plan : null;
  const blockedReason = advancedPlan
    ? (advancedPlan.supported ? null : advancedPlan.reason)
    : plan && !plan.supported ? plan.reason : null;
  const checking = !advancedPlan && plan === null;
  const summary = advancedPlan
    ? (advancedPlan.supported ? advancedPlan.spec.summary
      : advancedPlan.size ? `${advancedPlan.size.width} × ${advancedPlan.size.height} · not available` : 'Not available')
    : plan?.supported
      ? plan.summary
      : checking
        ? 'Checking what this browser can encode…'
        : blockedReason !== null && plan?.width
          ? `${plan.width} × ${plan.height} · not available`
          : 'Not available';
  const notice = advancedPlan ? (advancedPlan.supported ? advancedPlan.spec.notice : null) : plan?.supported ? plan.notice : null;

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
    void start(advancedPlan?.supported ? advancedPlan.spec : null);
  };

  const onShare = () => {
    if (!done) {
      showToast('Export the file first, then share it.', 'info');
      return;
    }
    // No await before this call: the click's user activation must still be live.
    void sharePhoneExport(done.blob, done.filename, projectName || 'MasterSelects').then(report);
  };

  const onSave = () => {
    if (!done) {
      showToast('Export the file first, then save it.', 'info');
      return;
    }
    report(savePhoneExport(done.blob, done.filename));
  };

  const progress = state.status === 'exporting' ? state.progress : 0;
  const percent = Math.round(progress * 100);
  const exportLabel = state.status === 'failed' || state.status === 'cancelled' ? 'Export again' : 'Export';

  return (
    <PhoneSheet title="Export" height={advancedOpen || batchOpen ? 'tall' : 'half'} onCancel={requestClose} cancelLabel="Close">
      <div className="phone-export">
        <p className="phone-export__summary" data-testid={PHONE_M1_TEST_IDS.exportSummary}>{summary}</p>

        {notice ? <p className="phone-export__notice" data-testid={PHONE_EXPORT_TEST_IDS.notice}>{notice}</p> : null}
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
                {cancelling ? 'Cancelling…' : finishing ? 'Finishing the file…' : state.status === 'preparing' ? 'Preparing…' : `${percent}%`}
              </span>
              <button
                type="button"
                onPointerUp={releasePointerFocus}
                className="phone-export__button"
                aria-disabled={!canFinishEarly}
                data-testid={PHONE_EXPORT_TEST_IDS.finishEarly}
                onClick={() => {
                  if (canFinishEarly) { finishEarly(); return; }
                  showToast(finishing ? 'The file is being finished with the rendered part.'
                    : 'Keep rendered part works for video exports once the first frame is rendered.', 'info');
                }}
              >
                Keep rendered part
              </button>
              <button
                type="button"
                onPointerUp={releasePointerFocus}
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
            onPointerUp={releasePointerFocus}
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
            {done.shortened ? 'Shortened · ' : 'Ready · '}{formatPhoneFileSize(done.sizeBytes)} · {done.filename}
          </p>
        ) : null}

        <div className="phone-export__delivery">
          <button
            type="button"
            onPointerUp={releasePointerFocus}
            className="phone-export__button"
            aria-disabled={!done}
            onClick={onShare}
            data-testid={PHONE_M1_TEST_IDS.exportShare}
          >
            Share
          </button>
          <button
            type="button"
            onPointerUp={releasePointerFocus}
            className="phone-export__button"
            aria-disabled={!done}
            onClick={onSave}
            data-testid={PHONE_M1_TEST_IDS.exportSave}
          >
            Save
          </button>
        </div>
        {!done && !busy ? <p className="phone-export__hint">Share and Save work once the export is ready.</p> : null}
        {done ? (
          <button type="button" className="phone-export__link" onClick={reset}>
            Discard and export again
          </button>
        ) : null}

        <button
          type="button"
          className="phone-export-section-toggle"
          aria-expanded={advancedOpen}
          aria-disabled={busy}
          data-testid={PHONE_EXPORT_TEST_IDS.advancedToggle}
          onPointerUp={releasePointerFocus}
          onClick={() => {
            if (busy) showToast('Wait until the export has finished.', 'info');
            else setAdvancedOpen((open) => !open);
          }}
        >
          Advanced
          <span aria-hidden="true">{advancedOpen ? '▴' : '▾'}</span>
        </button>
        {advancedOpen ? <PhoneExportAdvanced advanced={advanced} /> : null}

        <button
          type="button"
          className="phone-export-section-toggle"
          aria-expanded={batchOpen}
          data-testid={PHONE_EXPORT_TEST_IDS.batchToggle}
          onPointerUp={releasePointerFocus}
          onClick={() => setBatchOpen((open) => !open)}
        >
          Batch queue
          <span aria-hidden="true">{batchOpen ? '▴' : '▾'}</span>
        </button>
        {batchOpen ? <PhoneExportBatch /> : null}

        {confirmClose ? (
          <div className="phone-export__confirm" role="alertdialog" aria-label="Cancel the running export?">
            <p>An export is running. Cancel it and close?</p>
            <div className="phone-export__delivery">
              <button type="button" className="phone-export__button" onClick={() => setConfirmClose(false)}>
                Keep exporting
              </button>
              <button
                type="button"
                onPointerUp={releasePointerFocus}
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
