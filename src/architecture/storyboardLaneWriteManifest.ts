import type { CompleteRefactorLane } from './types';

const F0 = 'SB_F0_HOSTED_CHAT_SAFETY';
const N0 = 'SB_N0_NARRATED_NORMAL_AI';
const K0 = 'SB_K0_HOSTED_AGENT_FEASIBILITY';
const K1 = 'SB_K1_HOSTED_AGENT_PARITY';
const K2 = 'SB_K2_HOSTED_AGENT_RELIABILITY';
const K3 = 'SB_K3_HOSTED_AGENT_CUTOVER';
const C0 = 'SB_C0_CONTRACT_FREEZE';
const G1 = 'SB_G1_FOUNDATION';
const G2 = 'SB_G2_SAFE_DIRECTING';
const G3 = 'SB_G3_COMPARISON';
const G4 = 'SB_G4_COMMIT';
const G5 = 'SB_G5_RELEASE';

/**
 * Stable write ownership from Storyboard-Plan-Mode.md section 15.
 *
 * Shared central files are deliberately named rather than granted through
 * broad globs. Feature lanes build leaf modules and hand adapters to Lane I.
 */
export const storyboardRefactorLanes = [
  {
    id: 'storyboard-contract-integration',
    name: 'Storyboard Contract, Safety, And Integration',
    owner: 'Lane I',
    status: 'active',
    writeSet: [
      'src/architecture/storyboard*.ts',
      'src/services/storyboard/contracts/**',
      'src/services/project/storyboard/**',
      'functions/api/ai/chat.ts',
      'functions/lib/aiAudit.ts',
      'functions/lib/chatBilling.ts',
      'functions/lib/chatLog.ts',
      'functions/lib/credits.ts',
      'migrations/*ai_chat_turn_billing.sql',
      'src/services/cloud/apiContracts.ts',
      'src/services/cloudAiService.ts',
      'tests/unit/completeArchitectureRegistry.test.ts',
      'tests/unit/chatBilling.test.ts',
      'tests/unit/hostedChatAbort.test.ts',
      'tests/unit/hostedChatRedaction.test.ts',
      'docs/plans/Storyboard-Plan-Mode.md',
    ],
    forbiddenWriteSet: [
      'src/components/panels/flashboard/**',
      'src/components/timeline/**',
      'src/components/preview/**',
      'src/components/export/**',
      'src/stores/timeline/**',
      'src/stores/flashboardStore/**',
      'src/services/storyboard/core/**',
      'src/services/storyboard/generation/**',
      'src/services/storyboard/variants/**',
    ],
    highConflictFiles: [
      'functions/api/ai/chat.ts',
      'functions/lib/aiAudit.ts',
      'functions/lib/chatBilling.ts',
      'functions/lib/chatLog.ts',
      'functions/lib/credits.ts',
      'migrations/0014_ai_chat_turn_billing.sql',
      'src/services/cloud/apiContracts.ts',
      'src/services/cloudAiService.ts',
    ],
    exitGates: [F0, K0, K1, K2, K3, C0, G1, G2, G3, G4, G5],
  },
  {
    id: 'storyboard-core-animatic',
    name: 'Storyboard Core, Animatic, Coverage, And Templates',
    owner: 'Lane S',
    status: 'planned',
    writeSet: [
      'src/services/storyboard/core/**',
      'src/services/storyboard/animatic/**',
      'src/services/storyboard/coverage/**',
      'src/services/storyboard/templates/**',
      'src/components/timeline/storyboard/**',
      'src/components/properties/storyboard/**',
      'src/components/preview/storyboard/**',
      'src/components/export/storyboard/**',
      'tests/unit/storyboardCore*.test.ts',
      'tests/unit/storyboardAnimatic*.test.ts',
      'tests/unit/storyboardCoverage*.test.ts',
      'tests/unit/storyboardTemplate*.test.ts',
    ],
    forbiddenWriteSet: [
      'functions/**',
      'migrations/**',
      'src/services/flashboard/**',
      'src/stores/flashboardStore/**',
      'src/services/storyboard/contracts/**',
      'src/services/storyboard/generation/**',
      'src/services/storyboard/variants/**',
    ],
    exitGates: [G1, G2, G5],
  },
  {
    id: 'storyboard-chat-decisions',
    name: 'Storyboard Chat, Narration, And Decisions',
    owner: 'Lane C',
    status: 'active',
    writeSet: [
      'src/services/flashboard/AgentActivity*',
      'src/services/flashboard/FlashBoardChatActivity.ts',
      'src/services/flashboard/FlashBoardChatProviderTransport.ts',
      'src/services/flashboard/FlashBoardChatResponseMapping.ts',
      'src/services/flashboard/FlashBoardChatService.ts',
      'src/services/flashboard/FlashBoardChatTools.ts',
      'src/services/flashboard/FlashBoardChatTypes.ts',
      'src/components/panels/flashboard/FlashBoardChatOutput.tsx',
      'src/components/panels/flashboard/FlashBoardChatOutput.css',
      'src/components/panels/flashboard/useFlashBoardChatController.ts',
      'src/stores/flashboardStore/types.ts',
      'src/services/storyboard/chat/**',
      'src/services/storyboard/decisions/**',
      'src/components/panels/flashboard/storyboard/**',
      'tests/unit/flashboardChatNarration.test.ts',
      'tests/unit/flashboardChatActivityPersistence.test.ts',
      'tests/unit/flashboardChatActivityUi.test.tsx',
      'tests/unit/flashboardChatService.test.ts',
      'tests/unit/storyboardChat*.test.ts',
      'tests/unit/storyboardDecision*.test.ts',
    ],
    forbiddenWriteSet: [
      'functions/**',
      'migrations/**',
      'src/services/cloud/**',
      'src/services/cloudAiService.ts',
      'src/services/project/**',
      'src/components/timeline/**',
      'src/services/storyboard/generation/**',
      'src/services/storyboard/variants/**',
    ],
    highConflictFiles: [
      'src/services/flashboard/FlashBoardChatProviderTransport.ts',
      'src/services/flashboard/FlashBoardChatTypes.ts',
      'src/services/flashboard/FlashBoardChatTools.ts',
      'src/components/panels/flashboard/FlashBoardChatOutput.tsx',
      'src/components/panels/flashboard/useFlashBoardChatController.ts',
      'src/stores/flashboardStore/types.ts',
    ],
    exitGates: [N0, G1, G2, G5],
    activeUntilGate: G5,
  },
  {
    id: 'storyboard-generation',
    name: 'Storyboard Candidates And Approved Generation',
    owner: 'Lane G',
    status: 'planned',
    writeSet: [
      'src/services/storyboard/candidates/**',
      'src/services/storyboard/generation/**',
      'src/components/panels/flashboard/storyboardGeneration/**',
      'tests/unit/storyboardCandidate*.test.ts',
      'tests/unit/storyboardGeneration*.test.ts',
    ],
    forbiddenWriteSet: [
      'functions/api/ai/chat.ts',
      'functions/lib/chatBilling.ts',
      'migrations/**',
      'src/services/flashboard/FlashBoardChat*',
      'src/services/storyboard/contracts/**',
      'src/services/storyboard/core/**',
      'src/services/storyboard/variants/**',
    ],
    exitGates: [G1, G2, G3, G5],
  },
  {
    id: 'storyboard-variants-commit',
    name: 'Storyboard Variants, Isolation, And Commit',
    owner: 'Lane V',
    status: 'planned',
    writeSet: [
      'src/services/storyboard/variants/**',
      'src/stores/storyboardVariantStore/**',
      'src/components/panels/storyboard/variants/**',
      'tests/unit/storyboardVariant*.test.ts',
      'tests/unit/storyboardCommit*.test.ts',
    ],
    forbiddenWriteSet: [
      'functions/**',
      'migrations/**',
      'src/services/flashboard/**',
      'src/services/storyboard/contracts/**',
      'src/services/storyboard/generation/**',
      'src/stores/timeline/**',
    ],
    exitGates: [G1, G3, G4, G5],
  },
  {
    id: 'storyboard-release-verification',
    name: 'Storyboard Release Verification',
    owner: 'Lane Q',
    status: 'planned',
    writeSet: [
      'tests/e2e/storyboard/**',
      'tests/stress/storyboard/**',
      'scripts/storyboard/**',
      'docs/features/storyboard/**',
    ],
    forbiddenWriteSet: [
      'src/**',
      'functions/**',
      'migrations/**',
    ],
    exitGates: [G5],
  },
] as const satisfies readonly CompleteRefactorLane[];
