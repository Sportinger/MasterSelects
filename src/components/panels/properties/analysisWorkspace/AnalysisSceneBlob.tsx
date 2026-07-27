import { useState, type DragEvent, type ReactNode } from 'react';
import type { FaceReviewCandidate } from '../../../../services/faceAnalysis/faceReviewCandidates';
import { readFaceDrag, writeFaceDrag } from '../faceDragPayload';
import { AnalysisPersonChip } from './AnalysisPersonChip';
import { AnalysisSceneTranscript } from './AnalysisSceneTranscript';
import {
  buildAnalysisSceneTranscriptTurns,
  findActiveAnalysisSceneWord,
  formatAnalysisSceneTime,
  type AnalysisScenePerson,
  type AnalysisSceneTranscriptWord,
  type AnalysisSceneView,
} from './analysisSceneViewModel';

export interface AnalysisSceneBlobProps {
  scene: AnalysisSceneView;
  active: boolean;
  expanded: boolean;
  sourceTime: number;
  followPlayback?: boolean;
  selectedPersonId?: string;
  reviewCandidates?: readonly FaceReviewCandidate[];
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
  renderReviewThumbnail?: (candidate: FaceReviewCandidate, scene: AnalysisSceneView) => ReactNode;
  onToggle: () => void;
  onPersonSelect?: (person: AnalysisScenePerson) => void;
  onPersonAppearanceSelect?: (sourceTime: number) => void;
  onMergePeople?: (sourcePersonId: string, targetPersonId: string) => void;
  onMoveAppearance?: (sourcePersonId: string, targetPersonId: string, sourceTime: number) => void;
  onAssignReviewFaces?: (candidateId: string, faceIds: string[], targetPersonId: string) => void;
  onReanalyzeDescription?: (scene: AnalysisSceneView) => void;
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void;
}

function compactTranscript(
  scene: AnalysisSceneView,
  sourceTime: number,
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void,
): ReactNode {
  const turns = buildAnalysisSceneTranscriptTurns(
    scene.range,
    scene.transcript,
    scene.speakerTurns,
  ).slice(0, 2);
  if (turns.length === 0) {
    return <span className="AnalysisSceneBlob__noSpeech">No speech in this scene</span>;
  }
  const activeWord = findActiveAnalysisSceneWord(scene.transcript, sourceTime);
  return turns.map((turn) => (
    <span className="AnalysisSceneBlob__turn" key={turn.id}>
      {turn.words.slice(0, 18).map((word) => (
        <button
          aria-current={word.id === activeWord?.id ? 'true' : undefined}
          aria-label={`Seek word ${word.text}`}
          className={word.id === activeWord?.id ? 'AnalysisSceneBlob__word AnalysisSceneBlob__word--active' : 'AnalysisSceneBlob__word'}
          key={`${word.id}:${word.start}`}
          onClick={() => onWordClick?.(word)}
          title={`${formatAnalysisSceneTime(word.start)}${word.confidence === undefined ? '' : ` · ${Math.round(word.confidence * 100)}% confidence`}${word.needsReview ? ' · needs review' : ''}`}
          type="button"
        >
          {word.text}
        </button>
      ))}
      {turn.words.length > 18 ? '…' : ''}
    </span>
  ));
}

function initials(label: string): string {
  return label.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function personAvatars(
  scene: AnalysisSceneView,
  renderPersonThumbnail: AnalysisSceneBlobProps['renderPersonThumbnail'],
): ReactNode {
  const speakers = scene.speakerTurns.reduce<Array<{
    key: string;
    label: string;
    person?: AnalysisScenePerson;
  }>>((result, turn) => {
    const person = scene.people.find((candidate) => candidate.id === turn.personId);
    const key = person ? `person:${person.id}` : `speaker:${turn.speakerId ?? turn.speakerLabel}`;
    if (!result.some((entry) => entry.key === key)) {
      result.push({ key, label: person?.label ?? turn.speakerLabel, person });
    }
    return result;
  }, []);
  const identities = speakers.length > 0
    ? speakers
    : scene.people.map((person) => ({ key: `person:${person.id}`, label: person.label, person }));
  if (identities.length === 0) {
    return <span className="AnalysisSceneBlob__avatar AnalysisSceneBlob__avatar--empty"><span>–</span></span>;
  }
  return identities.slice(0, 3).map(({ key, label, person }) => (
    <span
      className={`AnalysisSceneBlob__avatar${person ? '' : ' AnalysisSceneBlob__avatar--speaker'}`}
      title={label}
      key={key}
    >
      {person
        ? renderPersonThumbnail?.(person, scene) ?? <span>{initials(label)}</span>
        : <span>{initials(label)}</span>}
    </span>
  ));
}

function facts(scene: AnalysisSceneView) {
  return [
    ['Focus', scene.focus],
    ['Motion', scene.motion],
    ['Setup', scene.setup],
    ['Camera', scene.camera],
    ['Audio', scene.audio],
  ].filter((item): item is [string, NonNullable<typeof scene.focus>] => Boolean(item[1]));
}

function personSpeakerState(scene: AnalysisSceneView, personId: string) {
  return scene.speakerTurns.find((turn) => turn.personId === personId)?.state;
}

export function AnalysisSceneBlob({
  scene,
  active,
  expanded,
  sourceTime,
  followPlayback = false,
  selectedPersonId,
  reviewCandidates = [],
  renderPersonThumbnail,
  renderReviewThumbnail,
  onToggle,
  onPersonSelect,
  onPersonAppearanceSelect,
  onMergePeople,
  onMoveAppearance,
  onAssignReviewFaces,
  onReanalyzeDescription,
  onWordClick,
}: AnalysisSceneBlobProps) {
  const [dropTargetId, setDropTargetId] = useState<string>();
  const duration = Math.max(0, scene.range.end - scene.range.start);
  const incompleteCoverage = Object.entries(scene.coverage)
    .filter(([, item]) => item && item.state !== 'complete');

  const dropOnPerson = (event: DragEvent, targetPersonId: string) => {
    event.preventDefault();
    setDropTargetId(undefined);
    const payload = readFaceDrag(event);
    if (!payload || ('personId' in payload && payload.personId === targetPersonId)) return;
    if (payload.kind === 'person') onMergePeople?.(payload.personId, targetPersonId);
    else if (payload.kind === 'appearance') {
      onMoveAppearance?.(payload.personId, targetPersonId, payload.timestamp);
    } else {
      onAssignReviewFaces?.(payload.candidateId, payload.faceIds, targetPersonId);
    }
  };

  return (
    <article
      className={[
        'AnalysisSceneBlob',
        active ? 'AnalysisSceneBlob--active' : '',
        expanded ? 'AnalysisSceneBlob--expanded' : '',
      ].filter(Boolean).join(' ')}
      aria-label={`Scene ${scene.index ?? scene.id}`}
    >
      <div className="AnalysisSceneBlob__summary">
        <span className="AnalysisSceneBlob__avatars" aria-label="People and speakers">
          {personAvatars(scene, renderPersonThumbnail)}
        </span>
        <span className="AnalysisSceneBlob__speech">
          <small>Scene {scene.index ?? '–'} · {scene.boundarySource === 'scene-block' ? 'described scene' : 'shot'}</small>
          {compactTranscript(scene, sourceTime, onWordClick)}
        </span>
        <button
          type="button"
          className="AnalysisSceneBlob__time AnalysisSceneBlob__summaryToggle"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <strong>{formatAnalysisSceneTime(scene.range.start)}–{formatAnalysisSceneTime(scene.range.end)}</strong>
          <small>{duration.toFixed(1)}s · {expanded ? 'Hide' : 'Details'}</small>
        </button>
      </div>

      {expanded && (
        <div className="AnalysisSceneBlob__details">
          {scene.people.length > 0 && (
            <section className="AnalysisSceneBlob__identity" aria-label="People in this scene">
              <header>People <small>Click to filter; drag identities or appearances to correct grouping</small></header>
              <div className="AnalysisSceneBlob__people">
                {scene.people.map((person) => (
                  <div
                    className={`AnalysisSceneBlob__person${dropTargetId === person.id ? ' AnalysisSceneBlob__person--drop' : ''}`}
                    draggable
                    key={person.id}
                    onDragStart={(event) => writeFaceDrag(event, { kind: 'person', personId: person.id })}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDropTargetId(person.id);
                    }}
                    onDragLeave={() => setDropTargetId((current) => current === person.id ? undefined : current)}
                    onDrop={(event) => dropOnPerson(event, person.id)}
                  >
                    <AnalysisPersonChip
                      person={person}
                      selected={person.id === selectedPersonId}
                      speakerState={personSpeakerState(scene, person.id)}
                      onSelect={onPersonSelect}
                    />
                    <div className="AnalysisSceneBlob__appearances" aria-label={`${person.label} appearances`}>
                      {(person.appearances ?? (person.presence ? [person.presence] : [])).slice(0, 6).map((appearance, index) => (
                        <button
                          type="button"
                          draggable
                          className="AnalysisSceneBlob__appearance"
                          key={`${appearance.start}:${appearance.end}:${index}`}
                          title={`Jump to ${formatAnalysisSceneTime(appearance.start)}. Drag onto another person to move.`}
                          onClick={() => onPersonAppearanceSelect?.(appearance.start)}
                          onDragStart={(event) => {
                            event.stopPropagation();
                            writeFaceDrag(event, {
                              kind: 'appearance',
                              personId: person.id,
                              timestamp: appearance.start,
                            });
                          }}
                        >
                          {renderPersonThumbnail?.(person, scene, appearance.start)}
                          <span>{formatAnalysisSceneTime(appearance.start)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {reviewCandidates.length > 0 && (
            <section className="AnalysisSceneBlob__review" aria-label="Faces needing review">
              <header>Needs review <small>Drag a detection onto a person</small></header>
              <div>
                {reviewCandidates.map((candidate, index) => (
                  <button
                    type="button"
                    draggable
                    className="AnalysisSceneBlob__reviewFace"
                    key={candidate.id}
                    title={`Review detection at ${formatAnalysisSceneTime(candidate.sample.timestamp)}`}
                    onClick={() => onPersonAppearanceSelect?.(candidate.sample.timestamp)}
                    onDragStart={(event) => writeFaceDrag(event, {
                      kind: 'review',
                      candidateId: candidate.id,
                      faceIds: candidate.faceIds,
                      sample: candidate.sample,
                    })}
                  >
                    {renderReviewThumbnail?.(candidate, scene)}
                    <span>Review {index + 1} · {candidate.observationCount} frame{candidate.observationCount === 1 ? '' : 's'}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {facts(scene).length > 0 && (
            <dl className="AnalysisSceneBlob__facts">
              {facts(scene).map(([label, value]) => (
                <div key={label}><dt>{label}</dt><dd>{value.label}{value.detail ? ` · ${value.detail}` : ''}</dd></div>
              ))}
            </dl>
          )}

          {scene.description && (
            <section className="AnalysisSceneBlob__description">
              <header>
                <span>Description{scene.description.provenance ? ` · ${scene.description.provenance}` : ''}</span>
                {onReanalyzeDescription && (
                  <button type="button" onClick={() => onReanalyzeDescription(scene)}>Reanalyze</button>
                )}
              </header>
              <p>{scene.description.text}</p>
            </section>
          )}

          {scene.ocr.length > 0 && (
            <section className="AnalysisSceneBlob__ocr">
              <header>On-screen text</header>
              <p>{scene.ocr.map((item) => item.text).join(' · ')}</p>
            </section>
          )}

          {(scene.qualityIssues.length > 0 || incompleteCoverage.length > 0) && (
            <div className="AnalysisSceneBlob__notices">
              {scene.qualityIssues.slice(0, 3).map((issue) => (
                <span key={issue.id}><strong>{issue.label}</strong>{issue.detail ? ` · ${issue.detail}` : ''}</span>
              ))}
              {incompleteCoverage.slice(0, 5).map(([channel, item]) => (
                <span key={channel}><strong>{channel}</strong> · {item!.state}{item!.detail ? ` · ${item!.detail}` : ''}</span>
              ))}
            </div>
          )}

          <AnalysisSceneTranscript
            sceneRange={scene.range}
            words={scene.transcript}
            speakerTurns={scene.speakerTurns}
            playheadTime={sourceTime}
            followPlayback={followPlayback}
            maxTurns={6}
            maxWordsPerTurn={80}
            onWordClick={onWordClick}
          />
        </div>
      )}
    </article>
  );
}
