import type { RecentProjectEntry } from '../services/projectFileService';
import type {
  LandingBackgroundStatus,
  LandingBackgroundStatusReporter,
} from './runLandingBackgroundCreation';
import type { LandingBackgroundJobStartOptions } from './landingBackgroundJob';
import type { LandingProjectMediaItem } from './LandingProjectMediaStrip';
import type { FlashBoardChatMessage } from '../stores/flashboardStore';
import type { LandingEditVariantStatus } from './landingEditSession';

export interface LandingReviewVariantSummary {
  id: string;
  label: string;
  status: LandingEditVariantStatus;
}

export interface LandingSequenceSummary {
  clipCount: number;
  duration: number;
  hasTranscript: boolean;
  id: string;
  name: string;
}

export type LandingPromptPath = 'auto' | 'direct' | 'story';

export interface LandingPageProps {
  backgroundActivityStatus?: LandingBackgroundStatus | null;
  backgroundJobRunning?: boolean;
  isOpeningEditor?: boolean;
  isNewProjectNaming?: boolean;
  onCancelNewProjectNaming?: () => void;
  onChooseNewProject?: () => Promise<void> | void;
  onCreateNewProject?: (name: string) => Promise<string | null>;
  onOpenEditor?: () => void;
  onOpenChat?: (
    prompt?: string,
    onStatus?: LandingBackgroundStatusReporter,
    options?: LandingBackgroundJobStartOptions,
  ) => Promise<void> | void;
  onOpenDirectChat?: (
    prompt: string,
    onStatus?: LandingBackgroundStatusReporter,
  ) => Promise<void> | void;
  onStopChat?: () => boolean | void;
  onDropProjectMedia?: (dataTransfer: DataTransfer) => Promise<number | void>;
  onOpenProject?: () => Promise<void> | void;
  onShowProjectPicker?: () => void;
  onOpenRecentProject?: (projectId: string) => Promise<void> | void;
  onPickProjectFiles?: (files: File[]) => Promise<number | void>;
  onRemoveProjectFile?: (
    item: LandingProjectMediaItem,
  ) => Promise<boolean | void> | boolean | void;
  onOpenProjectFile?: (item: LandingProjectMediaItem) => void;
  openingProjectId?: string | null;
  onRenderVideo?: () => Promise<void> | void;
  onSelectReviewVariant?: (variantId: string) => Promise<boolean> | boolean | void;
  onSelectSequence?: (sequenceId: string) => Promise<void> | void;
  projectMedia?: LandingProjectMediaItem[];
  projectName?: string;
  projectPickerCanClose?: boolean;
  directMessages?: FlashBoardChatMessage[];
  recentProjects?: RecentProjectEntry[];
  reviewCompositionId?: string;
  reviewCompositionName?: string;
  reviewActiveVariantId?: string;
  reviewError?: string;
  reviewMessages?: FlashBoardChatMessage[];
  reviewReady?: boolean;
  reviewRendering?: boolean;
  reviewVariants?: LandingReviewVariantSummary[];
  selectedProjectId?: string | null;
  selectedSequenceId?: string | null;
  selectedSequenceReady?: boolean;
  sequences?: LandingSequenceSummary[];
}
