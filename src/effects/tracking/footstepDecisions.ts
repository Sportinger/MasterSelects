import type { TerrainFootstep } from '../../types/terrainTracking';

export interface FootstepDecision {
  step: TerrainFootstep;
  start: number;
  age: number;
  scanDuration: number;
  confidence: number;
  seed: number;
  locked: boolean;
  isNext: boolean;
  searchOnly?: boolean;
  endingAge?: number;
}

/** The next two contacts can lock; search advances one contact beyond them, within 2.4 source seconds.
 * Opening candidates are already inspected while the walker is standing still.
 * The following contact may lock up to 0.3 seconds before the preceding landing.
 * All scores and rejected alternatives are fictional art direction.
 */
export function upcomingDecisions(steps: TerrainFootstep[], time: number, sourceStart: number, openingDelay = 0): FootstepDecision[] {
  const analysisStart = sourceStart + openingDelay;
  if (!Number.isFinite(time) || time < analysisStart) return [];
  const next = steps.findIndex(step => (step.placement.contactTime ?? -Infinity) > time);
  const extendedSearch = time >= sourceStart + 38;
  if (next < 0) return extendedSearch && steps.length ? [ongoingSearch(steps[steps.length - 1], time, sourceStart, 0), ongoingSearch(steps[steps.length - 1], time, sourceStart, 1)] : [];
  const decisions: FootstepDecision[] = steps.slice(next, next + 2).flatMap((step, offset) => {
    const index = next + offset;
    const contact = step.placement.contactTime!;
    const previous = steps[index - 1]?.placement.contactTime ?? sourceStart;
    const normalStart = Math.max(analysisStart, steps[index - 2]?.placement.contactTime ?? sourceStart, contact - 2.4);
    const authoredLock = step.placement.lockTime;
    const hasAuthoredLock = authoredLock !== undefined && Number.isFinite(authoredLock);
    const start = hasAuthoredLock ? Math.max(analysisStart, Math.min(normalStart, authoredLock - .8)) : next === 0 ? analysisStart : normalStart;
    if (time < start) return [];
    let hash = 2166136261;
    for (const character of step.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    const seed = (hash >>> 0) % 997 / 997;
    // A short overlap makes the next accepted step readable before weight transfer.
    const automaticLock = Math.max(normalStart + Math.min(1.3, (contact - normalStart) * .65) - .5, previous - .3, normalStart + .2);
    const lockAt = Math.min(contact - .02, Math.max(start + .01, hasAuthoredLock ? authoredLock : automaticLock));
    const scanDuration = Math.max(.01, lockAt - start);
    const isNext = offset === 0;
    return [{ step, start, age: time - start, scanDuration, confidence: .89 + seed * .09, seed, isNext, locked: time >= lockAt }];
  });
  // Once both contacts are accepted, search the next observed landing ahead.
  // Never reopen alternatives around an already locked footprint.
  if (extendedSearch) {
    const open = decisions.filter(decision => !decision.locked);
    const lastLocked = decisions.filter(decision => decision.locked).at(-1);
    const anchor = open[0]?.step ?? steps[lastLocked ? steps.indexOf(lastLocked.step) + 1 : next] ?? steps[steps.length - 1];
    for (let slot = open.length; slot < 2; slot++) decisions.push(ongoingSearch(anchor, time, sourceStart, slot));
    return decisions;
  }
  const searchStep = steps[next + 2];
  if (decisions.length === 2 && decisions.every(decision => decision.locked)
    && searchStep && searchStep.placement.contactTime! - time <= 2.4) {
    const age = .15 + ((time - sourceStart) % 1.2);
    const placement = searchStep.placement;
    const angle = placement.rotation * Math.PI / 180;
    const forward = placement.height * .55;
    const searchArea = { ...searchStep, placement: { ...placement,
      x: placement.x + Math.sin(angle) * forward,
      y: placement.y - Math.cos(angle) * forward } };
    decisions.push({ ...decisions[1], step: searchArea, start: time - age, age, scanDuration: 1.6,
      seed: (decisions[1].seed + .37) % 1, locked: false, isNext: false, searchOnly: true });
  }
  return decisions;
}

/** Independent inspection rhythm for the slower closing stretch; no invented contact. */
function ongoingSearch(step: TerrainFootstep, time: number, sourceStart: number, slot: number): FootstepDecision {
  const age = .15 + time - sourceStart + slot * .8;
  const placement = step.placement;
  const angle = placement.rotation * Math.PI / 180;
  const forward = placement.height * (.30 + slot * .10);
  const lateral = placement.width * (slot === 0 ? -.5 : .5);
  const searchArea = { ...step, placement: { ...placement,
    x: placement.x + Math.sin(angle) * forward + Math.cos(angle) * lateral,
    y: placement.y - Math.cos(angle) * forward + Math.sin(angle) * lateral } };
  return { step: searchArea, start: time - age, age, scanDuration: 3.6,
    seed: .45 + (slot * 317 % 500) / 1000,
    confidence: .94, locked: false, isNext: false, searchOnly: true,
    endingAge: Math.max(0, time - (step.placement.contactTime ?? time)) };
}
