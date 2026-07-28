import type { executeAIToolCalls } from '../aiTools';
import { Logger } from '../logger';

type ExecuteToolCalls = typeof executeAIToolCalls;

const log = Logger.create('KernelGateway');

export interface ExecutionTrackInfo {
  id: string;
  type: 'video' | 'audio';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseExecutionTracks(state: unknown): ExecutionTrackInfo[] {
  if (!isRecord(state)) {
    return [];
  }
  const collect = (value: unknown, type: 'video' | 'audio'): ExecutionTrackInfo[] => (
    Array.isArray(value)
      ? value.flatMap((track) => (
          isRecord(track) && typeof track.id === 'string' ? [{ id: track.id, type }] : []
        ))
      : []
  );
  return [
    ...collect(state.videoTracks, 'video'),
    ...collect(state.audioTracks, 'audio'),
  ];
}

export interface ExecutionIdBinding {
  bindArgs: (tool: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  observeResult: (tool: string, data: unknown) => void;
}

export interface ExecutionIdBindingOptions {
  executeToolCalls: ExecuteToolCalls;
  sourceSnapshot: unknown;
  simulatedVideoClipIds?: string[];
}

// Only placement tools may receive a simulated/source track id. Binding a
// destructive tool such as deleteTrack could target an unrelated live track.
const TRACK_BINDING_TOOLS = new Set(['addClipSegment']);

// Runtime id binding for kernel plans (plan §7.1): resolved calls reference
// simulated segment ids and source-timeline track ids that do not exist in
// the timeline the calls actually run in (e.g. a setup-created composition).
// Both id families are bound to live store ids at execution time.
export function createExecutionIdBinding(
  options: ExecutionIdBindingOptions,
): ExecutionIdBinding {
  const { executeToolCalls, sourceSnapshot, simulatedVideoClipIds } = options;
  const sourceTracks = parseExecutionTracks(sourceSnapshot);
  let simulatedToReal: Map<string, string> | undefined;

  const readCurrentTracks = async (): Promise<ExecutionTrackInfo[]> => {
    const [execution] = await executeToolCalls(
      [{ id: 'kernel-track-binding-state', tool: 'getTimelineState', args: {} }],
      'chat',
      { guidedReplay: false, suppressHistory: true },
    );
    return execution?.result.success === true
      ? parseExecutionTracks(execution.result.data)
      : [];
  };

  const mapId = (id: string): string => simulatedToReal?.get(id) ?? id;

  const mapSimulatedIds = (args: Record<string, unknown>): Record<string, unknown> => {
    if (!simulatedToReal) {
      return args;
    }
    const mapped: Record<string, unknown> = { ...args };
    for (const [key, value] of Object.entries(mapped)) {
      if (typeof value === 'string') {
        mapped[key] = mapId(value);
      } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
        mapped[key] = value.map(mapId);
      }
    }
    return mapped;
  };

  const resolveTrackId = async (
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    if (!('trackId' in args)) {
      return args;
    }
    const requested = args.trackId;
    const tracks = await readCurrentTracks();
    if (typeof requested === 'string' && tracks.some((track) => track.id === requested)) {
      return args;
    }
    const requestedType = typeof requested === 'string'
      ? sourceTracks.find((track) => track.id === requested)?.type ?? 'video'
      : 'video';
    const target = tracks.find((track) => track.type === requestedType);
    if (!target) {
      return args;
    }
    log.info('kernel call track id bound at execution time', {
      requested: typeof requested === 'string' ? requested : null,
      resolved: target.id,
      type: requestedType,
    });
    return { ...args, trackId: target.id };
  };

  return {
    bindArgs: async (tool, args) => {
      const mappedArgs = mapSimulatedIds(args);
      if (!TRACK_BINDING_TOOLS.has(tool)) {
        return 'trackId' in args ? { ...mappedArgs, trackId: args.trackId } : mappedArgs;
      }
      return resolveTrackId(mappedArgs);
    },
    observeResult: (_tool, data) => {
      if (!simulatedVideoClipIds || simulatedToReal || !isRecord(data)) {
        return;
      }
      if (!isRecord(data.segments) || !Array.isArray(data.segments.videoClipIds)) {
        return;
      }
      const realIds = data.segments.videoClipIds
        .filter((id): id is string => typeof id === 'string');
      if (realIds.length === simulatedVideoClipIds.length) {
        simulatedToReal = new Map(
          simulatedVideoClipIds.map((simulatedId, index) => [
            simulatedId,
            realIds[index] as string,
          ]),
        );
      }
    },
  };
}
