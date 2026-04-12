// Stub: Interactive tutorial campaigns (WIP)
import type { CampaignCategory } from '../tutorialCampaigns';

export interface InteractiveCampaignStep {
  id: string;
  title: string;
  description: string;
}

export interface InteractiveCampaign {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: CampaignCategory;
  steps: InteractiveCampaignStep[];
}

export const INTERACTIVE_CAMPAIGNS: InteractiveCampaign[] = [];
