import { useFlashBoardRuntime } from './useFlashBoardRuntime';
import '../media/MediaAIGenerativeTray.css';

export function FlashBoardRuntimeHost() {
  const { dismissRefundDialog, refundDialog } = useFlashBoardRuntime({ enableKeyboardDelete: false });

  if (!refundDialog) return null;

  return (
    <div
      className="media-delete-dialog-backdrop media-refund-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissRefundDialog();
      }}
    >
      <div
        className="media-delete-dialog media-refund-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-refund-dialog-title"
      >
        <div className="media-delete-dialog-kicker">Refund</div>
        <h3 id="media-refund-dialog-title">WE are sorry!</h3>
        <p>Here are your credits back.</p>
        <div className="media-delete-dialog-warning media-refund-dialog-credits">
          Refunded {refundDialog.credits} credits
        </div>
        <div className="media-delete-dialog-actions">
          <button
            type="button"
            className="media-delete-dialog-button refund"
            onClick={dismissRefundDialog}
            title={`Job ${refundDialog.jobId}`}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
