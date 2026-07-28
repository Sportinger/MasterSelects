import type { AnalysisScenePerson, AnalysisSpeakerState } from './analysisSceneViewModel';

export interface AnalysisPersonChipProps {
  person: AnalysisScenePerson;
  speakerState?: AnalysisSpeakerState;
  selected?: boolean;
  onSelect?: (person: AnalysisScenePerson) => void;
}

function confidenceLabel(confidence: number | undefined): string | undefined {
  return Number.isFinite(confidence) ? `${Math.round((confidence as number) * 100)}% confidence` : undefined;
}

/** Deliberately textual: a crop is resolved lazily by the parent workspace. */
export function AnalysisPersonChip({ person, speakerState, selected = false, onSelect }: AnalysisPersonChipProps) {
  const stateLabel = speakerState === 'active' ? 'active speaker' : speakerState === 'offscreen' ? 'off-screen speaker' : undefined;
  const details = [stateLabel, confidenceLabel(person.confidence)].filter(Boolean).join(', ');
  return (
    <button
      aria-label={`${person.label}${details ? `, ${details}` : ''}`}
      aria-pressed={selected}
      className={[
        'AnalysisScenePersonChip',
        selected ? 'AnalysisScenePersonChip--selected' : '',
        speakerState ? `AnalysisScenePersonChip--${speakerState}` : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onSelect?.(person)}
      title={details || person.label}
      type="button"
    >
      <span aria-hidden="true" className="AnalysisScenePersonChip__marker" />
      <span>{person.label}</span>
      {details && <span className="AnalysisScenePersonChip__detail">{details}</span>}
    </button>
  );
}
