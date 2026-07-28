import { AnalysisPersonChip } from './AnalysisPersonChip';
import { AnalysisSceneTranscript } from './AnalysisSceneTranscript';
import { formatAnalysisSceneTime, type AnalysisScenePerson, type AnalysisSceneTranscriptWord, type AnalysisSceneView } from './analysisSceneViewModel';
import './AnalysisScene.css';

export interface AnalysisSceneCardProps {
  scene: AnalysisSceneView;
  playheadTime?: number;
  selectedPersonId?: string;
  /** The host resolves this opaque reference only after the card is visible. */
  onRequestKeyframe?: (keyframeRef: string, scene: AnalysisSceneView) => void;
  onPersonSelect?: (person: AnalysisScenePerson, scene: AnalysisSceneView) => void;
  onWordClick?: (word: AnalysisSceneTranscriptWord, scene: AnalysisSceneView) => void;
  onDescriptionRequest?: (scene: AnalysisSceneView) => void;
}

function summaryLabel(title: string, value: { label: string; detail?: string } | undefined) {
  if (!value) return null;
  return <div className="AnalysisSceneCard__fact"><dt>{title}</dt><dd>{value.label}{value.detail ? ` · ${value.detail}` : ''}</dd></div>;
}

export function AnalysisSceneCard({
  scene,
  playheadTime,
  selectedPersonId,
  onRequestKeyframe,
  onPersonSelect,
  onWordClick,
  onDescriptionRequest,
}: AnalysisSceneCardProps) {
  const duration = Math.max(0, scene.range.end - scene.range.start);
  const activeSpeaker = scene.speakerTurns.find(turn => playheadTime !== undefined && playheadTime >= turn.start && playheadTime < turn.end);
  const coverage = Object.entries(scene.coverage).filter(([, item]) => item && item.state !== 'complete');
  return (
    <article aria-label={`Scene ${scene.index ?? scene.id}`} className="AnalysisSceneCard">
      <header className="AnalysisSceneCard__header">
        <div>
          <p className="AnalysisSceneCard__eyebrow">{scene.boundarySource === 'scene-block' ? 'Scene' : 'Shot fallback'} {scene.index ?? scene.id}</p>
          <h3>{formatAnalysisSceneTime(scene.range.start)}–{formatAnalysisSceneTime(scene.range.end)} <span>{duration.toFixed(1)}s</span></h3>
        </div>
        {scene.keyframe && (
          <button className="AnalysisSceneCard__keyframe" onClick={() => onRequestKeyframe?.(scene.keyframe!.ref, scene)} type="button">
            Load keyframe
          </button>
        )}
      </header>

      <dl className="AnalysisSceneCard__facts">
        {summaryLabel('Setup', scene.setup)}
        {summaryLabel('Camera', scene.camera)}
        {summaryLabel('Focus', scene.focus)}
        {summaryLabel('Motion', scene.motion)}
        {summaryLabel('Audio', scene.audio)}
      </dl>

      <section aria-label="Visible people" className="AnalysisSceneCard__section">
        <h4>People</h4>
        {scene.people.length === 0 ? <p className="AnalysisSceneCard__muted">No verified people in this range.</p> : (
          <div className="AnalysisSceneCard__chips">
            {scene.people.map(person => <AnalysisPersonChip key={person.id} person={person} selected={person.id === selectedPersonId} speakerState={activeSpeaker?.personId === person.id ? activeSpeaker.state : undefined} onSelect={candidate => onPersonSelect?.(candidate, scene)} />)}
          </div>
        )}
        {activeSpeaker && <p className="AnalysisSceneCard__speaker">{activeSpeaker.state === 'offscreen' ? 'Off-screen speaker' : activeSpeaker.state === 'active' ? 'Active speaker' : 'Speaker mapping unknown'}: {activeSpeaker.speakerLabel}</p>}
      </section>

      {(scene.description || onDescriptionRequest) && <section className="AnalysisSceneCard__section">
        <h4>Description</h4>
        {scene.description ? <><p>{scene.description.text}</p>{scene.description.provenance && <p className="AnalysisSceneCard__muted">Source: {scene.description.provenance}</p>}</> : <button className="AnalysisSceneCard__action" onClick={() => onDescriptionRequest?.(scene)} type="button">Describe this scene</button>}
      </section>}

      {scene.ocr.length > 0 && <section className="AnalysisSceneCard__section"><h4>On-screen text</h4><ul className="AnalysisSceneCard__list">{scene.ocr.map(item => <li key={item.id}><span>{item.text}</span><small>{item.kind ?? 'unknown'} · {formatAnalysisSceneTime(item.start)}–{formatAnalysisSceneTime(item.end)}</small></li>)}</ul></section>}
      {scene.qualityIssues.length > 0 && <section className="AnalysisSceneCard__section"><h4>Quality</h4><ul className="AnalysisSceneCard__list">{scene.qualityIssues.map(issue => <li className={`AnalysisSceneCard__issue AnalysisSceneCard__issue--${issue.severity}`} key={issue.id}><span>{issue.label}</span>{issue.detail && <small>{issue.detail}</small>}</li>)}</ul></section>}
      {coverage.length > 0 && <section aria-label="Analysis coverage" className="AnalysisSceneCard__coverage"><strong>Partial analysis</strong>{coverage.map(([channel, item]) => <span key={channel}>{channel}: {item!.state}{item!.detail ? ` — ${item!.detail}` : ''}</span>)}</section>}

      <AnalysisSceneTranscript sceneRange={scene.range} words={scene.transcript} speakerTurns={scene.speakerTurns} playheadTime={playheadTime} onWordClick={word => onWordClick?.(word, scene)} />
    </article>
  );
}
