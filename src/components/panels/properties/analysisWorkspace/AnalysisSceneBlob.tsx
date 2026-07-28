import type { ReactNode } from 'react';
import {
  findActiveAnalysisSceneWord,
  formatAnalysisSceneTime,
  type AnalysisScenePerson,
  type AnalysisSceneTranscriptWord,
  type AnalysisSceneView,
} from './analysisSceneViewModel';
import type { AnalysisTranscriptChunk } from './analysisTranscriptChunks';

export interface AnalysisSceneBlobProps {
  scene: AnalysisSceneView;
  transcriptChunk: AnalysisTranscriptChunk;
  active: boolean;
  sourceTime: number;
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
  onChunkSelect: () => void;
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void;
}

function compactTranscript(
  transcriptChunk: AnalysisTranscriptChunk,
  sourceTime: number,
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void,
): ReactNode {
  if (transcriptChunk.words.length === 0) {
    return <span className="AnalysisSceneBlob__noSpeech">No speech in this scene</span>;
  }
  const activeWord = findActiveAnalysisSceneWord(transcriptChunk.words, sourceTime);
  return (
    <span className="AnalysisSceneBlob__turn">
      {transcriptChunk.words.map((word, index) => (
        <button
          aria-current={word === activeWord ? 'true' : undefined}
          aria-label={`Seek word ${word.text}`}
          className={word === activeWord ? 'AnalysisSceneBlob__word AnalysisSceneBlob__word--active' : 'AnalysisSceneBlob__word'}
          key={`${word.id}:${word.start}:${word.end}:${index}`}
          onClick={() => onWordClick?.(word)}
          title={formatAnalysisSceneTime(word.start)}
          type="button"
        >
          {word.text}
        </button>
      ))}
    </span>
  );
}

function initials(label: string): string {
  return label.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '?';
}

function speakerCode(label: string): string {
  const normalized = label.trim();
  const compact = normalized.match(/^s(?:peaker)?\s*(\d+)$/i);
  return compact ? `S${compact[1]}` : initials(normalized);
}

function identitySummary(
  scene: AnalysisSceneView,
  transcriptChunk: AnalysisTranscriptChunk,
  renderPersonThumbnail: AnalysisSceneBlobProps['renderPersonThumbnail'],
): ReactNode {
  const speaker = transcriptChunk.speakerLabel
    ? {
      key: transcriptChunk.speakerId ?? transcriptChunk.speakerLabel,
      label: transcriptChunk.speakerLabel,
    }
    : undefined;
  return (
    <span className="AnalysisSceneBlob__identitySummary">
      <span className="AnalysisSceneBlob__avatars" aria-label="People visible in scene">
        {scene.people.length > 0
          ? scene.people.slice(0, 2).map((person) => (
            <span className="AnalysisSceneBlob__avatar" title={person.label} key={person.id}>
              {renderPersonThumbnail?.(person, scene) ?? <span>{initials(person.label)}</span>}
            </span>
          ))
          : <span className="AnalysisSceneBlob__avatar AnalysisSceneBlob__avatar--empty"><span>–</span></span>}
      </span>
      {speaker && (
        <span className="AnalysisSceneBlob__speakerCodes" aria-label="Transcript speakers">
          <span key={speaker.key} title={speaker.label}>{speakerCode(speaker.label)}</span>
        </span>
      )}
    </span>
  );
}

export function AnalysisSceneBlob({
  scene,
  transcriptChunk,
  active,
  sourceTime,
  renderPersonThumbnail,
  onChunkSelect,
  onWordClick,
}: AnalysisSceneBlobProps) {
  const duration = Math.max(0, transcriptChunk.end - transcriptChunk.start);
  const sceneLabel = scene.index ?? scene.id;
  const hasMultipleParts = transcriptChunk.partCount > 1;
  const articleLabel = hasMultipleParts
    ? `Scene ${sceneLabel}, speech segment ${transcriptChunk.partIndex} of ${transcriptChunk.partCount}`
    : `Scene ${sceneLabel}`;
  const seekLabel = transcriptChunk.fallback
    ? `Seek to scene ${sceneLabel}`
    : `Seek to speech segment ${transcriptChunk.partIndex} in scene ${sceneLabel}`;
  return (
    <article
      className={`AnalysisSceneBlob${active ? ' AnalysisSceneBlob--active' : ''}`}
      aria-label={articleLabel}
    >
      <div className="AnalysisSceneBlob__summary">
        {identitySummary(scene, transcriptChunk, renderPersonThumbnail)}
        <span className="AnalysisSceneBlob__speech">
          <small>
            Scene {scene.index ?? '–'} · {scene.boundarySource === 'scene-block' ? 'described scene' : 'shot'}
            {hasMultipleParts ? ` · speech ${transcriptChunk.partIndex}/${transcriptChunk.partCount}` : ''}
          </small>
          {compactTranscript(transcriptChunk, sourceTime, onWordClick)}
        </span>
        <button
          type="button"
          className="AnalysisSceneBlob__time AnalysisSceneBlob__summarySeek"
          aria-label={seekLabel}
          onClick={onChunkSelect}
        >
          <strong>{formatAnalysisSceneTime(transcriptChunk.start)}–{formatAnalysisSceneTime(transcriptChunk.end)}</strong>
          <small>{duration.toFixed(1)}s</small>
        </button>
      </div>
    </article>
  );
}
