export function ExportDialogStyles() {
  return (
    <style>{`
      .export-dialog-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .export-dialog {
        background: var(--bg-secondary);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 24px;
        min-width: 400px;
        max-width: 500px;
      }

      .export-dialog h2 {
        margin: 0 0 20px 0;
        font-size: 18px;
        color: var(--text-primary);
      }

      .export-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
      }

      .export-row {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .export-row label {
        width: 100px;
        color: var(--text-secondary);
        font-size: 13px;
      }

      .export-row select,
      .export-row input[type="text"],
      .export-row input[type="number"] {
        flex: 1;
        padding: 8px 12px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        color: var(--text-primary);
        font-size: 14px;
      }

      .export-row select:focus,
      .export-row input:focus {
        outline: none;
        border-color: var(--accent);
      }

      .export-input-group {
        flex: 1;
        display: flex;
        align-items: center;
      }

      .export-input-group input {
        border-radius: 4px 0 0 4px;
      }

      .export-extension {
        padding: 8px 12px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-left: none;
        border-radius: 0 4px 4px 0;
        color: var(--text-secondary);
      }

      .export-time-range {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .export-time-range input {
        width: 80px;
        flex: none;
      }

      .export-time-range span {
        color: var(--text-secondary);
      }

      .export-bitrate-group {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .export-bitrate-group select {
        flex: 1;
      }

      .export-custom-bitrate {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .export-custom-bitrate input[type="range"] {
        flex: 1;
        height: 4px;
        background: var(--bg-tertiary);
        border-radius: 2px;
        cursor: pointer;
        accent-color: var(--accent);
      }

      .bitrate-value {
        min-width: 70px;
        text-align: right;
        color: var(--text-primary);
        font-size: 13px;
        font-family: monospace;
      }

      .bitrate-toggle {
        padding: 6px 10px;
        background: var(--bg-tertiary);
        border: 1px solid var(--border-color);
        border-radius: 4px;
        color: var(--text-secondary);
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        white-space: nowrap;
      }

      .bitrate-toggle:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
        font-size: 13px;
      }

      .export-summary {
        margin-top: 8px;
        padding: 12px;
        background: var(--bg-tertiary);
        border-radius: 4px;
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 13px;
        color: var(--text-secondary);
      }

      .export-section-header {
        margin-top: 16px;
        margin-bottom: 4px;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .export-checkbox-group {
        flex: 1;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .export-checkbox-group input[type="checkbox"] {
        width: 16px;
        height: 16px;
        accent-color: var(--accent);
        cursor: pointer;
      }

      .export-checkbox-group .checkbox-label {
        width: auto;
        color: var(--text-primary);
        font-size: 13px;
        cursor: pointer;
      }

      .export-phase {
        margin-bottom: 12px;
        font-size: 14px;
        color: var(--text-primary);
        font-weight: 500;
      }

      .export-error {
        margin-top: 16px;
        padding: 12px;
        background: rgba(255, 68, 68, 0.1);
        border: 1px solid var(--danger);
        border-radius: 4px;
        color: var(--danger);
        font-size: 13px;
      }

      .export-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }

      .export-actions button {
        padding: 10px 20px;
        border-radius: 4px;
        border: none;
        font-size: 14px;
        cursor: pointer;
        transition: background 0.2s;
      }

      .export-cancel {
        background: var(--bg-tertiary);
        color: var(--text-primary);
      }

      .export-cancel:hover {
        background: var(--bg-hover);
      }

      .export-start {
        background: var(--accent);
        color: var(--bg-primary);
        font-weight: 600;
      }

      .export-start:hover {
        background: var(--accent-hover);
      }

      .export-progress {
        margin: 20px 0;
      }

      .export-progress-bar {
        height: 8px;
        background: var(--bg-tertiary);
        border-radius: 4px;
        overflow: hidden;
      }

      .export-progress-fill {
        height: 100%;
        background: var(--accent);
        transition: width 0.1s ease-out;
      }

      .export-progress-info {
        display: flex;
        justify-content: space-between;
        margin-top: 8px;
        font-size: 13px;
        color: var(--text-secondary);
      }

      .export-eta {
        text-align: center;
        margin-top: 8px;
        font-size: 14px;
        color: var(--text-primary);
      }

      .export-warning {
        margin-top: 12px;
        padding: 10px 12px;
        background: rgba(255, 170, 0, 0.1);
        border: 1px solid #ffaa00;
        border-radius: 4px;
        color: #ffaa00;
        font-size: 12px;
      }
    `}</style>
  );
}
