import type {
  StoryboardCandidate,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../../services/storyboard/contracts';
import type { VariantBoundaryMutationPolicy } from '../../../services/storyboard/variants';
import './StoryboardVariantComparisonTray.css';

export interface StoryboardVariantComparisonTrayProps {
  activeOptionId?: string;
  candidates: Readonly<Record<string, StoryboardCandidate>>;
  isPlaying: boolean;
  loop: boolean;
  options: readonly TimelineVariantOption[];
  playhead: number;
  variantSet: TimelineVariantSet;
  boundaryPolicy?: VariantBoundaryMutationPolicy;
  commitError?: string;
  isCommitting?: boolean;
  onAccept: (optionId: string) => void;
  onAssignPreview?: (optionId: string) => void;
  onOptionSelect: (optionId: string) => void;
  onPlayPause: () => void;
  onRefine: (optionId: string) => void;
  onReject: (optionId: string) => void;
  onSeek: (time: number) => void;
  onToggleLoop: () => void;
  onBoundaryPolicyChange?: (policy: VariantBoundaryMutationPolicy) => void;
}

function formatTime(time: number): string {
  const safe = Math.max(0, time);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function candidateSummary(
  option: TimelineVariantOption,
  candidates: Readonly<Record<string, StoryboardCandidate>>,
): { label: string; estimatedCredits: number; actualCredits: number } {
  const entries = option.candidateIds
    .map((candidateId) => candidates[candidateId])
    .filter((candidate): candidate is StoryboardCandidate => candidate !== undefined);
  const ready = entries.filter((candidate) => (
    candidate.state === 'ready' || candidate.state === 'accepted'
  )).length;
  const failed = entries.filter((candidate) => (
    candidate.state === 'failed'
    || candidate.state === 'canceled'
    || candidate.state === 'rejected'
  )).length;
  const pending = Math.max(0, entries.length - ready - failed);
  const label = entries.length === 0
    ? 'No generation required'
    : `${ready}/${entries.length} candidates ready`
      + (pending > 0 ? ` · ${pending} pending` : '')
      + (failed > 0 ? ` · ${failed} failed` : '');
  return {
    label,
    estimatedCredits: entries.reduce(
      (total, candidate) => total + (candidate.estimatedCredits ?? 0),
      0,
    ),
    actualCredits: entries.reduce(
      (total, candidate) => total + (candidate.actualCredits ?? 0),
      0,
    ),
  };
}

function optionStateLabel(option: TimelineVariantOption): string {
  if (option.materializedCompositionId && option.state === 'building') {
    return 'Partially playable';
  }
  if (option.state === 'failed') return 'Failed — unavailable';
  return option.state[0]!.toUpperCase() + option.state.slice(1);
}

export function StoryboardVariantComparisonTray({
  activeOptionId,
  candidates,
  isPlaying,
  loop,
  options,
  playhead,
  variantSet,
  boundaryPolicy = 'preserve',
  commitError,
  isCommitting = false,
  onAccept,
  onAssignPreview,
  onOptionSelect,
  onPlayPause,
  onRefine,
  onReject,
  onSeek,
  onToggleLoop,
  onBoundaryPolicyChange,
}: StoryboardVariantComparisonTrayProps) {
  const activeOption = options.find((option) => option.id === activeOptionId)
    ?? options[0];
  if (!activeOption) return null;
  const summary = candidateSummary(activeOption, candidates);
  const activeIndex = options.indexOf(activeOption);

  return (
    <section
      aria-label={`Timeline variants: ${variantSet.title}`}
      className="storyboard-variant-comparison-tray"
    >
      <header>
        <div>
          <span className="storyboard-variant-comparison-eyebrow">Compare range</span>
          <strong>{variantSet.title}</strong>
          <span className="storyboard-variant-comparison-scope">
            {formatTime(variantSet.scope.startTime)}–{formatTime(variantSet.scope.endTime)}
            {' · '}
            {variantSet.scope.trackIds.length} track
            {variantSet.scope.trackIds.length === 1 ? '' : 's'}
            {variantSet.scope.includeLinked ? ' + linked' : ''}
          </span>
        </div>
        <span className={`is-${variantSet.status}`} role="status">
          {variantSet.status}
        </span>
      </header>

      <div aria-label="Variant options" className="storyboard-variant-tabs" role="tablist">
        {options.map((option, index) => (
          <button
            aria-controls={`storyboard-variant-panel-${option.id}`}
            aria-selected={option.id === activeOption.id}
            disabled={!option.materializedCompositionId || option.state === 'failed'}
            id={`storyboard-variant-tab-${option.id}`}
            key={option.id}
            onClick={() => onOptionSelect(option.id)}
            role="tab"
            type="button"
          >
            <span>Option {String.fromCharCode(65 + index)}</span>
            <strong>{option.title}</strong>
            <small>{optionStateLabel(option)}</small>
          </button>
        ))}
      </div>

      <div
        aria-labelledby={`storyboard-variant-tab-${activeOption.id}`}
        id={`storyboard-variant-panel-${activeOption.id}`}
        role="tabpanel"
      >
        <p>{activeOption.rationale}</p>
        <div className="storyboard-variant-facts">
          <span>{summary.label}</span>
          <span>
            Estimate {summary.estimatedCredits} credits
            {summary.actualCredits > 0 ? ` · actual ${summary.actualCredits}` : ''}
          </span>
          <span>{activeIndex + 1} of {options.length}</span>
        </div>
        {activeOption.fragment.warnings.length > 0 && (
          <ul aria-label="Variant warnings" className="storyboard-variant-warnings">
            {activeOption.fragment.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
      </div>

      <div aria-label="Synchronized variant playback" className="storyboard-variant-playback">
        <button onClick={onPlayPause} type="button">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <label>
          <span className="sr-only">Variant playhead</span>
          <input
            aria-valuetext={formatTime(playhead)}
            max={variantSet.scope.endTime}
            min={variantSet.scope.startTime}
            onChange={(event) => onSeek(Number(event.target.value))}
            step="0.01"
            type="range"
            value={Math.min(variantSet.scope.endTime, Math.max(
              variantSet.scope.startTime,
              playhead,
            ))}
          />
        </label>
        <output>{formatTime(playhead)}</output>
        <button aria-pressed={loop} onClick={onToggleLoop} type="button">
          Loop
        </button>
      </div>

      <footer>
        {onBoundaryPolicyChange && (
          <label className="storyboard-variant-boundary-policy">
            <span>Boundary transitions</span>
            <select
              aria-label="Boundary transition policy"
              disabled={isCommitting}
              onChange={(event) => onBoundaryPolicyChange(
                event.target.value as VariantBoundaryMutationPolicy,
              )}
              value={boundaryPolicy}
            >
              <option value="preserve">Preserve or stop</option>
              <option value="rebuild">Rebuild</option>
              <option value="drop-with-warning">Drop with warning</option>
            </select>
          </label>
        )}
        {onAssignPreview && (
          <button onClick={() => onAssignPreview(activeOption.id)} type="button">
            Assign Preview
          </button>
        )}
        <button onClick={() => onRefine(activeOption.id)} type="button">
          Refine
        </button>
        <button onClick={() => onReject(activeOption.id)} type="button">
          Reject
        </button>
        <button
          className="is-primary"
          disabled={
            isCommitting
            || !activeOption.materializedCompositionId
            || activeOption.state === 'failed'
          }
          onClick={() => onAccept(activeOption.id)}
          type="button"
        >
          {isCommitting ? 'Committing…' : 'Select for commit'}
        </button>
      </footer>
      {commitError && (
        <p className="storyboard-variant-commit-error" role="alert">
          {commitError}
        </p>
      )}
    </section>
  );
}
