import { useCallback } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import {
  TUTORIAL_CAMPAIGNS,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  getCampaignsByCategory,
  type TutorialCampaign,
} from './tutorialCampaigns';

interface Props {
  onClose: () => void;
  onStartCampaign: (campaignId: string) => void;
}

export function TutorialCampaignDialog({ onClose, onStartCampaign }: Props) {
  const completedTutorials = useSettingsStore((s) => s.completedTutorials);

  const completedCount = completedTutorials.length;
  const totalCount = TUTORIAL_CAMPAIGNS.length;

  const handleStart = useCallback((campaign: TutorialCampaign) => {
    onStartCampaign(campaign.id);
  }, [onStartCampaign]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  }, [onClose]);

  return (
    <div className="tutorial-campaign-backdrop" onClick={handleBackdropClick}>
      <div className="tutorial-campaign-dialog">
        <div className="tutorial-campaign-header">
          <div className="tutorial-campaign-header-text">
            <h2>Tutorials</h2>
            <span className="tutorial-campaign-progress">
              {completedCount} / {totalCount} completed
            </span>
          </div>
          <button className="tutorial-campaign-close" onClick={onClose}>×</button>
        </div>

        <div className="tutorial-campaign-body">
          {CATEGORY_ORDER.map((category) => {
            const campaigns = getCampaignsByCategory(category);
            if (campaigns.length === 0) return null;
            return (
              <div key={category} className="tutorial-campaign-category">
                <h3 className="tutorial-campaign-category-title">{CATEGORY_LABELS[category]}</h3>
                <div className="tutorial-campaign-grid">
                  {campaigns.map((campaign) => {
                    const isCompleted = completedTutorials.includes(campaign.id);
                    return (
                      <button
                        key={campaign.id}
                        className={`tutorial-campaign-card ${isCompleted ? 'completed' : ''}`}
                        onClick={() => handleStart(campaign)}
                      >
                        <div className="tutorial-campaign-card-icon">{campaign.icon}</div>
                        <div className="tutorial-campaign-card-info">
                          <div className="tutorial-campaign-card-title">{campaign.title}</div>
                          <div className="tutorial-campaign-card-desc">{campaign.description}</div>
                          <div className="tutorial-campaign-card-meta">
                            {campaign.steps.length} steps
                            {isCompleted && <span className="tutorial-campaign-card-check">✓</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
