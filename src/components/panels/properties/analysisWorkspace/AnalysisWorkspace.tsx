import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnalysisOverviewTimeline } from './AnalysisOverviewTimeline';
import { AnalysisSceneList } from './AnalysisSceneList';
import {
  buildAnalysisSceneListItems,
  filterAnalysisSceneListItems,
} from './analysisSceneListModel';
import {
  type AnalysisScenePerson,
  type AnalysisSceneSpeechMarker,
  type AnalysisSceneView,
} from './analysisSceneViewModel';
import {
  getAnalysisTranscriptCharacterCapacity,
  type AnalysisTranscriptChunkPause,
} from './analysisTranscriptChunks';
import type { AnalysisSceneSparklineCurve } from './AnalysisSceneSparkline';
import type { AnalysisWorkspaceViewModel } from './analysisWorkspaceAdapter';
import './AnalysisWorkspace.css';

export interface AnalysisWorkspaceProps {
  model: AnalysisWorkspaceViewModel;
  sourceTime: number;
  transcriptSearchQuery?: string;
  onTranscriptSearchChange?: (query: string) => void;
  isFollowingPlayback?: boolean;
  markers?: readonly AnalysisSceneSpeechMarker[];
  pauses?: readonly AnalysisTranscriptChunkPause[];
  energyCurve?: AnalysisSceneSparklineCurve;
  onSeekSourceTime: (sourceTime: number) => void;
  renderPersonThumbnail?: (
    person: AnalysisScenePerson,
    scene: AnalysisSceneView,
    sourceTime?: number,
  ) => ReactNode;
}

function findSceneIndex(model: AnalysisWorkspaceViewModel, sourceTime: number): number {
  return model.scenes.findIndex(
    (scene) => sourceTime >= scene.range.start && sourceTime < scene.range.end,
  );
}

export function AnalysisWorkspace({
  model,
  sourceTime,
  transcriptSearchQuery,
  onTranscriptSearchChange,
  isFollowingPlayback = false,
  markers,
  pauses,
  energyCurve,
  onSeekSourceTime,
  renderPersonThumbnail,
}: AnalysisWorkspaceProps) {
  const activeSceneIndex = useMemo(
    () => findSceneIndex(model, sourceTime),
    [model, sourceTime],
  );
  const [localSceneQuery, setLocalSceneQuery] = useState('');
  const sceneHostRef = useRef<HTMLDivElement>(null);
  const [transcriptTextWidth, setTranscriptTextWidth] = useState(0);
  const sceneQuery = transcriptSearchQuery ?? localSceneQuery;
  const setSceneQuery = onTranscriptSearchChange ?? setLocalSceneQuery;
  const transcriptCharacterCapacity = useMemo(
    () => getAnalysisTranscriptCharacterCapacity(transcriptTextWidth),
    [transcriptTextWidth],
  );
  const sceneListItems = useMemo(
    () => buildAnalysisSceneListItems(model.scenes, {
      markers,
      pauses,
      energyCurve,
      maxTextCharacters: transcriptCharacterCapacity,
    }),
    [energyCurve, markers, model.scenes, pauses, transcriptCharacterCapacity],
  );
  const matchingSegmentCount = useMemo(
    () => filterAnalysisSceneListItems(sceneListItems, sceneQuery).length,
    [sceneListItems, sceneQuery],
  );
  const selectedScene = activeSceneIndex >= 0
    ? model.scenes[activeSceneIndex]
    : model.scenes[0];

  useEffect(() => {
    const host = sceneHostRef.current;
    if (!host) return undefined;
    const updateTextWidth = () => {
      const speech = host.querySelector<HTMLElement>('.AnalysisSceneBlob__speech');
      const nextWidth = Math.round(speech?.getBoundingClientRect().width ?? 0);
      if (nextWidth <= 0) return;
      setTranscriptTextWidth(current => (
        Math.abs(current - nextWidth) < 4 ? current : nextWidth
      ));
    };
    updateTextWidth();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(updateTextWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, [sceneListItems.length]);

  const selectScene = useCallback((sceneId: string) => {
    const scene = model.scenes.find((candidate) => candidate.id === sceneId);
    if (scene) onSeekSourceTime(scene.range.start);
  }, [model.scenes, onSeekSourceTime]);

  return (
    <section className="AnalysisWorkspace" aria-label="Clip analysis workspace">
      <AnalysisOverviewTimeline
        analysis={model.overview}
        playheadTime={sourceTime}
        selectedSceneId={selectedScene?.id}
        onPlayheadChange={onSeekSourceTime}
        onSceneClick={(event) => selectScene(event.id)}
      />

      {selectedScene ? (
        <div className="AnalysisWorkspace__scene" ref={sceneHostRef}>
          <div className="AnalysisWorkspace__sceneSearch">
            <label htmlFor="analysis-scene-search">Segments</label>
            <input
              id="analysis-scene-search"
              type="search"
              value={sceneQuery}
              placeholder="Search text, speaker, person…"
              onChange={(event) => setSceneQuery(event.target.value)}
            />
            <span>{matchingSegmentCount}/{sceneListItems.length}</span>
          </div>
          <AnalysisSceneList
            items={sceneListItems}
            selectedSceneId={selectedScene.id}
            query={sceneQuery}
            sourceTime={sourceTime}
            followPlayback={isFollowingPlayback}
            renderPersonThumbnail={renderPersonThumbnail}
            onItemSelect={(item) => onSeekSourceTime(
              item.transcriptChunk.fallback
                ? item.scene.range.start
                : item.transcriptChunk.start,
            )}
            onWordClick={(word) => onSeekSourceTime(word.start)}
          />
        </div>
      ) : (
        <p className="AnalysisWorkspace__empty">
          Run an analysis above to build the first scene.
        </p>
      )}
    </section>
  );
}
