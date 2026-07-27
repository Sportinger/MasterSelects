import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { FaceReviewCandidate } from '../../../../services/faceAnalysis/faceReviewCandidates';
import type { FacePersonSummary, FrameAnalysisData } from '../../../../types/clipMetadata';
import { FacePeopleSummary } from '../FacePeopleSummary';
import { FaceReviewSummary } from '../FaceReviewSummary';
import { AnalysisOverviewTimeline } from './AnalysisOverviewTimeline';
import { AnalysisSceneList } from './AnalysisSceneList';
import { filterAnalysisScenes } from './analysisSceneListModel';
import {
  formatAnalysisSceneTime,
  type AnalysisScenePerson,
  type AnalysisSceneView,
} from './analysisSceneViewModel';
import type { AnalysisWorkspaceViewModel } from './analysisWorkspaceAdapter';
import './AnalysisWorkspace.css';

export interface AnalysisWorkspaceCurrentFrame {
  sourceTime: number;
  focus: number;
  motion: number;
  faceCount: number;
}

export interface AnalysisWorkspaceSummary {
  frameCount?: number;
  averageFocus?: number;
  peakFocus?: number;
  averageMotion?: number;
  peakMotion?: number;
  totalFaces?: number;
  groupedPeople: number;
  cutCount?: number;
  totalSourceCuts?: number;
  cutStatusText?: string;
  transcriptWords: number;
  describedScenes: number;
}

export interface AnalysisWorkspaceProps {
  model: AnalysisWorkspaceViewModel;
  sourceTime: number;
  currentFrame?: AnalysisWorkspaceCurrentFrame;
  summary?: AnalysisWorkspaceSummary;
  reviewCandidates?: readonly FaceReviewCandidate[];
  facePeople?: readonly FacePersonSummary[];
  faceFrames?: readonly FrameAnalysisData[];
  faceSourceFile?: File;
  transcriptSearchQuery?: string;
  transcriptControls?: ReactNode;
  onTranscriptSearchChange?: (query: string) => void;
  isFollowingPlayback?: boolean;
  onSeekSourceTime: (sourceTime: number) => void;
  onPersonSelect?: (person: AnalysisScenePerson) => void;
  onMergePeople?: (sourcePersonId: string, targetPersonId: string) => void;
  onMoveAppearance?: (sourcePersonId: string, targetPersonId: string, sourceTime: number) => void;
  onAssignReviewFaces?: (candidateId: string, faceIds: string[], targetPersonId: string) => void;
  onReanalyzeDescription?: (scene: AnalysisSceneView) => void;
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
  renderReviewThumbnail?: (
    candidate: FaceReviewCandidate,
    scene: AnalysisSceneView,
  ) => ReactNode;
}

function findSceneIndex(model: AnalysisWorkspaceViewModel, sourceTime: number): number {
  return model.scenes.findIndex(
    (scene) => sourceTime >= scene.range.start && sourceTime < scene.range.end,
  );
}

function percent(value: number): string {
  return `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`;
}

function nextPersonAppearance(
  scenes: readonly AnalysisSceneView[],
  personId: string,
  sourceTime: number,
): number | undefined {
  const starts = scenes.flatMap((scene) => scene.people
    .filter((person) => person.id === personId)
    .flatMap((person) => (person.appearances ?? (person.presence ? [person.presence] : []))
      .map((appearance) => appearance.start)))
    .filter(Number.isFinite)
    .toSorted((left, right) => left - right);
  return starts.find((start) => start > sourceTime + 0.001) ?? starts[0];
}

export function AnalysisWorkspace({
  model,
  sourceTime,
  currentFrame,
  summary,
  reviewCandidates = [],
  facePeople = [],
  faceFrames = [],
  faceSourceFile,
  transcriptSearchQuery,
  transcriptControls,
  onTranscriptSearchChange,
  isFollowingPlayback = false,
  onSeekSourceTime,
  onPersonSelect,
  onMergePeople,
  onMoveAppearance,
  onAssignReviewFaces,
  onReanalyzeDescription,
  renderPersonThumbnail,
  renderReviewThumbnail,
}: AnalysisWorkspaceProps) {
  const activeSceneIndex = useMemo(
    () => findSceneIndex(model, sourceTime),
    [model, sourceTime],
  );
  const [localSceneQuery, setLocalSceneQuery] = useState('');
  const sceneQuery = transcriptSearchQuery ?? localSceneQuery;
  const setSceneQuery = onTranscriptSearchChange ?? setLocalSceneQuery;
  const [selectedPersonId, setSelectedPersonId] = useState<string>();
  const personScenes = useMemo(
    () => selectedPersonId
      ? model.scenes.filter((scene) => scene.people.some((person) => person.id === selectedPersonId))
      : model.scenes,
    [model.scenes, selectedPersonId],
  );
  const matchingSceneCount = useMemo(
    () => filterAnalysisScenes(personScenes, sceneQuery).length,
    [personScenes, sceneQuery],
  );
  const selectedScene = activeSceneIndex >= 0
    ? model.scenes[activeSceneIndex]
    : model.scenes[0];

  const selectScene = useCallback((sceneId: string) => {
    const scene = model.scenes.find((candidate) => candidate.id === sceneId);
    if (scene) onSeekSourceTime(scene.range.start);
  }, [model.scenes, onSeekSourceTime]);

  const selectPerson = useCallback((person: AnalysisScenePerson) => {
    setSelectedPersonId((current) => current === person.id ? undefined : person.id);
    if (selectedPersonId !== person.id) {
      const next = nextPersonAppearance(model.scenes, person.id, sourceTime - 0.002);
      if (next !== undefined) onSeekSourceTime(next);
    }
    onPersonSelect?.(person);
  }, [model.scenes, onPersonSelect, onSeekSourceTime, selectedPersonId, sourceTime]);

  const seekNextAppearance = useCallback(() => {
    if (!selectedPersonId) return;
    const next = nextPersonAppearance(model.scenes, selectedPersonId, sourceTime);
    if (next !== undefined) onSeekSourceTime(next);
  }, [model.scenes, onSeekSourceTime, selectedPersonId, sourceTime]);

  return (
    <section className="AnalysisWorkspace" aria-label="Clip analysis workspace">
      {transcriptControls}
      <AnalysisOverviewTimeline
        analysis={model.overview}
        playheadTime={sourceTime}
        selectedSceneId={selectedScene?.id}
        onPlayheadChange={onSeekSourceTime}
        onSceneClick={(event) => selectScene(event.id)}
      />

      {(currentFrame || summary) && (
        <section className="AnalysisWorkspace__inspector" aria-label="Analysis at playhead and clip summary">
          {currentFrame && (
            <div className="AnalysisWorkspace__now">
              <span className="AnalysisWorkspace__nowLabel">
                Now <strong>{formatAnalysisSceneTime(currentFrame.sourceTime)}</strong>
              </span>
              <span>Focus <b>{percent(currentFrame.focus)}</b></span>
              <span>Motion <b>{percent(currentFrame.motion)}</b></span>
              <span>Faces <b>{currentFrame.faceCount}</b></span>
            </div>
          )}
          {summary && (
            <dl className="AnalysisWorkspace__summary">
              {summary.frameCount !== undefined && <div><dt>Frames:</dt><dd>{summary.frameCount}</dd></div>}
              {summary.cutStatusText !== undefined && (
                <div>
                  <dt>Cuts:</dt>
                  <dd title={summary.totalSourceCuts === undefined ? undefined : `${summary.totalSourceCuts} in source`}>
                    {summary.cutStatusText}
                  </dd>
                </div>
              )}
              <div><dt>People:</dt><dd>{summary.groupedPeople}</dd></div>
              <div><dt>Words:</dt><dd>{summary.transcriptWords}</dd></div>
              <div><dt>Descriptions:</dt><dd>{summary.describedScenes}</dd></div>
              {summary.averageFocus !== undefined && (
                <div><dt>Focus avg/peak:</dt><dd>{summary.averageFocus}% / {summary.peakFocus}%</dd></div>
              )}
              {summary.averageMotion !== undefined && (
                <div><dt>Motion avg/peak:</dt><dd>{summary.averageMotion}% / {summary.peakMotion}%</dd></div>
              )}
              {summary.totalFaces !== undefined && <div><dt>Face sightings:</dt><dd>{summary.totalFaces}</dd></div>}
            </dl>
          )}
        </section>
      )}

      {selectedScene ? (
        <div className="AnalysisWorkspace__scene">
          <div className="AnalysisWorkspace__sceneSearch">
            <label htmlFor="analysis-scene-search">Scenes</label>
            <input
              id="analysis-scene-search"
              type="search"
              value={sceneQuery}
              placeholder="Search text, speaker, person…"
              onChange={(event) => setSceneQuery(event.target.value)}
            />
            <span>{matchingSceneCount}/{model.scenes.length}</span>
          </div>
          {selectedPersonId && (
            <div className="AnalysisWorkspace__personFilter" role="status">
              <span>Person filter active</span>
              <button type="button" onClick={seekNextAppearance}>Next appearance</button>
              <button type="button" onClick={() => setSelectedPersonId(undefined)}>Clear</button>
            </div>
          )}
          <AnalysisSceneList
            scenes={personScenes}
            selectedSceneId={selectedScene.id}
            selectedPersonId={selectedPersonId}
            query={sceneQuery}
            sourceTime={sourceTime}
            followPlayback={isFollowingPlayback}
            reviewCandidates={reviewCandidates}
            renderPersonThumbnail={renderPersonThumbnail}
            renderReviewThumbnail={renderReviewThumbnail}
            onSceneSelect={(scene) => selectScene(scene.id)}
            onPersonSelect={selectPerson}
            onPersonAppearanceSelect={onSeekSourceTime}
            onMergePeople={onMergePeople}
            onMoveAppearance={onMoveAppearance}
            onAssignReviewFaces={onAssignReviewFaces}
            onReanalyzeDescription={onReanalyzeDescription}
            onWordClick={(word) => onSeekSourceTime(word.start)}
          />
          {facePeople.length > 0 && onMergePeople && onMoveAppearance && onAssignReviewFaces && (
            <FacePeopleSummary
              people={facePeople}
              frames={faceFrames}
              sourceFile={faceSourceFile}
              onSelectSourceTime={onSeekSourceTime}
              onMergePeople={onMergePeople}
              onMoveAppearance={onMoveAppearance}
              onAssignReviewFaces={onAssignReviewFaces}
            />
          )}
          {reviewCandidates.length > 0 && (
            <FaceReviewSummary
              candidates={reviewCandidates}
              frames={faceFrames}
              sourceFile={faceSourceFile}
              onSelectSourceTime={onSeekSourceTime}
            />
          )}
        </div>
      ) : (
        <p className="AnalysisWorkspace__empty">
          Run an analysis above to build the first scene.
        </p>
      )}
    </section>
  );
}
