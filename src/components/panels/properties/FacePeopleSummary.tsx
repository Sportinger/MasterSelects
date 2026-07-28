import { useMemo, useState, type CSSProperties, type DragEvent } from 'react';
import type { FacePersonSummary, FrameAnalysisData } from '../../../types/clipMetadata';
import { getTimelineFaceIdentityColor } from '../../timeline/utils/timelineFaceRangeOverlay';
import { FaceCropThumbnail, type FaceCropSample } from './FaceCropThumbnail';
import { readFaceDrag, writeFaceDrag } from './faceDragPayload';
import { collectFacePersonSamples, representativeFacePersonSample } from './facePersonSamples';
import './FacePeopleSummary.css';

interface FacePeopleSummaryProps {
  people: readonly FacePersonSummary[];
  frames: readonly FrameAnalysisData[];
  sourceFile?: File;
  onSelectSourceTime: (sourceTime: number) => void;
  onMergePeople: (sourcePersonId: string, targetPersonId: string) => void;
  onMoveAppearance: (sourcePersonId: string, targetPersonId: string, sourceTime: number) => void;
  onAssignReviewFaces: (candidateId: string, faceIds: string[], targetPersonId: string) => void;
}

interface RecentFaceDrop {
  targetPersonId: string;
  sample?: FaceCropSample;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function FacePeopleSummary({
  people,
  frames,
  sourceFile,
  onSelectSourceTime,
  onMergePeople,
  onMoveAppearance,
  onAssignReviewFaces,
}: FacePeopleSummaryProps) {
  const [expandedPersonId, setExpandedPersonId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [recentDrop, setRecentDrop] = useState<RecentFaceDrop | null>(null);
  const personSamples = useMemo(() => new Map(people.map(person => {
    const samples = collectFacePersonSamples(frames, person);
    return [person.id, { samples, representative: representativeFacePersonSample(samples) }];
  })), [frames, people]);

  const expandedPerson = people.find(person => person.id === expandedPersonId);
  const expandedSampleSet = expandedPerson ? personSamples.get(expandedPerson.id) : undefined;
  const baseExpandedSamples = expandedSampleSet?.samples ?? [];
  const recentExpandedSample = recentDrop && expandedPerson
    && recentDrop.targetPersonId === expandedPerson.id
    ? recentDrop.sample
    : undefined;
  const expandedSamples = recentExpandedSample && !baseExpandedSamples.some(sample => (
    sample.timestamp === recentExpandedSample.timestamp
    && sample.box.x === recentExpandedSample.box.x
    && sample.box.y === recentExpandedSample.box.y
  ))
    ? [...baseExpandedSamples, recentExpandedSample].toSorted((a, b) => a.timestamp - b.timestamp)
    : baseExpandedSamples;

  if (people.length === 0) return null;

  return (
    <section className="FacePeopleSummary" aria-label="Detected people and face corrections">
      <header className="FacePeopleSummary__header">
        <h4>People ({people.length})</h4>
        <span>Drag person to merge; drag an appearance or review face to reassign.</span>
      </header>
      <div className="FacePeopleSummary__grid">
        {people.map((person) => {
          const color = getTimelineFaceIdentityColor(person.id);
          const sampleSet = personSamples.get(person.id);
          const isExpanded = expandedPersonId === person.id;
          const isDropTarget = dropTargetId === person.id;
          const acceptDrop = (event: DragEvent) => {
            event.preventDefault();
            const payload = readFaceDrag(event);
            setDropTargetId(null);
            if (!payload || ('personId' in payload && payload.personId === person.id)) return;
            const sourceSamples = 'personId' in payload
              ? personSamples.get(payload.personId)
              : undefined;
            const droppedSample = payload.kind === 'review'
              ? payload.sample
              : payload.kind === 'appearance'
              ? sourceSamples?.samples.reduce<FaceCropSample | undefined>((closest, sample) => (
                  !closest || Math.abs(sample.timestamp - payload.timestamp) < Math.abs(closest.timestamp - payload.timestamp)
                    ? sample
                    : closest
                ), undefined)
              : sourceSamples?.representative;
            setRecentDrop({ targetPersonId: person.id, sample: droppedSample });
            setExpandedPersonId(person.id);
            if (payload.kind === 'person') onMergePeople(payload.personId, person.id);
            else if (payload.kind === 'appearance') {
              onMoveAppearance(payload.personId, person.id, payload.timestamp);
            } else {
              onAssignReviewFaces(payload.candidateId, payload.faceIds, person.id);
            }
          };
          return (
            <div
              key={person.id}
              className={`FacePeopleSummary__person${isDropTarget ? ' FacePeopleSummary__person--drop' : ''}${isExpanded ? ' FacePeopleSummary__person--expanded' : ''}`}
              onDragOver={(event) => { event.preventDefault(); setDropTargetId(person.id); }}
              onDragLeave={() => setDropTargetId(current => current === person.id ? null : current)}
              onDrop={acceptDrop}
              style={{ '--face-color': color.css } as CSSProperties}
            >
              <button
                type="button"
                draggable
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Hide' : 'View'} ${person.label} appearances`}
                onDragStart={(event) => writeFaceDrag(event, { kind: 'person', personId: person.id })}
                onClick={() => setExpandedPersonId(current => current === person.id ? null : person.id)}
                title={`${isExpanded ? 'Hide' : 'View'} ${person.label} appearances. Drag onto a person to merge.`}
                className="FacePeopleSummary__personButton"
              >
                <FaceCropThumbnail file={sourceFile} sample={sampleSet?.representative} size={86} alt={`${person.label} representative face`} />
                <span className="FacePeopleSummary__personMeta">
                  <span className="FacePeopleSummary__personName">
                    <span className="FacePeopleSummary__personDot" />
                    {person.label}
                  </span>
                  <span className="FacePeopleSummary__personStats">
                    {person.sampleCount} sightings<br />{Math.round(person.averageConfidence * 100)}% confidence
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {expandedPerson && (
        <div className="FacePeopleSummary__appearancesPanel">
          <div className="FacePeopleSummary__appearancesLabel">
            {expandedPerson.label} appearances
          </div>
          <div className="FacePeopleSummary__appearances">
            {expandedSamples.map((sample, index) => (
              <button
                key={`${sample.timestamp}:${index}`}
                type="button"
                draggable
                title={`Jump to ${formatTimestamp(sample.timestamp)}. Drag onto a person to move this appearance.`}
                onDragStart={(event) => writeFaceDrag(event, { kind: 'appearance', personId: expandedPerson.id, timestamp: sample.timestamp })}
                onClick={() => onSelectSourceTime(sample.timestamp)}
                className="FacePeopleSummary__appearance"
              >
                <FaceCropThumbnail file={sourceFile} sample={sample} size={68} alt={`${expandedPerson.label} at ${formatTimestamp(sample.timestamp)}`} />
                {recentDrop?.targetPersonId === expandedPerson.id
                  && recentDrop.sample?.timestamp === sample.timestamp && (
                    <span className="FacePeopleSummary__moved">
                      Moved here
                    </span>
                  )}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
