import { footstepCandidates, endingCandidateShift } from '../../effects/tracking/footstepCandidates';
import { upcomingDecisions, type FootstepDecision } from '../../effects/tracking/footstepDecisions';
import type { DenseTerrainMesh, TerrainFootstep, TerrainPlacement } from '../../types/terrainTracking';

const DEFAULT_OPENING_BUILD_DURATION = .7;
const CLOSING_SEARCH_OFFSET = 38;
const LOCK_CANCEL_FADE = .2;
const REJECTION_FADE_FRACTION = .7;
const SEARCH_SCHEDULE_FPS = 60;

export interface NativeTerrainInterlude {
  start: number;
  end: number;
  dropMeters: number;
  dropGreaterThan?: boolean;
}

export interface NativeTerrainScheduleInput {
  steps: readonly TerrainFootstep[];
  sourceStart: number;
  sourceEnd: number;
  denseMesh?: DenseTerrainMesh;
  openingDelay?: number;
  interlude?: NativeTerrainInterlude;
}

interface NativeTerrainEventBase {
  id: string;
  sourceStart: number;
  sourceEnd: number;
  lockTime: number | null;
  rejectTime: number | null;
  cardTitle?: string;
  confidence?: number;
}

export interface NativeTerrainBannerEvent extends NativeTerrainEventBase {
  kind: 'analysis-banner' | 'wonderful-banner' | 'danger-banner';
  title: string;
  buildDuration?: number;
  revealEnd?: number;
  fadeStart?: number;
  dropMeters?: number;
  dropGreaterThan?: boolean;
}

export interface NativeTerrainAcceptedStepEvent extends NativeTerrainEventBase {
  kind: 'accepted-step';
  step: TerrainFootstep;
  placement: TerrainPlacement;
  candidateIndex: 0;
  decisionStart: number;
  revealDuration: number;
}

export interface NativeTerrainCandidateEvent extends NativeTerrainEventBase {
  kind: 'rejected-alternative' | 'ongoing-search';
  step: TerrainFootstep;
  placement: TerrainPlacement;
  candidateIndex: number;
  spatialSeed: number;
  outcome: 'rejected' | 'cancelled';
  fadeInDuration: number;
  fadeOutStart: number;
  fadeOutEnd: number;
  searchSlot?: number;
}

export type NativeTerrainScheduleEvent =
  | NativeTerrainBannerEvent
  | NativeTerrainAcceptedStepEvent
  | NativeTerrainCandidateEvent;

const fract = (value: number): number => value - Math.floor(value);

function finiteContact(step: TerrainFootstep | undefined): number | null {
  if (!step) return null;
  const value = step.placement.contactTime;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function sideLabel(placement: TerrainPlacement): string {
  return placement.side === 'right' ? 'R' : 'L';
}

/** Match the footprint offset, slight width reduction and alternating rotation in footstepDecision.wgsl. */
function candidatePlacement(
  placement: TerrainPlacement,
  shift: readonly number[],
  seed: number,
  candidateIndex: number,
): TerrainPlacement {
  const angle = placement.rotation * Math.PI / 180;
  const dx = shift[0] * placement.width;
  const dy = shift[1] * placement.height;
  const sign = (candidateIndex - 1) % 2 === 1 ? 1 : -1;
  return {
    ...placement,
    x: placement.x + Math.cos(angle) * dx - Math.sin(angle) * dy,
    y: placement.y + Math.sin(angle) * dx + Math.cos(angle) * dy,
    width: placement.width * .91,
    rotation: placement.rotation + sign * (.12 + seed * .14) * 180 / Math.PI,
  };
}

/** DenseTerrainPipeline computes these local ground-plane bounds before placing closing probes. */
function terrainBounds(mesh: DenseTerrainMesh): number[] {
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < mesh.positions.length; index += 3) {
    const delta = [
      mesh.positions[index] - mesh.origin[0],
      mesh.positions[index + 1] - mesh.origin[1],
      mesh.positions[index + 2] - mesh.origin[2],
    ];
    [mesh.axisX, mesh.axisY, mesh.normal].forEach((axis, axisIndex) => {
      const value = axis.reduce((sum, component, componentIndex) => (
        sum + component * delta[componentIndex]
      ), 0);
      low[axisIndex] = Math.min(low[axisIndex], value);
      high[axisIndex] = Math.max(high[axisIndex], value);
    });
  }
  return [
    low[0],
    low[1],
    Math.max(1e-6, high[0] - low[0]),
    Math.max(1e-6, high[1] - low[1]),
  ];
}

function firstDecisionForStep(
  steps: TerrainFootstep[],
  stepIndex: number,
  sourceStart: number,
  openingDelay: number,
): { decision: FootstepDecision; eligibleAt: number } | null {
  const analysisStart = sourceStart + openingDelay;
  const contact = finiteContact(steps[stepIndex]);
  if (contact === null || contact <= analysisStart) return null;
  const initialNext = steps.findIndex(step => (finiteContact(step) ?? -Infinity) > analysisStart);
  if (initialNext < 0 || stepIndex < initialNext) return null;
  const precedingEligibility = finiteContact(steps[stepIndex - 2]);
  const eligibleAt = stepIndex <= initialNext + 1
    ? analysisStart
    : Math.max(analysisStart, precedingEligibility ?? analysisStart);
  if (eligibleAt >= contact) return null;

  // The opening pair has a special early start. Ask the original decision
  // function at first eligibility before falling back to just before landing.
  const early = upcomingDecisions(steps, eligibleAt, sourceStart, openingDelay)
    .find(decision => decision.step === steps[stepIndex]);
  if (early) return { decision: early, eligibleAt };
  const late = upcomingDecisions(
    steps,
    Math.max(eligibleAt, contact - Math.min(1e-6, Math.max(1e-9, (contact - eligibleAt) / 2))),
    sourceStart,
    openingDelay,
  ).find(decision => decision.step === steps[stepIndex]);
  return late ? { decision: late, eligibleAt } : null;
}

function acceptedEvent(
  decision: FootstepDecision,
  eligibleAt: number,
  sourceStart: number,
  sourceEnd: number,
): NativeTerrainAcceptedStepEvent | null {
  const contact = finiteContact(decision.step);
  if (contact === null) return null;
  const beforeLock = footstepCandidates({
    ...decision,
    age: Math.max(0, decision.scanDuration - 1e-9),
    locked: false,
  });
  const winner = beforeLock.find(candidate => candidate.index === 0);
  if (!winner) return null;
  const eventStart = Math.max(sourceStart, eligibleAt, decision.start + winner.launch);
  const eventEnd = Math.min(sourceEnd, contact);
  if (eventEnd <= eventStart) return null;
  const lockTime = decision.start + decision.scanDuration;
  return {
    id: `accepted-step:${decision.step.id}`,
    kind: 'accepted-step',
    sourceStart: eventStart,
    sourceEnd: eventEnd,
    lockTime,
    rejectTime: null,
    step: decision.step,
    placement: decision.step.placement,
    candidateIndex: 0,
    decisionStart: decision.start,
    revealDuration: Math.min(.12, decision.scanDuration * .2),
    cardTitle: `${sideLabel(decision.step.placement)} 1 · TERRAIN LOCK`,
    confidence: decision.confidence,
  };
}

function decisionAlternatives(
  decision: FootstepDecision,
  eligibleAt: number,
  sourceStart: number,
  sourceEnd: number,
): NativeTerrainCandidateEvent[] {
  const events: NativeTerrainCandidateEvent[] = [];
  const contact = finiteContact(decision.step);
  if (contact === null) return events;
  const count = 2 + Math.floor(decision.seed * 2);
  for (let option = 0; option < count; option += 1) {
    const firstLaunch = .04 + decision.seed * .08 + option * (.18 + decision.seed * .10);
    let launch = firstLaunch;
    let attempt = 0;
    while (launch < decision.scanDuration) {
      const candidates = footstepCandidates({
        ...decision,
        age: Math.min(decision.scanDuration - 1e-9, launch + 1e-9),
        locked: false,
      });
      const candidate = candidates.find(value => (
        value.index === option + 1 && Math.abs(value.launch - launch) < 1e-6
      ));
      if (!candidate) break;
      const absoluteLaunch = decision.start + candidate.launch;
      const absoluteReject = decision.start + candidate.rejectAt;
      const lockTime = decision.start + decision.scanDuration;
      const rejected = candidate.rejectAt < decision.scanDuration;
      const naturalEnd = absoluteReject + .32;
      const fadeEnd = Math.min(naturalEnd, lockTime + LOCK_CANCEL_FADE, contact, sourceEnd);
      const eventStart = Math.max(sourceStart, eligibleAt, absoluteLaunch);
      if (fadeEnd > eventStart) {
        const rejectTime = rejected ? absoluteReject : null;
        const fadeOutStart = rejected
          ? absoluteReject + .32 * REJECTION_FADE_FRACTION
          : lockTime;
        events.push({
          id: `rejected-alternative:${decision.step.id}:${option + 1}:${attempt}`,
          kind: 'rejected-alternative',
          sourceStart: eventStart,
          sourceEnd: fadeEnd,
          lockTime,
          rejectTime,
          step: decision.step,
          placement: candidatePlacement(
            decision.step.placement,
            candidate.shift,
            candidate.spatialSeed,
            candidate.index,
          ),
          candidateIndex: candidate.index,
          spatialSeed: candidate.spatialSeed,
          outcome: rejected ? 'rejected' : 'cancelled',
          fadeInDuration: Math.min(.08, candidate.blueDuration * .2),
          fadeOutStart: Math.max(eventStart, Math.min(fadeEnd, fadeOutStart)),
          fadeOutEnd: fadeEnd,
          cardTitle: `${sideLabel(decision.step.placement)} ${candidate.index + 1} · ${rejected ? 'REJECT' : 'SCAN'}`,
          confidence: rejected
            ? .24 + fract(candidate.index * .17) * .11
            : decision.confidence,
        });
      }
      const period = candidate.blueDuration + .32 + .05;
      attempt += 1;
      launch = firstLaunch + attempt * period;
    }
  }
  return events;
}

function closingSearchPlacement(step: TerrainFootstep, slot: number): TerrainFootstep {
  const placement = step.placement;
  const angle = placement.rotation * Math.PI / 180;
  const forward = placement.height * (.30 + slot * .10);
  const lateral = placement.width * (slot === 0 ? -.5 : .5);
  return {
    ...step,
    placement: {
      ...placement,
      x: placement.x + Math.sin(angle) * forward + Math.cos(angle) * lateral,
      y: placement.y - Math.cos(angle) * forward + Math.sin(angle) * lateral,
    },
  };
}

function closingSearchEvents(
  steps: TerrainFootstep[],
  input: NativeTerrainScheduleInput,
): NativeTerrainCandidateEvent[] {
  const lastStep = steps.at(-1);
  const lastContact = lastStep ? finiteContact(lastStep) : null;
  if (!lastStep || lastContact === null) return [];
  const searchStart = Math.max(input.sourceStart + CLOSING_SEARCH_OFFSET, lastContact);
  if (searchStart >= input.sourceEnd) return [];
  const events: NativeTerrainCandidateEvent[] = [];

  for (let slot = 0; slot < 2; slot += 1) {
    const step = closingSearchPlacement(lastStep, slot);
    const seed = .45 + (slot * 317 % 500) / 1000;
    const count = 2 + Math.floor(seed * 2);
    const mesh = lastStep.mesh ?? input.denseMesh;
    const bounds = mesh ? terrainBounds(mesh) : null;
    for (let option = 0; option < count; option += 1) {
      const variation = fract(seed * 13.71 + option * .381966);
      const blueDuration = .20 + variation * .33;
      const redDuration = .50;
      const period = blueDuration + redDuration + .08 + variation * .10;
      const origin = lastContact - option * .17;
      let cycle = Math.max(0, Math.floor((searchStart - origin) / period));
      while (origin + cycle * period < input.sourceEnd) {
        if (option > 0
          && cycle * period - option * .17 > .35 + (count - 1 - option) * .32) break;
        const launch = origin + cycle * period;
        const reject = launch + blueDuration;
        const finish = reject + redDuration;
        const eventStart = Math.max(searchStart, launch);
        const eventEnd = Math.min(input.sourceEnd, finish);
        if (eventEnd > eventStart) {
          const spatialSeed = fract(seed + cycle * .137);
          const fallbackShift = footstepCandidates({
            step,
            start: launch,
            age: Math.max(0, eventStart - launch),
            scanDuration: 3.6,
            confidence: .94,
            seed,
            locked: false,
            isNext: false,
            searchOnly: true,
            endingAge: Math.max(0, eventStart - lastContact),
          }).find(candidate => candidate.index === option + 1)?.shift ?? [0, 0];
          const shift = bounds
            ? endingCandidateShift(spatialSeed, option, step.placement, bounds)
            : fallbackShift;
          events.push({
            id: `ongoing-search:${lastStep.id}:${slot}:${option + 1}:${cycle}`,
            kind: 'ongoing-search',
            sourceStart: eventStart,
            sourceEnd: eventEnd,
            lockTime: null,
            rejectTime: reject,
            step: lastStep,
            placement: candidatePlacement(step.placement, shift, spatialSeed, option + 1),
            candidateIndex: option + 1,
            spatialSeed,
            outcome: 'rejected',
            fadeInDuration: Math.min(.08, blueDuration * .2),
            fadeOutStart: reject + redDuration * REJECTION_FADE_FRACTION,
            fadeOutEnd: finish,
            searchSlot: slot,
            cardTitle: `${sideLabel(step.placement)} ${option + 2} · REJECT`,
            confidence: .24 + fract((option + 1) * .17) * .11,
          });
        }
        cycle += 1;
      }
    }
  }
  return events;
}

interface SampledSearchRecord {
  event: NativeTerrainCandidateEvent;
  naturalEnd: number;
  rawRejectTime: number;
  lastSeen: number;
}

/**
 * The original decision selector briefly adds a third probe after a double
 * lock and fills empty lanes from sourceStart + 38 until the final landing.
 * Its age intentionally resets while it follows the moving decision window,
 * so materialize those on the same 60 fps cadence used by authored footage.
 * Candidate launch/reject times remain analytical; only activation/deactivation
 * at a decision-window edge is quantized to one source frame.
 */
function transientSearchEvents(
  steps: TerrainFootstep[],
  input: NativeTerrainScheduleInput,
  openingDelay: number,
): NativeTerrainCandidateEvent[] {
  const lastContact = finiteContact(steps.at(-1));
  if (lastContact === null) return [];
  const finalSearchStart = Math.max(input.sourceStart + CLOSING_SEARCH_OFFSET, lastContact);
  const sampleStart = Math.max(input.sourceStart, input.sourceStart + openingDelay);
  const sampleEnd = Math.min(input.sourceEnd, finalSearchStart);
  if (sampleEnd <= sampleStart) return [];
  const frameDuration = 1 / SEARCH_SCHEDULE_FPS;
  const active = new Map<string, SampledSearchRecord>();
  const output: NativeTerrainCandidateEvent[] = [];

  const finishMissing = (seen: ReadonlySet<string>, at: number) => {
    for (const [key, record] of active) {
      if (seen.has(key)) continue;
      const sourceEnd = Math.min(input.sourceEnd, sampleEnd, record.naturalEnd, at);
      if (sourceEnd > record.event.sourceStart) {
        const rejected = record.rawRejectTime < sourceEnd;
        output.push({
          ...record.event,
          sourceEnd,
          rejectTime: rejected ? record.rawRejectTime : null,
          outcome: rejected ? 'rejected' : 'cancelled',
          fadeOutStart: rejected
            ? Math.min(sourceEnd, record.rawRejectTime + (record.naturalEnd - record.rawRejectTime) * REJECTION_FADE_FRACTION)
            : Math.max(record.event.sourceStart, sourceEnd - Math.min(LOCK_CANCEL_FADE, sourceEnd - record.event.sourceStart)),
          fadeOutEnd: sourceEnd,
          cardTitle: `${sideLabel(record.event.placement)} ${record.event.candidateIndex + 1} · ${rejected ? 'REJECT' : 'SCAN'}`,
        });
      }
      active.delete(key);
    }
  };

  for (let frame = 0; ; frame += 1) {
    const time = sampleStart + frame * frameDuration;
    if (time >= sampleEnd - 1e-9) break;
    const decisions = upcomingDecisions(steps, time, input.sourceStart, openingDelay)
      .filter(decision => decision.searchOnly);
    const seen = new Set<string>();
    decisions.forEach((decision, searchSlot) => {
      const originalStep = steps.find(step => step.id === decision.step.id);
      if (!originalStep) return;
      const mesh = originalStep.mesh ?? input.denseMesh;
      const bounds = mesh ? terrainBounds(mesh) : null;
      for (const candidate of footstepCandidates(decision)) {
        const launch = time - candidate.age;
        const redDuration = (decision.endingAge ?? 0) > 0 ? .50 : .32;
        const rejectTime = launch + candidate.blueDuration;
        const naturalEnd = rejectTime + redDuration;
        const key = [
          originalStep.id,
          searchSlot,
          candidate.index,
          candidate.spatialSeed.toFixed(9),
          launch.toFixed(6),
          decision.step.placement.x.toFixed(6),
          decision.step.placement.y.toFixed(6),
        ].join(':');
        seen.add(key);
        const existing = active.get(key);
        if (existing) {
          existing.lastSeen = time;
          continue;
        }
        const shift = bounds
          ? endingCandidateShift(candidate.spatialSeed, candidate.index - 1, decision.step.placement, bounds)
          : candidate.shift;
        const sourceStart = Math.max(input.sourceStart, launch, time - frameDuration);
        active.set(key, {
          naturalEnd,
          rawRejectTime: rejectTime,
          lastSeen: time,
          event: {
            id: `ongoing-search:${key}`,
            kind: 'ongoing-search',
            sourceStart,
            sourceEnd: naturalEnd,
            lockTime: null,
            rejectTime,
            step: originalStep,
            placement: candidatePlacement(
              decision.step.placement,
              shift,
              candidate.spatialSeed,
              candidate.index,
            ),
            candidateIndex: candidate.index,
            spatialSeed: candidate.spatialSeed,
            outcome: 'rejected',
            fadeInDuration: Math.min(.08, candidate.blueDuration * .2),
            fadeOutStart: rejectTime + redDuration * REJECTION_FADE_FRACTION,
            fadeOutEnd: naturalEnd,
            searchSlot,
            cardTitle: `${sideLabel(decision.step.placement)} ${candidate.index + 1} · REJECT`,
            confidence: .24 + fract(candidate.index * .17) * .11,
          },
        });
      }
    });
    finishMissing(seen, time);
  }
  finishMissing(new Set(), sampleEnd);
  return output;
}

function bannerEvents(input: NativeTerrainScheduleInput, openingDelay: number): NativeTerrainBannerEvent[] {
  const events: NativeTerrainBannerEvent[] = [{
    id: 'analysis-banner',
    kind: 'analysis-banner',
    sourceStart: input.sourceStart,
    sourceEnd: input.sourceEnd,
    lockTime: null,
    rejectTime: null,
    title: 'ANALYSING TERRAIN',
    cardTitle: 'CONTACT SEARCH',
    buildDuration: openingDelay,
  }];
  const beat = input.interlude;
  if (!beat || !Number.isFinite(beat.start) || !Number.isFinite(beat.end) || beat.end < beat.start) return events;
  const scenicEnd = Math.min(input.sourceEnd, beat.end + .45);
  const wonderfulStart = Math.max(input.sourceStart, beat.start + .08);
  if (scenicEnd > wonderfulStart) {
    events.push({
      id: 'wonderful-banner',
      kind: 'wonderful-banner',
      sourceStart: wonderfulStart,
      sourceEnd: scenicEnd,
      lockTime: null,
      rejectTime: null,
      title: 'WONDERFUL',
      revealEnd: beat.start + .25,
      fadeStart: beat.end + .15,
      dropMeters: beat.dropMeters,
      dropGreaterThan: beat.dropGreaterThan,
    });
  }
  const dangerStart = Math.max(input.sourceStart, beat.start + 1.30);
  if (scenicEnd > dangerStart) {
    const prefix = beat.dropGreaterThan ? '>' : '';
    events.push({
      id: 'danger-banner',
      kind: 'danger-banner',
      sourceStart: dangerStart,
      sourceEnd: scenicEnd,
      lockTime: null,
      rejectTime: null,
      title: `DANGER ${prefix}${Math.round(beat.dropMeters)} METER`,
      revealEnd: beat.start + 1.45,
      fadeStart: beat.end + .15,
      dropMeters: beat.dropMeters,
      dropGreaterThan: beat.dropGreaterThan,
    });
  }
  return events;
}

/**
 * Convert the original source-time shader choreography into deterministic,
 * editable authoring intervals. The returned objects retain their source
 * TerrainFootstep references and never read or mutate runtime/store state.
 */
export function buildNativeTerrainSchedule(input: NativeTerrainScheduleInput): NativeTerrainScheduleEvent[] {
  if (!Number.isFinite(input.sourceStart) || !Number.isFinite(input.sourceEnd)
    || input.sourceEnd <= input.sourceStart) return [];
  const openingDelay = Number.isFinite(input.openingDelay)
    ? Math.max(0, input.openingDelay!)
    : DEFAULT_OPENING_BUILD_DURATION;
  const steps = input.steps.filter(step => finiteContact(step) !== null);
  const events: NativeTerrainScheduleEvent[] = bannerEvents(input, openingDelay);
  for (let index = 0; index < steps.length; index += 1) {
    const resolved = firstDecisionForStep(steps, index, input.sourceStart, openingDelay);
    if (!resolved) continue;
    const accepted = acceptedEvent(
      resolved.decision,
      resolved.eligibleAt,
      input.sourceStart,
      input.sourceEnd,
    );
    if (accepted) events.push(accepted);
    events.push(...decisionAlternatives(
      resolved.decision,
      resolved.eligibleAt,
      input.sourceStart,
      input.sourceEnd,
    ));
  }
  events.push(...transientSearchEvents(steps, input, openingDelay));
  events.push(...closingSearchEvents(steps, input));
  return events.toSorted((left, right) => (
    left.sourceStart - right.sourceStart
    || left.sourceEnd - right.sourceEnd
    || left.id.localeCompare(right.id)
  ));
}
