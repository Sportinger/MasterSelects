import { IconMovie, IconX } from '@tabler/icons-react';

import { SeedancePreproductionWizard } from '../../marketing/SeedancePreproductionWizard';
import { useDockStore } from '../../stores/dockStore';
import { useSeedanceEditorWorkflow } from './seedanceEditorWorkflowState';
import '../../marketing/landing.css';
import './StoryPanel.css';

export function StoryPanel() {
  const hidePanelType = useDockStore((state) => state.hidePanelType);
  const seedance = useSeedanceEditorWorkflow();
  const run = seedance.run;
  const statusLabel = run
    ? run.phase.replaceAll('-', ' ')
    : 'Waiting';

  return (
    <aside className="story-panel" aria-label="Story" data-story-panel="seedance">
      <header className="story-panel-header">
        <span className="story-panel-icon" aria-hidden="true"><IconMovie /></span>
        <div className="story-panel-heading">
          <div className="story-panel-title-row">
            <h2>Story</h2>
            <span className={`story-panel-status ${run ? 'is-active' : ''}`}>
              {statusLabel}
            </span>
          </div>
          <p>Direction, treatment and visual review</p>
        </div>
        <button
          className="story-panel-close"
          type="button"
          aria-label="Close Story panel"
          title="Close Story panel"
          onClick={() => hidePanelType('story')}
        >
          <IconX aria-hidden="true" />
        </button>
      </header>

      <div className="story-panel-body">
        {!run ? (
          <div className="story-panel-empty">
            <IconMovie aria-hidden="true" />
            <h3>Start Story from Media</h3>
            <p>Open the Media AI chat, describe the film and choose Story. Direction choices, treatment, sources, master looks, keyframes, progress and review will stay here.</p>
          </div>
        ) : (
          <SeedancePreproductionWizard
            chooseIdea={seedance.chooseIdea}
            chooseMaster={seedance.chooseMaster}
            continueFromMedia={seedance.continueFromMedia}
            moreIdeas={seedance.moreIdeas}
            readyKeyframeCount={seedance.readyKeyframeCount}
            regenerateMasters={seedance.regenerateMasters}
            regenerateSelected={seedance.regenerateSelected}
            replanAssets={seedance.replanAssets}
            retrySourceResearch={seedance.retrySourceResearch}
            resume={seedance.resume}
            reset={seedance.reset}
            run={run}
            setSceneExpanded={seedance.setSceneExpanded}
            setStoryExpanded={seedance.setStoryExpanded}
            toggleKeyframe={seedance.toggleKeyframe}
            toggleSourceAsset={seedance.toggleSourceAsset}
          />
        )}
      </div>
    </aside>
  );
}
