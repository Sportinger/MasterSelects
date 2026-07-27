import { useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from 'react';
import type { FaceReviewCandidate } from '../../../../services/faceAnalysis/faceReviewCandidates';
import { AnalysisSceneBlob } from './AnalysisSceneBlob';
import type {
  AnalysisScenePerson,
  AnalysisSceneTranscriptWord,
  AnalysisSceneView,
} from './analysisSceneViewModel';
import {
  buildAnalysisSceneLayout,
  filterAnalysisScenes,
  getAnalysisSceneWindow,
} from './analysisSceneListModel';

export interface AnalysisSceneListProps {
  scenes: readonly AnalysisSceneView[];
  selectedSceneId?: string;
  selectedPersonId?: string;
  query?: string;
  sourceTime: number;
  /** Playback follows the active scene only when the host says follow is active. */
  followPlayback?: boolean;
  reviewCandidates?: readonly FaceReviewCandidate[];
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
  renderReviewThumbnail?: (candidate: FaceReviewCandidate, scene: AnalysisSceneView) => ReactNode;
  onSceneSelect: (scene: AnalysisSceneView) => void;
  onPersonSelect?: (person: AnalysisScenePerson) => void;
  onPersonAppearanceSelect?: (sourceTime: number) => void;
  onMergePeople?: (sourcePersonId: string, targetPersonId: string) => void;
  onMoveAppearance?: (sourcePersonId: string, targetPersonId: string, sourceTime: number) => void;
  onAssignReviewFaces?: (candidateId: string, faceIds: string[], targetPersonId: string) => void;
  onReanalyzeDescription?: (scene: AnalysisSceneView) => void;
  onWordClick?: (word: AnalysisSceneTranscriptWord) => void;
}

export function AnalysisSceneList({
  scenes,
  selectedSceneId,
  selectedPersonId,
  query = '',
  sourceTime,
  followPlayback = false,
  reviewCandidates = [],
  renderPersonThumbnail,
  renderReviewThumbnail,
  onSceneSelect,
  onPersonSelect,
  onPersonAppearanceSelect,
  onMergePeople,
  onMoveAppearance,
  onAssignReviewFaces,
  onReanalyzeDescription,
  onWordClick,
}: AnalysisSceneListProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [expandedSceneId, setExpandedSceneId] = useState<string>();
  const filteredScenes = useMemo(
    () => filterAnalysisScenes(scenes, query),
    [query, scenes],
  );
  const layout = useMemo(
    () => buildAnalysisSceneLayout(filteredScenes, expandedSceneId),
    [expandedSceneId, filteredScenes],
  );
  const window = getAnalysisSceneWindow(layout, scrollTop);

  useEffect(() => {
    if (followPlayback && selectedSceneId) setExpandedSceneId(selectedSceneId);
  }, [followPlayback, selectedSceneId]);

  useEffect(() => {
    if (!followPlayback) return;
    const selectedIndex = filteredScenes.findIndex((scene) => scene.id === selectedSceneId);
    const viewport = viewportRef.current;
    const selectedRow = layout.rows[selectedIndex];
    if (!viewport || !selectedRow) return;
    const rowTop = selectedRow.offset;
    const rowBottom = rowTop + selectedRow.height;
    if (rowTop < viewport.scrollTop) {
      viewport.scrollTop = rowTop;
    } else if (rowBottom > viewport.scrollTop + viewport.clientHeight) {
      viewport.scrollTop = Math.max(0, rowBottom - viewport.clientHeight);
    }
  }, [filteredScenes, followPlayback, layout.rows, selectedSceneId]);

  if (filteredScenes.length === 0) {
    return <p className="AnalysisSceneList__empty">No scenes match this search.</p>;
  }

  return (
    <div
      ref={viewportRef}
      className="AnalysisSceneList"
      role="list"
      aria-label="Scenes"
      onScroll={(event: UIEvent<HTMLDivElement>) => setScrollTop(event.currentTarget.scrollTop)}
    >
      <div className="AnalysisSceneList__spacer" style={{ height: layout.totalHeight }}>
        {filteredScenes.slice(window.start, window.end).map((scene, offset) => {
          const index = window.start + offset;
          const row = layout.rows[index];
          if (!row) return null;
          return (
            <div
              role="listitem"
              aria-current={scene.id === selectedSceneId ? 'true' : undefined}
              className="AnalysisSceneList__row"
              key={scene.id}
              style={{ height: row.height, transform: `translateY(${row.offset}px)` }}
            >
              <AnalysisSceneBlob
                scene={scene}
                active={scene.id === selectedSceneId}
                expanded={scene.id === expandedSceneId}
                sourceTime={sourceTime}
                followPlayback={followPlayback}
                selectedPersonId={selectedPersonId}
                reviewCandidates={reviewCandidates.filter(
                  (candidate) => candidate.sample.timestamp >= scene.range.start
                    && candidate.sample.timestamp < scene.range.end,
                )}
                renderPersonThumbnail={renderPersonThumbnail}
                renderReviewThumbnail={renderReviewThumbnail}
                onToggle={() => {
                  const opening = expandedSceneId !== scene.id;
                  setExpandedSceneId(opening ? scene.id : undefined);
                  if (opening) onSceneSelect(scene);
                }}
                onPersonSelect={onPersonSelect}
                onPersonAppearanceSelect={onPersonAppearanceSelect}
                onMergePeople={onMergePeople}
                onMoveAppearance={onMoveAppearance}
                onAssignReviewFaces={onAssignReviewFaces}
                onReanalyzeDescription={onReanalyzeDescription}
                onWordClick={onWordClick}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
