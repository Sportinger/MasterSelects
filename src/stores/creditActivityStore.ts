import { create } from 'zustand';

export type CreditActivityTerminalStatus = 'completed' | 'failed' | 'canceled';
export type CreditVisualSettlementKind = 'debit' | 'grant' | 'refund';

export interface CreditActivity {
  confirmedCredits: number;
  feature: string;
  id: string;
  startedAt: number;
  targetId?: string;
}

export interface CreditTerminalSummary {
  credits: number;
  endedAt: number;
  status: CreditActivityTerminalStatus;
}

export interface CreditVisualSettlement {
  activityId?: string;
  createdAt: number;
  credits: number;
  fromBalance: number;
  id: string;
  kind: CreditVisualSettlementKind;
  mutationId: string;
  sequence: number;
  source: string;
  targetId?: string;
  toBalance: number;
}

interface CreditActivityState {
  activities: Record<string, CreditActivity>;
  clearTerminalSummary: () => void;
  consumeVisualSettlement: (id: string) => void;
  endActivity: (id: string, status: CreditActivityTerminalStatus) => void;
  beginActivity: (input: { feature: string; id: string; targetId?: string }) => void;
  pushVisualSettlement: (input: Omit<CreditVisualSettlement, 'sequence'>) => void;
  recordActivityDebit: (id: string | undefined, credits: number) => void;
  recordActivityTotal: (id: string, totalCredits: number) => void;
  reset: () => void;
  sessionConfirmedCredits: number;
  terminalSummary: CreditTerminalSummary | null;
  visualSettlements: CreditVisualSettlement[];
  visualSequence: number;
}

const MAX_VISUAL_SETTLEMENTS = 24;

function implicitActivity(id: string): CreditActivity {
  return {
    confirmedCredits: 0,
    feature: 'Hosted AI',
    id,
    startedAt: Date.now(),
  };
}

export const useCreditActivityStore = create<CreditActivityState>((set) => ({
  activities: {},
  beginActivity: ({ feature, id, targetId }) => {
    set((state) => {
      const alreadyActive = Boolean(state.activities[id]);
      const startsSession = !alreadyActive && Object.keys(state.activities).length === 0;
      return {
        activities: {
          ...state.activities,
          [id]: {
            confirmedCredits: state.activities[id]?.confirmedCredits ?? 0,
            feature,
            id,
            startedAt: state.activities[id]?.startedAt ?? Date.now(),
            ...(targetId ? { targetId } : {}),
          },
        },
        ...(startsSession ? { sessionConfirmedCredits: 0, terminalSummary: null } : {}),
      };
    });
  },
  clearTerminalSummary: () => set({ terminalSummary: null }),
  consumeVisualSettlement: (id) => {
    set((state) => ({
      visualSettlements: state.visualSettlements.filter((settlement) => settlement.id !== id),
    }));
  },
  endActivity: (id, status) => {
    set((state) => {
      if (!state.activities[id]) {
        return state;
      }
      const activities = { ...state.activities };
      delete activities[id];
      const sessionEnded = Object.keys(activities).length === 0;
      return {
        activities,
        ...(sessionEnded ? {
          terminalSummary: {
            credits: state.sessionConfirmedCredits,
            endedAt: Date.now(),
            status,
          },
        } : {}),
      };
    });
  },
  pushVisualSettlement: (input) => {
    set((state) => {
      const visualSequence = state.visualSequence + 1;
      return {
        visualSequence,
        visualSettlements: [
          ...state.visualSettlements,
          { ...input, sequence: visualSequence },
        ].slice(-MAX_VISUAL_SETTLEMENTS),
      };
    });
  },
  recordActivityDebit: (id, credits) => {
    const safeCredits = Math.max(0, Math.floor(credits));
    if (safeCredits === 0) return;
    set((state) => {
      if (!id) {
        return { sessionConfirmedCredits: state.sessionConfirmedCredits + safeCredits };
      }
      const activity = state.activities[id] ?? implicitActivity(id);
      return {
        activities: {
          ...state.activities,
          [id]: {
            ...activity,
            confirmedCredits: activity.confirmedCredits + safeCredits,
          },
        },
        sessionConfirmedCredits: state.sessionConfirmedCredits + safeCredits,
      };
    });
  },
  recordActivityTotal: (id, totalCredits) => {
    const safeTotal = Math.max(0, Math.floor(totalCredits));
    set((state) => {
      const activity = state.activities[id] ?? implicitActivity(id);
      const nextTotal = Math.max(activity.confirmedCredits, safeTotal);
      const delta = nextTotal - activity.confirmedCredits;
      if (delta === 0 && state.activities[id]) {
        return state;
      }
      return {
        activities: {
          ...state.activities,
          [id]: { ...activity, confirmedCredits: nextTotal },
        },
        sessionConfirmedCredits: state.sessionConfirmedCredits + delta,
      };
    });
  },
  reset: () => set({
    activities: {},
    sessionConfirmedCredits: 0,
    terminalSummary: null,
    visualSettlements: [],
    visualSequence: 0,
  }),
  sessionConfirmedCredits: 0,
  terminalSummary: null,
  visualSettlements: [],
  visualSequence: 0,
}));

export function activeCreditActivityCount(): number {
  return Object.keys(useCreditActivityStore.getState().activities).length;
}

