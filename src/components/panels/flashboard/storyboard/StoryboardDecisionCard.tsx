import { useState, type FormEvent } from 'react';
import type { StoryboardDecisionSelection } from '../../../../services/storyboard/decisions';
import { useStoryboardStore } from '../../../../stores/storyboardStore';
import './StoryboardDecisionCard.css';

interface StoryboardDecisionCardProps {
  decisionId: string;
  isBusy?: boolean;
  onSubmit: (selection: StoryboardDecisionSelection) => void;
}

export function StoryboardDecisionCard({
  decisionId,
  isBusy = false,
  onSubmit,
}: StoryboardDecisionCardProps) {
  const decision = useStoryboardStore((state) => state.decisions[decisionId]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>(
    decision?.selectedOptionIds ?? [],
  );
  const [freeform, setFreeform] = useState(decision?.freeform ?? '');

  if (!decision) return null;

  const pending = decision.state === 'pending';
  const canSubmit = pending
    && !isBusy
    && (selectedOptionIds.length > 0 || (decision.allowFreeform && freeform.trim().length > 0));
  const inputType = decision.allowMultiple ? 'checkbox' : 'radio';

  const toggleOption = (optionId: string) => {
    setSelectedOptionIds((current) => (
      decision.allowMultiple
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : [optionId]
    ));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      decisionId: decision.id,
      optionIds: selectedOptionIds,
      ...(freeform.trim() ? { freeform: freeform.trim() } : {}),
    });
  };

  return (
    <form
      className={`storyboard-decision-card is-${decision.state}`}
      aria-label={`Decision: ${decision.question}`}
      onSubmit={submit}
    >
      <div className="storyboard-decision-eyebrow">
        Co-direct · {decision.kind}
      </div>
      <fieldset disabled={!pending || isBusy}>
        <legend>{decision.question}</legend>
        {decision.explanation && (
          <p className="storyboard-decision-explanation">{decision.explanation}</p>
        )}
        <div className="storyboard-decision-options">
          {decision.options.map((option) => {
            const selected = selectedOptionIds.includes(option.id);
            return (
              <div className={`storyboard-decision-option ${selected ? 'is-selected' : ''}`} key={option.id}>
                <label>
                  <input
                    checked={selected}
                    name={`decision-${decision.id}`}
                    onChange={() => toggleOption(option.id)}
                    type={inputType}
                    value={option.id}
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <span>{option.summary}</span>
                  </span>
                </label>
                {option.rationale && <p>{option.rationale}</p>}
                {option.tradeoffs.length > 0 && (
                  <ul>
                    {option.tradeoffs.map((tradeoff) => <li key={tradeoff}>{tradeoff}</li>)}
                  </ul>
                )}
                {option.estimatedCredits !== undefined && (
                  <div className="storyboard-decision-cost">
                    Estimate: {option.estimatedCredits} credits
                  </div>
                )}
                {pending && (
                  <button
                    className="storyboard-decision-refine"
                    disabled={isBusy}
                    onClick={() => onSubmit({
                      decisionId: decision.id,
                      optionIds: [option.id],
                      freeform: `Create more options like ${option.title}.`,
                      refinement: 'more-like',
                    })}
                    type="button"
                  >
                    More like this
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {decision.allowFreeform && pending && (
          <label className="storyboard-decision-freeform">
            <span>Direction or combination</span>
            <textarea
              onChange={(event) => setFreeform(event.target.value)}
              placeholder="For example: A’s opening with C’s ending"
              rows={2}
              value={freeform}
            />
          </label>
        )}
      </fieldset>
      {pending ? (
        <button className="storyboard-decision-submit" disabled={!canSubmit} type="submit">
          {isBusy ? 'Recompiling…' : 'Continue with selection'}
        </button>
      ) : (
        <div className="storyboard-decision-state" role="status">
          {decision.state === 'stale'
            ? 'This decision is stale. Ask for refreshed options.'
            : decision.state === 'resolved'
              ? 'Decision applied to the latest plan.'
              : 'Decision dismissed.'}
        </div>
      )}
    </form>
  );
}
