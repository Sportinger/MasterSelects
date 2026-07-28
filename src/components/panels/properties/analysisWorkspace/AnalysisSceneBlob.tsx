import { Fragment, type ReactNode } from 'react';
import {
  findActiveAnalysisSceneWord,
  formatAnalysisSceneTime,
  type AnalysisScenePerson,
  type AnalysisSceneSpeechMarker,
  type AnalysisSceneTranscriptWord,
  type AnalysisSceneView,
} from './analysisSceneViewModel';
import type { AnalysisTranscriptChunk } from './analysisTranscriptChunks';
import {
  AnalysisSceneSparkline,
  type AnalysisSceneSparklineCurve,
} from './AnalysisSceneSparkline';

export interface AnalysisSceneBlobProps {
  scene: AnalysisSceneView;
  transcriptChunk: AnalysisTranscriptChunk;
  markers?: readonly AnalysisSceneSpeechMarker[];
  energyCurve?: AnalysisSceneSparklineCurve;
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
  markers: readonly AnalysisSceneSpeechMarker[],
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void,
): ReactNode {
  if (transcriptChunk.words.length === 0) {
    return <span className="AnalysisSceneBlob__noSpeech">No speech in this scene</span>;
  }
  const activeWord = findActiveAnalysisSceneWord(transcriptChunk.words, sourceTime);
  const fillerWordIds = new Set(markers
    .filter(marker => marker.kind === 'filler')
    .flatMap(marker => marker.wordIds ?? []));
  return (
    <span className="AnalysisSceneBlob__turn">
      {transcriptChunk.words.map((word, index) => {
        const previous = transcriptChunk.words[index - 1];
        const breath = previous && markers.find(marker => (
          marker.kind === 'breath'
          && marker.start < word.start
          && previous.end < marker.end
        ));
        const classNames = ['AnalysisSceneBlob__word'];
        if (word === activeWord) classNames.push('AnalysisSceneBlob__word--active');
        if (fillerWordIds.has(word.id)) classNames.push('AnalysisSceneBlob__word--filler');
        if (Number.isFinite(word.emphasis) && (word.emphasis as number) >= 0.7) {
          classNames.push('AnalysisSceneBlob__word--emphasis');
        }
        const confidence = breath?.confidence;
        const breathTitle = confidence === undefined
          ? 'Breath'
          : `Breath (${Math.round(confidence * 100)}% confidence)`;
        return (
          <Fragment key={`${word.id}:${word.start}:${word.end}:${index}`}>
            {breath && (
              <span
                aria-label="Breath marker"
                className="analysis-scene-blob__marker--breath"
                title={breathTitle}
              >~</span>
            )}
            <button
              aria-current={word === activeWord ? 'true' : undefined}
              aria-label={`Seek word ${word.text}`}
              className={classNames.join(' ')}
              onClick={() => onWordClick?.(word)}
              title={formatAnalysisSceneTime(word.start)}
              type="button"
            >
              {word.text}
            </button>
          </Fragment>
        );
      })}
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
  markers = [],
  energyCurve,
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
        <span className={`AnalysisSceneBlob__speech${energyCurve ? ' AnalysisSceneBlob__speech--withSparkline' : ''}`}>
          <button
            type="button"
            className="AnalysisSceneBlob__segmentSeek"
            aria-label={seekLabel}
            onClick={onChunkSelect}
            title={`${formatAnalysisSceneTime(transcriptChunk.start)}–${formatAnalysisSceneTime(transcriptChunk.end)} · ${duration.toFixed(1)}s`}
          >
            Scene {scene.index ?? '–'} · {scene.boundarySource === 'scene-block' ? 'described scene' : 'shot'}
            {hasMultipleParts ? ` · speech ${transcriptChunk.partIndex}/${transcriptChunk.partCount}` : ''}
          </button>
          {compactTranscript(transcriptChunk, sourceTime, markers, onWordClick)}
          {energyCurve && (
            <AnalysisSceneSparkline
              curve={energyCurve}
              start={transcriptChunk.start}
              end={transcriptChunk.end}
            />
          )}
        </span>
      </div>
    </article>
  );
}
