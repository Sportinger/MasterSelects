import { IconCheck, IconSparkles } from '@tabler/icons-react';

import type { SeedancePreproductionRun, SeedanceStoryIdea } from '../services/seedancePreproduction/contracts';
import type {
  FinalVisualStoryConcept,
  VisualStoryConcept,
  VisualStoryConceptReview,
} from '../services/seedancePreproduction/orchestrationContracts';
import './seedanceConceptWorkshop.css';

function visualSummary(concept: VisualStoryConcept): string {
  return concept.visualSummary?.join(' ') ?? concept.visualCohesion;
}

function DraftCard({ concept, index, review }: {
  concept?: VisualStoryConcept;
  index: number;
  review?: VisualStoryConceptReview;
}) {
  if (!concept) {
    return (
      <article className="seedance-workshop-draft is-pending" aria-label={`Concept draft ${index + 1} pending`}>
        <span>{String(index + 1).padStart(2, '0')}</span>
        <div><small>Draft pending</small><strong>A distinct direction will appear here</strong></div>
      </article>
    );
  }
  return (
    <article className="seedance-workshop-draft">
      <span>{String(index + 1).padStart(2, '0')}</span>
      <div className="seedance-workshop-draft-copy">
        <small>Original visual concept</small><strong>{concept.title}</strong>
        {concept.deliverableFormat && <span className="seedance-workshop-format">{concept.deliverableFormat}</span>}
        <p>{visualSummary(concept)}</p>
        <details>
          <summary>Read visual dramaturgy and production logic</summary>
          {concept.visualDramaturgy && <ol className="seedance-workshop-dramaturgy-list">{concept.visualDramaturgy.map((sentence, sentenceIndex) => <li key={`${concept.id}-${sentenceIndex}`}>{sentence}</li>)}</ol>}
          <dl>
            <div><dt>Story relationship</dt><dd>{concept.premise} {concept.summary}</dd></div>
            <div><dt>Production</dt><dd>{concept.productionApproach}</dd></div>
          </dl>
        </details>
        <section className={`seedance-workshop-review ${review ? 'is-ready' : 'is-pending'}`}>
          <header>
            <span>{review ? <IconCheck aria-hidden="true" /> : <IconSparkles aria-hidden="true" />}</span>
            <div><small>Independent review</small><strong>{review ? review.recommendation : 'Waiting for the direction set'}</strong></div>
          </header>
          {review && <>
            <p>{review.summary}</p>
            {review.requiredImprovements.length > 0 && <ul>{review.requiredImprovements.map((item) => <li key={item}>{item}</li>)}</ul>}
            {review.alternative && <details><summary>Reviewer alternative</summary><strong>{review.alternative.title}</strong><p>{visualSummary(review.alternative)}</p></details>}
          </>}
        </section>
      </div>
    </article>
  );
}

function FinalCard({ concept, chooseIdea, inactiveLabel, selectable }: {
  concept: FinalVisualStoryConcept;
  chooseIdea: (idea: SeedanceStoryIdea) => Promise<void>;
  inactiveLabel: string;
  selectable: boolean;
}) {
  const idea: SeedanceStoryIdea = {
    id: concept.id,
    title: concept.title,
    summary: visualSummary(concept),
    tone: concept.visualCohesion,
    targetDurationSeconds: concept.targetDurationSeconds,
  };
  return (
    <article className="seedance-workshop-final">
      <header className="seedance-workshop-final-header">
        <div className="seedance-workshop-final-kicker">
          <span className="seedance-card-number">{String(concept.rank).padStart(2, '0')}</span>
          <small>{concept.targetDurationSeconds === undefined
            ? 'Final option'
            : `Final option · ${concept.targetDurationSeconds}s`}</small>
        </div>
        <h3>{concept.title}</h3>
        {concept.deliverableFormat && <span className="seedance-workshop-format">{concept.deliverableFormat}</span>}
      </header>
      <section className="seedance-workshop-final-visual" aria-label="Visual direction">
        <h4>Visual direction</h4>
        <p>{visualSummary(concept)}</p>
      </section>
      <details className="seedance-workshop-final-more">
        <summary><span>Open full visual concept</span><small>Visual dramaturgy, story relationship and production</small></summary>
        <div className="seedance-workshop-final-more-content">
          {concept.visualDramaturgy && (
            <section className="seedance-workshop-final-dramaturgy" aria-label="Visual concept and dramaturgy">
              <h4>Visual concept &amp; dramaturgy</h4>
              <ol>{concept.visualDramaturgy.map((sentence, sentenceIndex) => <li key={`${concept.id}-detail-${sentenceIndex}`}>{sentence}</li>)}</ol>
            </section>
          )}
          <section className="seedance-workshop-final-story" aria-label="Story direction">
            <h4>Story relationship</h4>
            <p className="seedance-workshop-premise">{concept.premise}</p>
            <p>{concept.summary}</p>
          </section>
          <dl className="seedance-workshop-final-details">
            <div className="is-production"><dt>Production approach</dt><dd>{concept.productionApproach}</dd></div>
            <div className="is-opportunity"><dt>Strongest opportunity</dt><dd>{concept.strongestOpportunity}</dd></div>
            <div className="is-risk"><dt>Largest risk</dt><dd>{concept.largestRisk}</dd></div>
            <div className="is-change"><dt>What the orchestrator changed</dt><dd>{concept.changeSummary}</dd></div>
          </dl>
        </div>
      </details>
      <button className="seedance-primary-action" disabled={!selectable} type="button" onClick={() => void chooseIdea(idea)}>
        {selectable ? 'Choose direction' : inactiveLabel}
      </button>
    </article>
  );
}

export function SeedanceConceptWorkshop({ chooseIdea, resume, run }: {
  chooseIdea: (idea: SeedanceStoryIdea) => Promise<void>;
  resume: () => void;
  run: SeedancePreproductionRun;
}) {
  const orchestration = run.orchestration;
  if (!orchestration) return null;
  const hasFinalConcepts = orchestration.finalConcepts.length > 0;
  const wasIndependentlyReviewed = orchestration.reviews.length > 0;
  const reviewByConcept = new Map(orchestration.reviews.map((review) => [review.conceptId, review]));
  const activeReviewers = orchestration.agents.filter((agent) => agent.role === 'concept-reviewer' && agent.status === 'running').length;
  const statusEvent = run.orchestrationEvents.toReversed().find((event) => event.kind === 'orchestrator.status');
  const resolvedDirectionCount = orchestration.finalConcepts.length
    || orchestration.drafts.length
    || (run.preferences.directionCount === 'one' ? 1 : 5);
  const directionTarget = run.preferences.directionCount === 'auto'
    && orchestration.drafts.length === 0
    ? '1 or 5'
    : String(resolvedDirectionCount);
  const status = orchestration.phase === 'ideating'
    ? `${orchestration.drafts.length} / ${directionTarget} drafts ready`
    : orchestration.phase === 'reviewing'
      ? `${orchestration.reviews.length} / ${resolvedDirectionCount} reviews ready · ${activeReviewers} active`
      : orchestration.phase === 'synthesizing'
        ? statusEvent?.kind === 'orchestrator.status' ? statusEvent.payload.message : 'The root is editing the final set.'
        : orchestration.phase === 'awaiting-selection'
          ? `${resolvedDirectionCount} final ${resolvedDirectionCount === 1 ? 'direction is' : 'directions are'} ready.`
          : orchestration.phase === 'failed'
            ? orchestration.error ?? 'The orchestration failed.'
            : orchestration.phase === 'cancelled'
              ? orchestration.error ?? 'The orchestration stopped.'
              : 'Preparing the next preproduction stage.';
  const inactiveLabel = orchestration.phase === 'failed'
    ? 'Run failed'
    : orchestration.phase === 'cancelled'
      ? 'Run stopped'
      : 'Orchestrator is still ordering';
  return (
    <section className="seedance-concept-workshop" aria-live="polite">
      <header>
        {hasFinalConcepts
          ? <div><span>01 · Visual direction</span><h2>{resolvedDirectionCount === 1 ? 'The visual direction' : 'Choose the visual direction'}</h2><p>{wasIndependentlyReviewed ? `${resolvedDirectionCount} independently reviewed directions, revised and ordered by the persistent root.` : `${resolvedDirectionCount} ${resolvedDirectionCount === 1 ? 'committed direction' : 'distinct directions'} from the persistent creative root.`}</p></div>
          : <div><span>01 · Visual dramaturgy</span><h2>{run.preferences.directionCount === 'one' ? 'Developing the strongest visual direction' : run.preferences.directionCount === 'five' ? 'Five visual concepts for you to choose from' : 'Developing the right number of visual directions'}</h2><p>The persistent creative root interprets every source and continues into story and treatment without reloading the project context.</p></div>}
        <div className="seedance-workshop-status">
          <strong>{status}</strong>
          {orchestration.phase === 'failed' && (
            <button className="seedance-secondary-action" type="button" onClick={resume}>Resume run</button>
          )}
        </div>
      </header>
      {!hasFinalConcepts && (
        <section className="seedance-workshop-originals" aria-label="Original concepts and reviews">
          <div className="seedance-workshop-section-title"><small>Live workshop</small><strong>Original drafts and independent reviews</strong></div>
          <div className="seedance-workshop-draft-grid">
            {Array.from({ length: run.preferences.directionCount === 'one' ? 1 : 5 }, (_, index) => {
              const concept = orchestration.drafts[index];
              return <DraftCard concept={concept} index={index} key={concept?.id ?? `pending-${index}`} review={concept ? reviewByConcept.get(concept.id) : undefined} />;
            })}
          </div>
        </section>
      )}
      {hasFinalConcepts && (
        <section className="seedance-workshop-finals" aria-label="Final concept options">
          <div className="seedance-workshop-section-title"><small>{wasIndependentlyReviewed ? 'Revised by the root' : 'From the persistent root'}</small><strong>{resolvedDirectionCount === 1 ? 'Direction committed; continuing automatically' : `${resolvedDirectionCount} directions, ready to choose`}</strong></div>
          <div className="seedance-workshop-final-grid">
            {orchestration.finalConcepts.toSorted((left, right) => left.rank - right.rank).map((concept) => (
              <FinalCard
                chooseIdea={chooseIdea}
                concept={concept}
                inactiveLabel={inactiveLabel}
                key={concept.id}
                selectable={orchestration.phase === 'awaiting-selection'}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}
