import { useMemo, useState, type DragEvent } from 'react';
import type { FacePersonSummary, FrameAnalysisData } from '../../../types';
import { getTimelineFaceIdentityColor } from '../../timeline/utils/timelineFaceRangeOverlay';
import { FaceCropThumbnail, type FaceCropSample } from './FaceCropThumbnail';
import { readFaceDrag, writeFaceDrag } from './faceDragPayload';
import { collectFacePersonSamples, representativeFacePersonSample } from './facePersonSamples';

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
    <div className="properties-section">
      <h4>People ({people.length})</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
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
              onDragOver={(event) => { event.preventDefault(); setDropTargetId(person.id); }}
              onDragLeave={() => setDropTargetId(current => current === person.id ? null : current)}
              onDrop={acceptDrop}
              style={{
                borderRadius: '4px',
                boxShadow: isDropTarget
                  ? `0 0 0 2px ${color.css}`
                  : isExpanded
                    ? `0 0 0 1px ${color.css}aa`
                    : 'none',
                height: '86px',
                width: '86px',
              }}
            >
              <button
                type="button"
                draggable
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Hide' : 'View'} ${person.label} appearances`}
                onDragStart={(event) => writeFaceDrag(event, { kind: 'person', personId: person.id })}
                onClick={() => setExpandedPersonId(current => current === person.id ? null : person.id)}
                title={`${isExpanded ? 'Hide' : 'View'} ${person.label} appearances. Drag onto a person to merge.`}
                style={{
                  appearance: 'none',
                  background: 'transparent',
                  border: 0,
                  cursor: 'grab',
                  height: '86px',
                  padding: 0,
                  position: 'relative',
                  textAlign: 'left',
                  width: '86px',
                }}
              >
                <FaceCropThumbnail file={sourceFile} sample={sampleSet?.representative} size={86} alt={`${person.label} representative face`} />
                <span style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.58), rgba(0,0,0,.08) 48%, rgba(0,0,0,.74))', borderRadius: '4px', display: 'flex', flexDirection: 'column', inset: 0, justifyContent: 'space-between', padding: '5px', position: 'absolute' }}>
                  <span style={{ alignItems: 'center', color: 'white', display: 'flex', fontSize: '10px', fontWeight: 700, gap: '4px' }}>
                    <span style={{ background: color.css, borderRadius: '50%', height: '7px', width: '7px' }} />
                    {person.label}
                  </span>
                  <span style={{ color: 'rgba(255,255,255,.92)', fontSize: '9px', lineHeight: 1.25 }}>
                    {person.sampleCount} sightings<br />{Math.round(person.averageConfidence * 100)}% confidence
                  </span>
                </span>
              </button>
            </div>
          );
        })}
      </div>
      {expandedPerson && (
        <div style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '8px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '7px' }}>
            {expandedPerson.label} appearances
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
            {expandedSamples.map((sample, index) => (
              <button
                key={`${sample.timestamp}:${index}`}
                type="button"
                draggable
                title={`Jump to ${formatTimestamp(sample.timestamp)}. Drag onto a person to move this appearance.`}
                onDragStart={(event) => writeFaceDrag(event, { kind: 'appearance', personId: expandedPerson.id, timestamp: sample.timestamp })}
                onClick={() => onSelectSourceTime(sample.timestamp)}
                style={{ appearance: 'none', background: 'transparent', border: 0, cursor: 'grab', padding: 0, position: 'relative' }}
              >
                <FaceCropThumbnail file={sourceFile} sample={sample} size={68} alt={`${expandedPerson.label} at ${formatTimestamp(sample.timestamp)}`} />
                {recentDrop?.targetPersonId === expandedPerson.id
                  && recentDrop.sample?.timestamp === sample.timestamp && (
                    <span style={{ background: getTimelineFaceIdentityColor(expandedPerson.id).css, borderRadius: '3px', bottom: '3px', color: '#111', fontSize: '8px', fontWeight: 700, left: '3px', padding: '2px 4px', position: 'absolute' }}>
                      Moved here
                    </span>
                  )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
