import { useEffect, useMemo, useState } from 'react';
import {
  IconCheck,
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconMovie,
  IconPhotoSearch,
  IconRefresh,
  IconSparkles,
} from '@tabler/icons-react';

import type {
  SeedanceKeyframeBrief,
  SeedanceMasterLook,
  SeedancePreproductionRun,
  SeedanceStoryIdea,
} from '../services/seedancePreproduction/contracts';
import { researchRequirementsForRun } from '../services/seedancePreproduction/assetPlan';
import { presentSeedancePreproductionError } from '../services/seedancePreproduction/errorPresentation';
import { selectSeedanceGenerationAssets } from '../services/seedancePreproduction/referenceSelection';
import { useMediaStore } from '../stores/mediaStore';
import { SeedanceAssetChecklist } from './SeedanceAssetChecklist';
import { SeedanceConceptWorkshop } from './SeedanceConceptWorkshop';
import { SeedanceOrchestrationActivity } from './SeedanceOrchestrationActivity';
import './seedanceAssetChecklist.css';

interface SeedancePreproductionWizardProps {
  chooseIdea: (idea: SeedanceStoryIdea) => Promise<void>;
  chooseMaster: (look: SeedanceMasterLook) => Promise<void>;
  continueFromMedia: () => Promise<void>;
  moreIdeas: (idea: SeedanceStoryIdea) => Promise<void>;
  onOpenEditor?: () => void;
  readyKeyframeCount: number;
  regenerateMasters: () => Promise<void>;
  regenerateSelected: (feedback: string) => Promise<void>;
  replanAssets: () => Promise<void>;
  retrySourceResearch: () => Promise<void>;
  resume: () => void;
  reset: () => void;
  run: SeedancePreproductionRun;
  setSceneExpanded?: (sceneId: string, expanded: boolean) => void;
  setStoryExpanded: (expanded: boolean) => void;
  toggleKeyframe: (briefId: string) => void;
  toggleSourceAsset: (assetId: string) => void;
}

const STEP_PHASES = [
  { id: 'idea', label: 'Direction' },
  { id: 'media', label: 'Sources' },
  { id: 'master', label: 'Master look' },
  { id: 'keyframes', label: 'Keyframes' },
  { id: 'ready', label: 'Generation pack' },
] as const;

const DIRECT_STEP_PHASES = [
  { id: 'idea', label: 'Direction' },
  { id: 'plan', label: 'Plan' },
  { id: 'edit', label: 'Edit' },
] as const;

const ACTIVE_STEP_BY_PHASE: Record<SeedancePreproductionRun['phase'], number> = {
  idle: 0,
  'generating-ideas': 0,
  'choosing-idea': 0,
  'writing-story': 1,
  'planning-assets': 1,
  researching: 1,
  'reviewing-media': 1,
  'implementing-edit': 2,
  'edit-ready': 4,
  'generating-masters': 2,
  'choosing-master': 2,
  'generating-keyframes': 3,
  'reviewing-keyframes': 3,
  ready: 4,
  failed: 0,
};

function phaseMessage(run: SeedancePreproductionRun): { detail: string; title: string } {
  switch (run.phase) {
    case 'generating-ideas':
      return run.preferences.directionCount === 'one'
        ? { title: 'Finding the strongest direction', detail: 'The persistent creative root is turning the complete transcript and visual sources into one committed production approach.' }
        : run.preferences.directionCount === 'five'
          ? { title: 'Finding five strong directions', detail: 'The persistent creative root is turning the complete transcript and visual sources into five distinct production approaches.' }
          : { title: 'Finding the right direction set', detail: 'The persistent creative root will choose whether this brief benefits from one committed direction or five alternatives.' };
    case 'writing-story':
      return { title: 'Preparing the selected production plan', detail: 'The narrative, scene boundaries and visual intent are being aligned privately.' };
    case 'planning-assets':
      return { title: 'Auditing every scene asset', detail: 'The kernel is assigning every visible need to Commons, project media, practical footage, generation or design.' };
    case 'researching':
      return { title: 'Finding reliable visual references', detail: 'Wikimedia Commons is being searched for the people, places and objects the story needs.' };
    case 'implementing-edit':
      return { title: 'Implementing the selected plan', detail: 'The root orchestrator is applying the chosen direction directly with the verified project footage.' };
    case 'generating-masters':
      return { title: 'Creating four overall looks', detail: 'Each image proposes a complete visual language for the same story.' };
    case 'generating-keyframes':
      return { title: 'Building consistent keyframes', detail: 'The chosen master, source media and earlier frames anchor every new image.' };
    default:
      return { title: 'Preparing your Story workflow', detail: 'The next structured result will appear here.' };
  }
}

function formatRunElapsed(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
    : `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function RunElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setNow(Date.now());
    });
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [startedAt]);
  return (
    <time className="seedance-progress-elapsed" aria-hidden="true">
      <span>Run</span>{formatRunElapsed(now - startedAt)}
    </time>
  );
}

function ProgressCard({ run }: { run: SeedancePreproductionRun }) {
  const message = phaseMessage(run);
  const masterReady = run.masterLooks.filter((look) => look.status === 'ready').length;
  const keyframeReady = Object.keys(run.acceptedVersionByBriefId).length;
  const showCount = run.phase === 'generating-masters' || run.phase === 'generating-keyframes';
  const count = run.phase === 'generating-masters'
    ? `${masterReady} / 4 looks ready`
    : `${keyframeReady} / ${run.keyframeBriefs.length || '—'} keyframes ready`;

  return (
    <section className="seedance-progress-card" aria-live="polite" role="status">
      <div className="seedance-progress-summary">
        <span className="seedance-progress-symbol" aria-hidden="true"><IconSparkles /></span>
        <div className="seedance-progress-copy">
          <div className="seedance-progress-heading">
            <strong>{message.title}</strong>
            {run.orchestration
              ? <SeedanceOrchestrationActivity compact run={run} />
              : <RunElapsedTime startedAt={run.createdAt} />}
          </div>
          {!run.orchestration && <p>{message.detail}</p>}
          {showCount && <span className="seedance-progress-count">{count}</span>}
        </div>
      </div>
      <span className="seedance-progress-orbit" aria-hidden="true" />
    </section>
  );
}

function StoryDisclosure({
  run,
  setSceneExpanded,
  setStoryExpanded,
}: Pick<SeedancePreproductionWizardProps, 'run' | 'setSceneExpanded' | 'setStoryExpanded'>) {
  if (!run.story) return null;
  return (
    <>
      <section className={`seedance-story-disclosure ${run.storyExpanded ? 'is-expanded' : ''}`}>
        <button type="button" onClick={() => setStoryExpanded(!run.storyExpanded)}>
          <span>
            <small>Production plan prepared in the kernel</small>
            <strong>{run.story.title}</strong>
          </span>
          <IconChevronDown aria-hidden="true" />
        </button>
        {run.storyExpanded && (
          <div className="seedance-story-body">
            <p>{run.story.summary}</p>
          </div>
        )}
      </section>
      {run.storyExpanded && (
        <SeedanceAssetChecklist onSceneExpandedChange={setSceneExpanded} run={run} />
      )}
    </>
  );
}

function ResearchReport({ run }: { run: SeedancePreproductionRun }) {
  const requirements = researchRequirementsForRun(run);
  if (requirements.length === 0) return null;
  const diagnostics = run.researchDiagnostics ?? [];
  const matched = diagnostics.filter((item) => item.status === 'matched').length;
  const failed = diagnostics.filter((item) => item.status === 'failed').length;
  return (
    <details className="seedance-research-report">
      <summary>
        <span>Commons research report</span>
        <strong>{diagnostics.length === 0
          ? `${requirements.length} searches need a fresh run`
          : `${matched} matched · ${failed} failed · ${diagnostics.length - matched - failed} empty`}</strong>
      </summary>
      <ol>
        {requirements.map((requirement) => {
          const diagnostic = diagnostics.find((item) => item.requirementId === requirement.id);
          return (
            <li className={`is-${diagnostic?.status ?? 'pending'}`} key={requirement.id}>
              <div><strong>{requirement.query}</strong><span>{requirement.purpose}</span></div>
              <small>{diagnostic
                ? `${diagnostic.resultCount} retained · ${diagnostic.attempts.length} ${diagnostic.attempts.length === 1 ? 'query' : 'queries'} tried`
                : 'No diagnostic retained for this saved run'}</small>
              {diagnostic && diagnostic.attempts.length > 0 && (
                <ul>
                  {diagnostic.attempts.map((attempt) => (
                    <li key={attempt.query}>
                      <code>{attempt.query}</code>
                      <span>{attempt.status === 'failed' ? attempt.error : `${attempt.resultCount} relevant`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </details>
  );
}

function MediaImage({ mediaFileId, alt }: { alt: string; mediaFileId?: string }) {
  const file = useMediaStore((state) => (
    mediaFileId ? state.files.find((candidate) => candidate.id === mediaFileId) : undefined
  ));
  const src = file?.thumbnailUrl || file?.url;
  return src
    ? <img alt={alt} decoding="async" draggable={false} loading="lazy" src={src} />
    : <span className="seedance-image-placeholder" aria-hidden="true"><IconSparkles /></span>;
}

function MasterLooks({
  chooseMaster,
  regenerateMasters,
  run,
}: Pick<SeedancePreproductionWizardProps, 'chooseMaster' | 'regenerateMasters' | 'run'>) {
  return (
    <section className="seedance-stage-card">
      <div className="seedance-stage-heading">
        <div><span>03 · Master look</span><h2>Choose the visual world</h2><p>These are four different overall looks—not four consecutive shots.</p></div>
        <button className="seedance-secondary-action" type="button" onClick={() => void regenerateMasters()}>
          <IconRefresh aria-hidden="true" /> Four new looks
        </button>
      </div>
      <div className="seedance-master-grid">
        {run.masterLooks.map((look) => (
          <button
            className={`seedance-master-card is-${look.status}`}
            disabled={look.status !== 'ready'}
            key={look.id}
            type="button"
            onClick={() => void chooseMaster(look)}
          >
            <div className="seedance-master-image">
              <MediaImage alt={look.title} mediaFileId={look.mediaFileId} />
              {look.status === 'generating' && <span className="seedance-card-status">Generating…</span>}
              {look.status === 'failed' && <span className="seedance-card-status is-error">Failed</span>}
            </div>
            <span className="seedance-master-copy"><strong>{look.title}</strong><small>{look.description}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}

function KeyframeCard({
  brief,
  run,
  toggleKeyframe,
}: {
  brief: SeedanceKeyframeBrief;
  run: SeedancePreproductionRun;
  toggleKeyframe: (briefId: string) => void;
}) {
  const acceptedVersionId = run.acceptedVersionByBriefId[brief.id];
  const acceptedVersion = run.keyframeVersions.find((version) => version.id === acceptedVersionId);
  const versions = run.keyframeVersions.filter((version) => (
    version.briefId === brief.id && version.status === 'ready'
  ));
  const selected = run.selectedKeyframeIds.includes(brief.id);

  return (
    <button
      aria-pressed={selected}
      className={`seedance-keyframe-card ${selected ? 'is-selected' : ''}`}
      type="button"
      onClick={() => toggleKeyframe(brief.id)}
    >
      <div className="seedance-keyframe-image">
        <MediaImage alt={brief.title} mediaFileId={acceptedVersion?.mediaFileId} />
        <span className="seedance-selection-mark" aria-hidden="true"><IconCheck /></span>
      </div>
      <span><strong>{brief.title}</strong><small>{versions.length} {versions.length === 1 ? 'version' : 'versions'} retained</small></span>
    </button>
  );
}

function Keyframes({
  readyKeyframeCount,
  regenerateSelected,
  run,
  toggleKeyframe,
}: Pick<SeedancePreproductionWizardProps, 'readyKeyframeCount' | 'regenerateSelected' | 'run' | 'toggleKeyframe'>) {
  const [feedback, setFeedback] = useState('');
  const selectedCount = run.selectedKeyframeIds.length;

  return (
    <section className="seedance-stage-card">
      <div className="seedance-stage-heading">
        <div><span>04 · Keyframes</span><h2>Review the visual beats</h2><p>{readyKeyframeCount} frames are anchored to the chosen look. Select any that need a new version.</p></div>
      </div>
      <div className="seedance-keyframe-grid">
        {run.keyframeBriefs.map((brief) => (
          <KeyframeCard brief={brief} key={brief.id} run={run} toggleKeyframe={toggleKeyframe} />
        ))}
      </div>
      <div className="seedance-regenerate-bar">
        <label>
          <span>Optional direction for the new version</span>
          <input
            maxLength={500}
            placeholder="e.g. calmer camera, less dramatic light"
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
          />
        </label>
        <button
          className="seedance-primary-action"
          disabled={selectedCount === 0}
          type="button"
          onClick={() => void regenerateSelected(feedback)}
        >
          <IconRefresh aria-hidden="true" /> Regenerate {selectedCount || ''}
        </button>
      </div>
    </section>
  );
}

function SeedancePackage({ run }: { run: SeedancePreproductionRun }) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const mediaFiles = useMediaStore((state) => state.files);
  const fileById = useMemo(() => new Map(mediaFiles.map((file) => [file.id, file])), [mediaFiles]);

  const copyPrompt = async (segmentId: string, prompt: string, negativePrompt: string) => {
    const value = `${prompt}\n\nNegative prompt: ${negativePrompt}`;
    await navigator.clipboard.writeText(value);
    setCopiedId(segmentId);
    window.setTimeout(() => setCopiedId((current) => current === segmentId ? null : current), 1600);
  };

  return (
    <section className="seedance-stage-card seedance-package-card">
      <div className="seedance-stage-heading">
        <div><span>05 · Generation pack</span><h2>Ready for controlled generation</h2><p>Every segment is at most 30 seconds and carries its ordered image references.</p></div>
        <span className="seedance-ready-badge"><IconCheck aria-hidden="true" /> Ready</span>
      </div>
      <div className="seedance-segment-list">
        {run.segments.map((segment, index) => {
          const references = segment.keyframeIds.flatMap((briefId) => {
            const versionId = run.acceptedVersionByBriefId[briefId];
            const version = run.keyframeVersions.find((candidate) => candidate.id === versionId);
            const file = version?.mediaFileId ? fileById.get(version.mediaFileId) : undefined;
            return file ? [{ briefId, file }] : [];
          });
          return (
            <article className="seedance-segment" key={segment.id}>
              <div className="seedance-segment-heading">
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div><strong>{segment.title}</strong><small>{segment.durationSeconds}s · {references.length} ordered references</small></div>
                <button type="button" onClick={() => void copyPrompt(segment.id, segment.prompt, segment.negativePrompt)}>
                  {copiedId === segment.id ? <IconCheck aria-hidden="true" /> : <IconCopy aria-hidden="true" />}
                  {copiedId === segment.id ? 'Copied' : 'Copy prompt'}
                </button>
              </div>
              <p>{segment.prompt}</p>
              <div className="seedance-reference-strip" aria-label={`Ordered references for ${segment.title}`}>
                {references.map(({ briefId, file }, referenceIndex) => (
                  <span key={briefId} title={file.name}>
                    <b>{referenceIndex + 1}</b><img alt="" decoding="async" draggable={false} loading="lazy" src={file.thumbnailUrl || file.url} />
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function SeedancePreproductionWizard(props: SeedancePreproductionWizardProps) {
  const { run } = props;
  const [sourceMediaExpanded, setSourceMediaExpanded] = useState(false);
  const directEdit = run.orchestration?.treatment?.aiGeneration?.required === false;
  const steps = directEdit ? DIRECT_STEP_PHASES : STEP_PHASES;
  const activeStep = directEdit
    ? run.phase === 'implementing-edit' || run.phase === 'edit-ready'
      ? 2
      : run.phase === 'writing-story' || run.phase === 'planning-assets'
        ? 1
        : 0
    : ACTIVE_STEP_BY_PHASE[run.phase];
  const selectedAssets = run.sourceAssets.filter((asset) => asset.selected).length;
  const generationReferenceCount = selectSeedanceGenerationAssets(run.sourceAssets).length;
  const researchRequirements = researchRequirementsForRun(run);
  const errorPresentation = presentSeedancePreproductionError(run.error);
  const isProgress = [
    'generating-ideas',
    'writing-story',
    'planning-assets',
    'researching',
    'implementing-edit',
    'generating-masters',
    'generating-keyframes',
  ].includes(run.phase);

  return (
    <div className="seedance-wizard">
      <header className="seedance-wizard-header">
        <div className="seedance-wizard-title"><span><IconMovie aria-hidden="true" /></span><div><small>Story workflow{run.sourceBundle ? ` · ${run.sourceBundle.entryCount} stored ${run.sourceBundle.entryCount === 1 ? 'source' : 'sources'}` : ' · storing project sources…'}</small><strong>{run.prompt}</strong></div></div>
        <button className="seedance-reset" type="button" onClick={props.reset}>Start over</button>
      </header>

      <nav className="seedance-step-rail" aria-label="Story workflow progress">
        {steps.map((step, index) => (
          <span className={index < activeStep ? 'is-complete' : index === activeStep ? 'is-active' : ''} key={step.id}>
            <i>{index < activeStep ? <IconCheck aria-hidden="true" /> : index + 1}</i>{step.label}
          </span>
        ))}
      </nav>

      {run.orchestration && !isProgress && run.phase !== 'failed' && (
        <SeedanceOrchestrationActivity run={run} />
      )}

      {isProgress && <ProgressCard run={run} />}

      {run.orchestration && ['generating-ideas', 'choosing-idea'].includes(run.phase) && (
        <SeedanceConceptWorkshop chooseIdea={props.chooseIdea} resume={props.resume} run={run} />
      )}

      {!run.orchestration && run.phase === 'choosing-idea' && (
        <section className="seedance-stage-card">
          <div className="seedance-stage-heading"><div><span>01 · Direction</span><h2>Choose the strongest video direction</h2><p>{run.ideas.length} production {run.ideas.length === 1 ? 'approach' : 'approaches'} based on your prompt and project material. Existing scripts remain authoritative.</p></div></div>
          <div className="seedance-idea-grid">
            {run.ideas.map((idea, index) => (
              <article className="seedance-idea-card" key={idea.id}>
                <span className="seedance-card-number">0{index + 1}</span>
                <div><small>{idea.targetDurationSeconds === undefined
                  ? idea.tone
                  : `${idea.tone} · ${idea.targetDurationSeconds}s`}</small><h3>{idea.title}</h3><p>{idea.summary}</p></div>
                <div className="seedance-idea-actions">
                  <button className="seedance-primary-action" type="button" onClick={() => void props.chooseIdea(idea)}>Choose direction</button>
                  <button className="seedance-text-action" type="button" onClick={() => void props.moreIdeas(idea)}>More like this</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {run.story && run.phase !== 'writing-story' && (
        <StoryDisclosure
          run={run}
          setSceneExpanded={props.setSceneExpanded}
          setStoryExpanded={props.setStoryExpanded}
        />
      )}

      {run.phase === 'reviewing-media' && (
        <section className="seedance-stage-card seedance-source-stage">
          <div className="seedance-stage-heading">
            <div><span>02 · Verified source media</span><h2>Keep only useful references</h2><p>These Commons images ground factual details. Deselect anything that should not influence the {directEdit ? 'edit' : 'generation'}.</p></div>
            <button
              aria-controls="seedance-source-media-body"
              aria-expanded={sourceMediaExpanded}
              className="seedance-source-toggle"
              type="button"
              onClick={() => setSourceMediaExpanded((expanded) => !expanded)}
            >
              <span>{selectedAssets} selected · {generationReferenceCount} used next</span>
              <strong>{sourceMediaExpanded ? 'Hide source media' : 'Show source media'}</strong>
              <IconChevronDown aria-hidden="true" />
            </button>
          </div>
          {sourceMediaExpanded && (
            <div className="seedance-source-body" id="seedance-source-media-body">
              {run.sourceAssets.length > 0 ? (
                <div className="seedance-source-grid">
                  {run.sourceAssets.map((asset) => (
                    <article className={`seedance-source-card ${asset.selected ? 'is-selected' : ''}`} key={asset.id}>
                      <button aria-pressed={asset.selected} type="button" onClick={() => props.toggleSourceAsset(asset.id)}>
                        <img alt={asset.title} decoding="async" draggable={false} loading="lazy" src={asset.thumbnailUrl} />
                        <span className="seedance-selection-mark" aria-hidden="true"><IconCheck /></span>
                      </button>
                      <div><strong>{asset.title}</strong><small>{asset.creator || 'Unknown creator'} · {asset.license}</small><a href={asset.sourceUrl} rel="noreferrer" target="_blank">Source <IconExternalLink aria-hidden="true" /></a></div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="seedance-no-sources"><IconPhotoSearch aria-hidden="true" /><strong>{researchRequirements.length > 0 ? 'No usable Commons reference was retained.' : 'No scene asset was routed to Commons.'}</strong><p>{researchRequirements.length > 0 ? 'Open the research report to distinguish empty searches from failed requests, or retry the planned queries.' : 'The scene map still lists every required project, practical, generated and designed asset.'}</p></div>
              )}
            </div>
          )}
          {run.error && <p className="seedance-inline-error" role="alert">{run.error}</p>}
          <ResearchReport run={run} />
          <div className="seedance-stage-footer">
            <button className="seedance-secondary-action" type="button" onClick={() => void props.replanAssets()}><IconSparkles aria-hidden="true" /> Re-plan assets</button>
            <button className="seedance-secondary-action" type="button" onClick={() => void props.retrySourceResearch()}><IconRefresh aria-hidden="true" /> Retry Commons search</button>
            <button className="seedance-primary-action" type="button" onClick={() => void props.continueFromMedia()}>{directEdit ? 'Implement approved edit' : 'Create four master looks'}</button>
          </div>
        </section>
      )}

      {run.phase === 'choosing-master' && <MasterLooks {...props} />}

      {(run.phase === 'reviewing-keyframes' || run.phase === 'ready') && (
        <Keyframes {...props} />
      )}

      {run.phase === 'ready' && <SeedancePackage run={run} />}

      {run.phase === 'edit-ready' && (
        <section className="seedance-stage-card">
          <div className="seedance-stage-heading">
            <div>
              <span>03 · Direct edit complete</span>
              <h2>The selected production plan is implemented</h2>
              <p>The root orchestrator used the existing project footage without Wikimedia research, generated master looks, or keyframe-image selection.</p>
            </div>
          </div>
          {props.onOpenEditor && (
            <div className="seedance-stage-footer">
              <button className="seedance-primary-action" type="button" onClick={props.onOpenEditor}>Open the edit</button>
            </div>
          )}
        </section>
      )}

      {run.phase === 'failed' && (
        <section className="seedance-error-card" role="alert">
          <span>Preproduction stopped</span>
          <strong>{errorPresentation.title}</strong>
          <p>{errorPresentation.message}</p>
          {run.orchestration && (
            <SeedanceOrchestrationActivity embedded hideDetail run={run} />
          )}
          {errorPresentation.technicalDetails && (
            <details className="seedance-error-details">
              <summary>Technical details</summary>
              <code>{errorPresentation.technicalDetails}</code>
            </details>
          )}
          <p>Your existing project media was not removed.</p>
          <button className="seedance-primary-action" type="button" onClick={run.ideas.length > 0 || run.story ? props.resume : props.reset}>{run.ideas.length > 0 || run.story ? 'Return to last review' : 'Start again'}</button>
        </section>
      )}
    </div>
  );
}
