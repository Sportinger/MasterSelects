import { useTimelineStore } from '../../stores/timeline';
import { SKELETON_ANGLE_KEYS, SKELETON_SEGMENTS, SKELETON_JOINTS, type SkeletonJoint } from './skeletonRig';
import { limbJoint, parseSkeletonActions, SKELETON_ACTIONS, skeletonActionContact } from './skeletonActions';
import {
  sampleStickFigurePose,
  STICK_FIGURE_EFFECT,
  stickFigureFrameSize,
  stickFigureRef,
  type StickFigurePoseSample,
} from './stickFigureJointRuntime';

export type ChoreographyIssueKind = 'foot-in-ground' | 'missed-contact' | 'rotation-jump' | 'action-overlap' | 'body-overlap';

export interface ChoreographyIssue {
  kind: ChoreographyIssueKind;
  /** `clipId|effectId` of the figure. */
  figure: string;
  figureName: string;
  /** Timeline seconds where the problem starts. */
  time: number;
  /** Timeline seconds where a lasting problem ends. */
  endTime?: number;
  detail: string;
}

export interface ChoreographyOptions {
  start?: number;
  end?: number;
  fps?: number;
  /** Fastest joint turn before it reads as a pop, degrees per second (default 2250 = 75° per frame at 30 fps). */
  maxDegreesPerSecond?: number;
  /** How close (composition pixels at a 1080 px frame) a strike must come to count as a hit. */
  hitDistance?: number;
}

interface Figure { ref: string; name: string; clipId: string; start: number; end: number; actions: ReturnType<typeof parseSkeletonActions> }

const toPixels = (sample: StickFigurePoseSample, joint: SkeletonJoint, width: number, height: number) =>
  ({ x: (sample.joints[joint].x * 0.5 + 0.5) * width, y: (sample.joints[joint].y * 0.5 + 0.5) * height });

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, length = dx * dx + dy * dy;
  const t = length > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length)) : 0;
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}

/** Distance in composition pixels from a point to a figure's drawn body (capsules and head). */
function bodyDistance(point: { x: number; y: number }, sample: StickFigurePoseSample, width: number, height: number): number {
  const at = (joint: SkeletonJoint) => toPixels(sample, joint, width, height);
  const radius = sample.skeleton.thickness / 2 * sample.pixelScale.y;
  const head = at('head');
  let distance = Math.hypot(point.x - head.x, point.y - head.y) - sample.skeleton.headRadius * sample.pixelScale.y;
  for (const [from, to] of SKELETON_SEGMENTS) {
    const a = at(SKELETON_JOINTS[from]), b = at(SKELETON_JOINTS[to]);
    distance = Math.min(distance, segmentDistance(point.x, point.y, a.x, a.y, b.x, b.y) - radius);
  }
  return distance;
}

function listFigures(): Figure[] {
  return useTimelineStore.getState().clips.flatMap(clip => clip.effects
    .filter(effect => effect.type === STICK_FIGURE_EFFECT && effect.enabled !== false)
    .map(effect => ({ ref: stickFigureRef(clip.id, effect.id), name: clip.name, clipId: clip.id, start: clip.startTime,
      end: clip.startTime + clip.duration, actions: parseSkeletonActions(effect.params.actions) })));
}

/**
 * Check every Stick Figure of the open timeline for choreography mistakes: feet below their
 * ground, strikes that miss everybody, joints that pop between frames, actions that overlap beyond
 * their blend, and bodies that pass through each other. Lasting problems are reported once per run.
 */
export function validateChoreography(options: ChoreographyOptions = {}): ChoreographyIssue[] {
  const figures = listFigures();
  if (!figures.length) return [];
  const { width, height } = stickFigureFrameSize();
  const fps = Math.max(1, Math.min(120, options.fps ?? 30));
  const start = Math.max(options.start ?? Math.min(...figures.map(figure => figure.start)), 0);
  const end = Math.min(options.end ?? Math.max(...figures.map(figure => figure.end)), start + 600);
  // Authored strikes snap ~50° per frame at 30 fps; a pop (flip, wrong key) is far beyond that.
  const maxTurn = (options.maxDegreesPerSecond ?? 2250) / fps;
  const hitDistance = (options.hitDistance ?? 30) * height / 1080;
  const issues: ChoreographyIssue[] = [];
  const open = new Map<string, ChoreographyIssue>();
  const report = (key: string, active: boolean, time: number, make: () => ChoreographyIssue) => {
    const running = open.get(key);
    if (active && !running) { const issue = make(); open.set(key, issue); issues.push(issue); }
    else if (active && running) running.endTime = time;
    else if (!active && running) open.delete(key);
  };

  for (const figure of figures) {
    for (let index = 1; index < figure.actions.length; index++) {
      const previous = figure.actions[index - 1], next = figure.actions[index];
      const overlap = previous.start + previous.duration - next.start;
      const allowed = Math.max(SKELETON_ACTIONS[previous.action].blend, SKELETON_ACTIONS[next.action].blend) + 0.05;
      if (overlap > allowed) {
        issues.push({ kind: 'action-overlap', figure: figure.ref, figureName: figure.name, time: figure.start + next.start,
          detail: `${SKELETON_ACTIONS[previous.action].label} and ${SKELETON_ACTIONS[next.action].label} overlap by ${overlap.toFixed(2)} s.` });
      }
    }
  }

  const sampleAt = (figure: Figure, time: number) => {
    try { return sampleStickFigurePose(figure.ref, time); } catch { return null; }
  };
  const previous = new Map<string, StickFigurePoseSample>();
  const frames = Math.min(Math.ceil((end - start) * fps), 36000);
  for (let frame = 0; frame <= frames; frame++) {
    const time = start + frame / fps;
    const samples = new Map<string, StickFigurePoseSample>();
    for (const figure of figures) {
      if (time < figure.start || time > figure.end) continue;
      const sample = sampleAt(figure, time);
      if (sample) samples.set(figure.ref, sample);
    }
    for (const figure of figures) {
      const sample = samples.get(figure.ref);
      if (!sample) { previous.delete(figure.ref); continue; }
      report(`ground:${figure.ref}`, sample.groundPenetration > 2, time, () => ({ kind: 'foot-in-ground', figure: figure.ref,
        figureName: figure.name, time, detail: `The figure reaches ${sample.groundPenetration.toFixed(0)} px below its ground.` }));
      const before = previous.get(figure.ref);
      if (before) {
        for (const key of SKELETON_ANGLE_KEYS) {
          const turn = Math.abs(((sample.skeleton[key] - before.skeleton[key]) % 360 + 540) % 360 - 180);
          report(`turn:${figure.ref}:${key}`, turn > maxTurn, time, () => ({ kind: 'rotation-jump', figure: figure.ref,
            figureName: figure.name, time, detail: `${key} turns ${turn.toFixed(0)}° in one frame.` }));
        }
      }
      previous.set(figure.ref, sample);
      for (const other of figures) {
        if (other.ref <= figure.ref) continue;
        const otherSample = samples.get(other.ref);
        if (!otherSample) continue;
        const pelvis = toPixels(sample, 'pelvis', width, height), neck = toPixels(sample, 'neck', width, height);
        const a = toPixels(otherSample, 'pelvis', width, height), b = toPixels(otherSample, 'neck', width, height);
        const radius = sample.skeleton.thickness / 2 * sample.pixelScale.y + otherSample.skeleton.thickness / 2 * otherSample.pixelScale.y;
        const close = Math.min(segmentDistance(pelvis.x, pelvis.y, a.x, a.y, b.x, b.y), segmentDistance(neck.x, neck.y, a.x, a.y, b.x, b.y)) < radius;
        report(`body:${figure.ref}:${other.ref}`, close, time, () => ({ kind: 'body-overlap', figure: figure.ref,
          figureName: figure.name, time, detail: `Torso passes through ${other.name}.` }));
      }
    }
  }

  // Contacts: does the striking hand or foot reach a body (or its target) at the moment of impact?
  for (const figure of figures) {
    for (const instance of figure.actions) {
      const limb = SKELETON_ACTIONS[instance.action].limb;
      const contact = skeletonActionContact(instance);
      if (!limb || contact === undefined || instance.action === 'throw') continue;
      const time = figure.start + contact;
      const sample = sampleAt(figure, time);
      if (!sample) continue;
      const strike = toPixels(sample, limbJoint(limb), width, height);
      let nearest = Infinity, nearestName = '';
      for (const other of figures) {
        if (other.ref === figure.ref || time < other.start || time > other.end) continue;
        const otherSample = sampleAt(other, time);
        if (!otherSample) continue;
        const distance = instance.target?.figure === other.ref
          ? Math.hypot(strike.x - toPixels(otherSample, instance.target.joint, width, height).x,
            strike.y - toPixels(otherSample, instance.target.joint, width, height).y)
          : bodyDistance(strike, otherSample, width, height);
        if (distance < nearest) { nearest = distance; nearestName = other.name; }
      }
      if (nearest === Infinity || nearest <= hitDistance) continue;
      issues.push({ kind: 'missed-contact', figure: figure.ref, figureName: figure.name, time,
        detail: `${SKELETON_ACTIONS[instance.action].label} misses ${nearestName} by ${Math.round(nearest)} px.` });
    }
  }
  return issues.sort((a, b) => a.time - b.time);
}
