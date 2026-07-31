import { useState } from 'react';

import {
  confirmStoryboardTemplatePreview,
  type StoryboardTemplateApplicationPreview,
} from '../../../services/storyboard/templates';
import './StoryboardTemplateDiffPreview.css';

export interface StoryboardTemplateDiffPreviewProps {
  readonly preview: StoryboardTemplateApplicationPreview;
  readonly templateName?: string;
  readonly onApply: (confirmedPreview: StoryboardTemplateApplicationPreview) => void;
  readonly onCancel?: () => void;
}

function exactValue(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function StoryboardTemplateDiffPreview({
  preview,
  templateName = preview.templateId,
  onApply,
  onCancel,
}: StoryboardTemplateDiffPreviewProps) {
  const [acknowledgedFingerprint, setAcknowledgedFingerprint] = useState<string | null>(null);
  const acknowledged = acknowledgedFingerprint === preview.diffFingerprint;
  const destructiveCount = preview.differences.filter(change => change.destructive).length;
  const canApply = !preview.requiresConfirmation || acknowledged;

  return (
    <section
      className="storyboard-template-diff"
      aria-label={`Template change preview for ${templateName}`}
    >
      <div className="storyboard-template-diff-heading">
        <div>
          <h3>Review template changes</h3>
          <p>
            {templateName} · {preview.mode} · version {preview.templateVersion}
          </p>
        </div>
        <span className={preview.requiresConfirmation ? 'is-destructive' : 'is-safe'}>
          {preview.requiresConfirmation
            ? `${destructiveCount} destructive ${destructiveCount === 1 ? 'change' : 'changes'}`
            : 'No destructive changes'}
        </span>
      </div>

      <p role="status">
        {preview.requiresConfirmation
          ? 'Existing storyboard content will change or be removed. Review every difference before confirming.'
          : 'This preview only adds or maps storyboard structure.'}
      </p>

      {preview.differences.length === 0 ? (
        <p>No changes are required.</p>
      ) : (
        <ol className="storyboard-template-diff-list" aria-label="Template differences">
          {preview.differences.map(change => (
            <li key={change.id} className={change.destructive ? 'is-destructive' : 'is-safe'}>
              <div>
                <strong>{change.operation} {change.entity}</strong>
                <span>{change.destructive ? 'Destructive' : 'Non-destructive'}</span>
              </div>
              <p>{change.summary}</p>
              {(change.before !== undefined || change.after !== undefined) && (
                <details>
                  <summary>Show exact before and after values</summary>
                  {change.before !== undefined && (
                    <>
                      <h4>Before</h4>
                      <pre>{exactValue(change.before)}</pre>
                    </>
                  )}
                  {change.after !== undefined && (
                    <>
                      <h4>After</h4>
                      <pre>{exactValue(change.after)}</pre>
                    </>
                  )}
                </details>
              )}
            </li>
          ))}
        </ol>
      )}

      {preview.requiresConfirmation && (
        <label className="storyboard-template-diff-acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={event => setAcknowledgedFingerprint(
              event.currentTarget.checked ? preview.diffFingerprint : null,
            )}
          />
          I reviewed the destructive changes shown above.
        </label>
      )}

      <div className="storyboard-template-diff-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>Cancel</button>
        )}
        <button
          type="button"
          disabled={!canApply || preview.differences.length === 0}
          onClick={() => onApply(
            preview.requiresConfirmation
              ? confirmStoryboardTemplatePreview(preview)
              : preview,
          )}
        >
          {preview.requiresConfirmation ? 'Confirm restructure' : 'Apply template'}
        </button>
      </div>
    </section>
  );
}
