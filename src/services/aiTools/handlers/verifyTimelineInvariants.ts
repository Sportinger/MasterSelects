import type { useTimelineStore } from '../../../stores/timeline';
import {
  evaluateChecks,
  type TimelineObjectKind,
  type TimelineValidationCheck,
  type TimelineValidationResult,
} from '../../validationCore';
import type { ToolResult } from '../types';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

const DEFAULT_TIMELINE_INVARIANT_CHECKS: readonly TimelineValidationCheck[] = [
  { check: 'noGaps' },
  { check: 'noOverlaps' },
  { check: 'sourceOrderMonotonic' },
  { check: 'avLinkAlignment' },
];

const OBJECT_KINDS = new Set<TimelineObjectKind>([
  'clip',
  'clips',
  'track',
  'tracks',
]);

interface ValidationRequest {
  check?: unknown;
  args?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseOptionalArgs(
  value: unknown,
  allowedKeys: readonly string[],
): Record<string, unknown> | null {
  if (value === undefined) return {};
  if (!isRecord(value) || !hasOnlyKeys(value, allowedKeys)) return null;
  return value;
}

function parseCheck(request: unknown): TimelineValidationCheck | string {
  if (!isRecord(request) || !hasOnlyKeys(request, ['check', 'args'])) {
    return 'Each validation check must be an object containing only "check" and optional "args"';
  }

  const { check, args: rawArgs } = request as ValidationRequest;
  if (typeof check !== 'string') {
    return 'Each validation check must have a string "check" id';
  }

  switch (check) {
    case 'objectCount': {
      const args = parseOptionalArgs(rawArgs, ['kind', 'expected']);
      if (!args || !OBJECT_KINDS.has(args.kind as TimelineObjectKind)) {
        return 'objectCount requires args.kind to be clip, clips, track, or tracks';
      }
      if (!Number.isInteger(args.expected) || (args.expected as number) < 0) {
        return 'objectCount requires args.expected to be a non-negative integer';
      }
      return {
        check,
        kind: args.kind as TimelineObjectKind,
        expected: args.expected as number,
      };
    }
    case 'noGaps':
    case 'noOverlaps':
    case 'avLinkAlignment': {
      if (!parseOptionalArgs(rawArgs, [])) {
        return `${check} does not accept check arguments`;
      }
      return { check };
    }
    case 'sourceOrderMonotonic': {
      const args = parseOptionalArgs(rawArgs, ['trackId']);
      if (!args) return 'sourceOrderMonotonic accepts only args.trackId';
      if (
        args.trackId !== undefined
        && (typeof args.trackId !== 'string' || args.trackId.length === 0)
      ) {
        return 'sourceOrderMonotonic args.trackId must be a non-empty string';
      }
      return args.trackId === undefined
        ? { check }
        : { check, trackId: args.trackId as string };
    }
    case 'occupiedEnd': {
      const args = parseOptionalArgs(rawArgs, ['expected', 'tolerance']);
      if (!args || typeof args.expected !== 'number' || !Number.isFinite(args.expected)) {
        return 'occupiedEnd requires a finite number in args.expected';
      }
      if (args.expected < 0) {
        return 'occupiedEnd args.expected must be non-negative';
      }
      if (
        args.tolerance !== undefined
        && (
          typeof args.tolerance !== 'number'
          || !Number.isFinite(args.tolerance)
          || args.tolerance < 0
        )
      ) {
        return 'occupiedEnd args.tolerance must be a non-negative finite number';
      }
      return args.tolerance === undefined
        ? { check, expected: args.expected }
        : { check, expected: args.expected, tolerance: args.tolerance as number };
    }
    default:
      return `Unknown validation check: ${check}`;
  }
}

function describeResult(result: TimelineValidationResult): string {
  return `${result.check}: expected ${String(result.expected)}, actual ${String(result.actual)}`;
}

export async function handleVerifyTimelineInvariants(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  let checks: readonly TimelineValidationCheck[] = DEFAULT_TIMELINE_INVARIANT_CHECKS;

  if (args.checks !== undefined) {
    if (!Array.isArray(args.checks) || args.checks.length === 0) {
      return {
        success: false,
        error: 'checks must be a non-empty array when provided',
      };
    }

    const parsedChecks: TimelineValidationCheck[] = [];
    for (const request of args.checks) {
      const parsed = parseCheck(request);
      if (typeof parsed === 'string') {
        return { success: false, error: parsed };
      }
      parsedChecks.push(parsed);
    }
    checks = parsedChecks;
  }

  const results = evaluateChecks(checks, {
    clips: timelineStore.clips,
    tracks: timelineStore.tracks,
  }).map((result) => ({
    ...result,
    detail: describeResult(result),
  }));

  return {
    success: true,
    data: {
      passed: results.every((result) => result.passed),
      results,
    },
  };
}
