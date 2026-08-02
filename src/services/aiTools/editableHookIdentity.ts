import type {
  EditableHookLayerMetadata,
  TimelineClip,
  TimelineTrack,
} from '../../types/timeline';

const HOOK_ID_PATTERN = /^hook-[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const TEXT_ROW_NAME_PATTERN = /^Hook\s+(\d+)\s*:/i;
const BACKGROUND_ROW_NAME_PATTERN = /^Hook\s+(\d+)\s+Background$/i;

function inferredRole(clip: TimelineClip): EditableHookLayerMetadata['role'] | undefined {
  if (clip.textProperties) return 'text';
  if (clip.motion?.shape?.primitive === 'rectangle') return 'background';
  return undefined;
}

function namedRow(clip: TimelineClip, role: EditableHookLayerMetadata['role']): number | undefined {
  const match = role === 'text'
    ? TEXT_ROW_NAME_PATTERN.exec(clip.name)
    : BACKGROUND_ROW_NAME_PATTERN.exec(clip.name);
  if (!match) return undefined;
  const oneBasedRow = Number(match[1]);
  return Number.isInteger(oneBasedRow) && oneBasedRow > 0 ? oneBasedRow - 1 : undefined;
}

function isValidMetadata(value: TimelineClip['editableHook']): value is EditableHookLayerMetadata {
  return value !== undefined
    && HOOK_ID_PATTERN.test(value.id)
    && Number.isInteger(value.rowIndex)
    && value.rowIndex >= 0
    && (value.role === 'text' || value.role === 'background');
}

function stableLegacyHash(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function legacyHookId(clips: readonly TimelineClip[]): string {
  const identity = clips.map((clip) => clip.id).sort().join('\u001f');
  return `hook-legacy-${stableLegacyHash(identity, 0x811c9dc5)}${stableLegacyHash(
    [...identity].reverse().join(''),
    0x9e3779b9,
  )}`;
}

function timingKey(clip: TimelineClip): string {
  return `${clip.startTime.toFixed(6)}:${clip.duration.toFixed(6)}`;
}

function compareTextRows(
  trackOrder: ReadonlyMap<string, number>,
  left: TimelineClip,
  right: TimelineClip,
): number {
  return (left.textProperties?.boxY ?? Number.MAX_SAFE_INTEGER)
    - (right.textProperties?.boxY ?? Number.MAX_SAFE_INTEGER)
    || (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER)
    - (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id);
}

/**
 * Early hook versions could leave the stable linked group only on native
 * backplates. Recover their time-aligned text rows when the match is exact so
 * one missing text-side metadata field cannot make an otherwise intact hook
 * uneditable. Ambiguous timing groups remain untouched.
 */
function recoverTextRowsFromLinkedBackplates(
  clips: readonly TimelineClip[],
  trackOrder: ReadonlyMap<string, number>,
  result: Map<string, EditableHookLayerMetadata>,
): void {
  const hookIds = new Set([...result.values()].map((identity) => identity.id));
  for (const hookId of hookIds) {
    const backgroundTimingKeys = new Set(clips.flatMap((clip) => {
      const identity = result.get(clip.id);
      return identity?.id === hookId && identity.role === 'background'
        ? [timingKey(clip)]
        : [];
    }));
    for (const key of backgroundTimingKeys) {
      const backgrounds = clips.filter((clip) => {
        const identity = result.get(clip.id);
        return identity?.id === hookId
          && identity.role === 'background'
          && timingKey(clip) === key;
      });
      const rowIndexes = backgrounds
        .map((clip) => result.get(clip.id)!.rowIndex)
        .sort((left, right) => left - right);
      if (
        rowIndexes.length === 0
        || new Set(rowIndexes).size !== rowIndexes.length
        || rowIndexes.some((rowIndex, index) => rowIndex !== index)
      ) {
        continue;
      }

      const occupiedTextRows = new Set(clips.flatMap((clip) => {
        const identity = result.get(clip.id);
        return identity?.id === hookId
          && identity.role === 'text'
          && timingKey(clip) === key
          ? [identity.rowIndex]
          : [];
      }));
      const missingRows = rowIndexes.filter((rowIndex) => !occupiedTextRows.has(rowIndex));
      if (missingRows.length === 0) continue;

      const candidates = clips.filter((clip) => (
        !result.has(clip.id)
        && inferredRole(clip) === 'text'
        && timingKey(clip) === key
      ));
      if (candidates.length !== missingRows.length) continue;

      const namedCandidates = new Map<number, TimelineClip>();
      const unnamedCandidates: TimelineClip[] = [];
      let ambiguous = false;
      for (const clip of candidates) {
        const rowIndex = namedRow(clip, 'text');
        if (rowIndex === undefined) {
          unnamedCandidates.push(clip);
        } else if (!missingRows.includes(rowIndex) || namedCandidates.has(rowIndex)) {
          ambiguous = true;
          break;
        } else {
          namedCandidates.set(rowIndex, clip);
        }
      }
      if (ambiguous) continue;

      const availableRows = missingRows.filter((rowIndex) => !namedCandidates.has(rowIndex));
      unnamedCandidates.sort((left, right) => compareTextRows(trackOrder, left, right));
      if (unnamedCandidates.length !== availableRows.length) continue;
      for (const [rowIndex, clip] of namedCandidates) {
        result.set(clip.id, { id: hookId, role: 'text', rowIndex });
      }
      for (const [index, clip] of unnamedCandidates.entries()) {
        result.set(clip.id, { id: hookId, role: 'text', rowIndex: availableRows[index]! });
      }
    }
  }
}

/**
 * Resolves durable editable-hook layer identities and recognizes hook layers
 * created by the first hook implementation, which only stored a linked group.
 * Name-based recovery is deliberately strict and only accepts complete pairs.
 * Legacy text names may have been replaced by later text edits, so named
 * backplates are the stable anchor and unnamed text rows are paired by their
 * visual/track order when the timing group has an exact one-to-one match.
 */
export function resolveEditableHookLayerMetadata(
  clips: readonly TimelineClip[],
  tracks: readonly Pick<TimelineTrack, 'id'>[],
): ReadonlyMap<string, EditableHookLayerMetadata> {
  const result = new Map<string, EditableHookLayerMetadata>();
  const trackOrder = new Map(tracks.map((track, index) => [track.id, index]));

  for (const clip of clips) {
    if (isValidMetadata(clip.editableHook)) result.set(clip.id, clip.editableHook);
  }

  const linkedGroups = new Map<string, TimelineClip[]>();
  for (const clip of clips) {
    if (result.has(clip.id)) continue;
    const hookId = clip.linkedGroupId;
    if (typeof hookId !== 'string' || !HOOK_ID_PATTERN.test(hookId)) continue;
    const role = inferredRole(clip);
    if (!role) continue;
    const group = linkedGroups.get(hookId) ?? [];
    group.push(clip);
    linkedGroups.set(hookId, group);
  }
  for (const [hookId, group] of linkedGroups) {
    for (const role of ['text', 'background'] as const) {
      const roleClips = group
        .filter((clip) => inferredRole(clip) === role)
        .sort((left, right) => (
          (namedRow(left, role) ?? Number.MAX_SAFE_INTEGER)
          - (namedRow(right, role) ?? Number.MAX_SAFE_INTEGER)
          || (trackOrder.get(left.trackId) ?? Number.MAX_SAFE_INTEGER)
          - (trackOrder.get(right.trackId) ?? Number.MAX_SAFE_INTEGER)
          || left.id.localeCompare(right.id)
        ));
      for (const [index, clip] of roleClips.entries()) {
        result.set(clip.id, { id: hookId, role, rowIndex: namedRow(clip, role) ?? index });
      }
    }
  }

  recoverTextRowsFromLinkedBackplates(clips, trackOrder, result);

  const legacyTimingGroups = new Map<string, TimelineClip[]>();
  for (const clip of clips) {
    if (result.has(clip.id)) continue;
    const role = inferredRole(clip);
    if (!role) continue;
    const key = timingKey(clip);
    const group = legacyTimingGroups.get(key) ?? [];
    group.push(clip);
    legacyTimingGroups.set(key, group);
  }
  for (const group of legacyTimingGroups.values()) {
    const backgroundsByRow = new Map<number, TimelineClip>();
    let ambiguous = false;
    for (const clip of group.filter((candidate) => inferredRole(candidate) === 'background')) {
      const rowIndex = namedRow(clip, 'background');
      if (rowIndex === undefined) continue;
      if (backgroundsByRow.has(rowIndex)) {
        ambiguous = true;
        break;
      }
      backgroundsByRow.set(rowIndex, clip);
    }
    const rowIndexes = [...backgroundsByRow.keys()].sort((left, right) => left - right);
    const textClips = group.filter((clip) => inferredRole(clip) === 'text');
    if (
      ambiguous
      || rowIndexes.length === 0
      || rowIndexes.some((rowIndex, index) => rowIndex !== index)
      || textClips.length !== rowIndexes.length
    ) {
      continue;
    }

    const textsByRow = new Map<number, TimelineClip>();
    const unnamedTexts: TimelineClip[] = [];
    for (const clip of textClips) {
      const rowIndex = namedRow(clip, 'text');
      if (rowIndex === undefined) {
        unnamedTexts.push(clip);
        continue;
      }
      if (!backgroundsByRow.has(rowIndex) || textsByRow.has(rowIndex)) {
        ambiguous = true;
        break;
      }
      textsByRow.set(rowIndex, clip);
    }
    if (ambiguous) continue;

    const availableRows = rowIndexes.filter((rowIndex) => !textsByRow.has(rowIndex));
    unnamedTexts.sort((left, right) => compareTextRows(trackOrder, left, right));
    if (unnamedTexts.length !== availableRows.length) continue;
    for (const [index, clip] of unnamedTexts.entries()) {
      textsByRow.set(availableRows[index]!, clip);
    }

    const matchedClips = rowIndexes.flatMap((rowIndex) => [
      textsByRow.get(rowIndex)!,
      backgroundsByRow.get(rowIndex)!,
    ]);
    const hookId = legacyHookId(matchedClips);
    for (const rowIndex of rowIndexes) {
      result.set(textsByRow.get(rowIndex)!.id, { id: hookId, role: 'text', rowIndex });
      result.set(backgroundsByRow.get(rowIndex)!.id, { id: hookId, role: 'background', rowIndex });
    }
  }

  return result;
}
