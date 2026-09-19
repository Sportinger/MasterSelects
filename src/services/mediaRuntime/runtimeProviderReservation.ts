import type { TimelineRuntimeAdmissionDecision } from '../timeline/runtimeCoordinatorTypes';
import { timelineRuntimeCoordinator } from '../timeline/timelineRuntimeCoordinator';
import { createRuntimeProviderAdmissionResources } from './runtimePlaybackPlanning';
import type {
  DecodeSessionPolicy,
  MediaSourceRuntime,
} from './types';

export type RuntimeProviderReservation =
  | {
      admitted: true;
      resourceIds: readonly string[];
      release: () => void;
    }
  | {
      admitted: false;
      decision: TimelineRuntimeAdmissionDecision;
      resourceIds: readonly string[];
      release: () => void;
    };

export function reserveRuntimeProviderResources(
  policy: DecodeSessionPolicy,
  runtime: MediaSourceRuntime,
  sessionKey: string,
  file: File,
  providerKind: 'webcodecs' | 'turbores' | 'hap',
): RuntimeProviderReservation {
  const retainedResourceIds: string[] = [];
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    for (const resourceId of retainedResourceIds) {
      timelineRuntimeCoordinator.releaseResource(resourceId);
    }
  };

  for (const resource of createRuntimeProviderAdmissionResources(
    policy,
    runtime,
    sessionKey,
    file,
    providerKind,
  )) {
    const decision = timelineRuntimeCoordinator.canRetainResource(resource);
    if (!decision.admitted) {
      release();
      return {
        admitted: false,
        decision,
        resourceIds: [],
        release,
      };
    }
    timelineRuntimeCoordinator.retainResource(resource);
    retainedResourceIds.push(resource.id);
  }

  return {
    admitted: true,
    resourceIds: retainedResourceIds,
    release,
  };
}
