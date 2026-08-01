import { useEffect, useState } from 'react';
import {
  useCreditActivityStore,
  type CreditVisualSettlement,
} from '../../stores/creditActivityStore';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

export function creditSettlementDuration(credits: number): number {
  const baseDuration = 430 + Math.sqrt(Math.max(1, credits)) * 55;
  return Math.max(900, Math.min(2_400, baseDuration * 2));
}

function leadingSettlementGroup(
  settlements: CreditVisualSettlement[],
  kind: CreditVisualSettlement['kind'],
): CreditVisualSettlement[] {
  const group: CreditVisualSettlement[] = [];
  for (const settlement of settlements) {
    if (settlement.kind !== kind) break;
    group.push(settlement);
  }
  return group;
}

function mergeSettlements(group: CreditVisualSettlement[]): CreditVisualSettlement {
  const first = group[0];
  const last = group[group.length - 1];
  return {
    ...last,
    credits: group.reduce((sum, settlement) => sum + settlement.credits, 0),
    fromBalance: first.fromBalance,
    id: first.id,
  };
}

export interface CreditBurnAnimationState {
  activeSettlement: CreditVisualSettlement | null;
  announcement: string;
  reducedMotion: boolean;
}

export function useCreditBurnAnimation(): CreditBurnAnimationState {
  const visualSettlements = useCreditActivityStore((state) => state.visualSettlements);
  const consumeVisualSettlement = useCreditActivityStore((state) => state.consumeVisualSettlement);
  const [activeSettlement, setActiveSettlement] = useState<CreditVisualSettlement | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  const [documentHidden, setDocumentHidden] = useState(
    typeof document !== 'undefined' ? document.hidden : false,
  );

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const update = () => setReducedMotion(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => {
    const update = () => setDocumentHidden(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    if (visualSettlements.length === 0) return;
    const candidates = activeSettlement
      ? visualSettlements.filter((settlement) => settlement.id !== activeSettlement.id)
      : visualSettlements;
    if (candidates.length === 0) return;
    if (activeSettlement && candidates[0].kind !== activeSettlement.kind) return;

    const group = leadingSettlementGroup(
      candidates,
      activeSettlement?.kind ?? candidates[0].kind,
    );
    const merged = mergeSettlements(activeSettlement ? [activeSettlement, ...group] : group);
    const direction = merged.kind === 'debit' ? 'used' : 'added';
    let canceled = false;
    queueMicrotask(() => {
      if (canceled) return;
      setAnnouncement(`${merged.credits.toLocaleString()} credits ${direction}.`);
      if (reducedMotion || documentHidden) {
        const consumed = activeSettlement ? [activeSettlement, ...group] : group;
        consumed.forEach((settlement) => consumeVisualSettlement(settlement.id));
        setActiveSettlement(null);
        return;
      }
      group.slice(activeSettlement ? 0 : 1).forEach((settlement) => {
        consumeVisualSettlement(settlement.id);
      });
      setActiveSettlement(merged);
    });
    return () => {
      canceled = true;
    };
  }, [activeSettlement, consumeVisualSettlement, documentHidden, reducedMotion, visualSettlements]);

  useEffect(() => {
    if (!activeSettlement) return undefined;
    if (reducedMotion || documentHidden) {
      let canceled = false;
      queueMicrotask(() => {
        if (canceled) return;
        consumeVisualSettlement(activeSettlement.id);
        setActiveSettlement(null);
      });
      return () => {
        canceled = true;
      };
    }
    const timer = window.setTimeout(() => {
      consumeVisualSettlement(activeSettlement.id);
      setActiveSettlement(null);
    }, creditSettlementDuration(activeSettlement.credits));
    return () => window.clearTimeout(timer);
  }, [activeSettlement, consumeVisualSettlement, documentHidden, reducedMotion]);

  return { activeSettlement, announcement, reducedMotion };
}
