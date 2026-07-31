import type {
  StoryboardAnimaticRenderMode,
  StoryboardExportWarning,
} from '../../../services/storyboard/animatic/types';

type ExportMode = Exclude<StoryboardAnimaticRenderMode, 'preview'>;

export interface StoryboardExportModeControlProps {
  readonly mode: ExportMode;
  readonly warnings: readonly StoryboardExportWarning[];
  readonly onChange: (mode: ExportMode) => void;
}
export function StoryboardExportModeControl({
  mode,
  warnings,
  onChange,
}: StoryboardExportModeControlProps) {
  const normalBlocked = mode === 'normal-export' && warnings.length > 0;
  return (
    <section
      aria-labelledby="storyboard-export-mode-heading"
      style={{
        margin: '12px 0',
        padding: 12,
        border: '1px solid var(--border-color, #3f3f46)',
        borderRadius: 8,
      }}
    >
      <h4 id="storyboard-export-mode-heading" style={{ margin: '0 0 8px' }}>
        Storyboard output
      </h4>
      <div role="radiogroup" aria-label="Storyboard export mode">
        <label style={{ marginRight: 16 }}>
          <input
            type="radio"
            name="storyboard-export-mode"
            value="normal-export"
            checked={mode === 'normal-export'}
            onChange={() => onChange('normal-export')}
          />{' '}
          Normal video
        </label>
        <label>
          <input
            type="radio"
            name="storyboard-export-mode"
            value="animatic-export"
            checked={mode === 'animatic-export'}
            onChange={() => onChange('animatic-export')}
          />{' '}
          Animatic (slates + stills)
        </label>
      </div>

      {normalBlocked && (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="storyboard-normal-export-warning"
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 6,
            color: '#fecaca',
            background: 'rgba(127, 29, 29, 0.45)',
          }}
        >
          Normal export is blocked: {warnings.length} storyboard{' '}
          {warnings.length === 1 ? 'scene has' : 'scenes have'} no accepted media.
          Choose Animatic to render visible scene slates.
          <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
            {warnings.map(warning => (
              <li key={warning.id}>{warning.title}</li>
            ))}
          </ul>
        </div>
      )}

      {mode === 'animatic-export' && (
        <p role="status" style={{ margin: '8px 0 0', opacity: 0.8 }}>
          Animatic mode renders unfilled scenes as labeled slates and filled scenes from their media.
        </p>
      )}
    </section>
  );
}
