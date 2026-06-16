import { renderHostPort } from '../../../render/renderHostPort';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { CallerContext } from '../../policy';
import { finiteNumber } from './args';
import { openComposition } from './compositionRuntime';
import { buildMainComposition } from './mainComposition';
import { prepareImportedMedia } from './mediaPreparation';
import type { FixtureBuildContext } from './model';
import { buildNestedComposition, buildSubComposition } from './subCompositions';
import { summarizeActiveComposition, summarizeClips, summarizeStoredComposition } from './summaries';
import { waitForAnimationFrame } from './timing';
import { Logger } from '../../../logger';

const log = Logger.create('AITool:StressTest');

export async function createStressTestProjectFixture(
  args: Record<string, unknown>,
  callerContext: CallerContext = 'internal'
) {
  const startedAt = performance.now();
  const resetProject = args.resetProject !== false;
  const projectName = typeof args.projectName === 'string' && args.projectName.trim()
    ? args.projectName.trim()
    : `Bridge Stress Test Fixture ${new Date().toISOString()}`;
  const durationSeconds = finiteNumber(args.durationSeconds, 6.2, 2, 30);
  const width = Math.round(finiteNumber(args.width, 1920, 64, 7680));
  const height = Math.round(finiteNumber(args.height, 1080, 64, 4320));
  const frameRate = finiteNumber(args.frameRate, 24, 1, 240);

  try {
    const mediaStore = useMediaStore.getState();
    const timelineStore = useTimelineStore.getState();
    timelineStore.pause();

    if (resetProject) {
      mediaStore.newProject();
      await timelineStore.loadState(undefined);
      await waitForAnimationFrame();
    }

    useMediaStore.getState().setProjectName(projectName);
    const preparedMedia = await prepareImportedMedia(args, callerContext);
    if (preparedMedia.errors && preparedMedia.imported.length === 0) {
      return {
        success: false,
        error: 'No stress test fixture media could be imported',
        data: { errors: preparedMedia.errors },
      };
    }

    const freshMediaStore = useMediaStore.getState();
    const mainComp = freshMediaStore.compositions.find((entry) => entry.id === freshMediaStore.activeCompositionId)
      ?? freshMediaStore.compositions[0];
    if (!mainComp) {
      throw new Error('No active composition exists after project reset');
    }

    const ctx: FixtureBuildContext = {
      primary: preparedMedia.roles['primary-motion'],
      blend: preparedMedia.roles['blend-mask'],
      detail: preparedMedia.roles['detail-nested'],
      durationSeconds,
      width,
      height,
      frameRate,
    };

    const subComp = await buildSubComposition(ctx);
    const nestedComp = await buildNestedComposition(ctx, subComp);
    const activeMainComp = await buildMainComposition(ctx, mainComp, nestedComp);
    await openComposition(activeMainComp.id);
    await waitForAnimationFrame();
    renderHostPort.requestRender();

    const finalTimeline = useTimelineStore.getState();
    const finalMedia = useMediaStore.getState();
    const activeComposition = finalMedia.compositions.find((entry) => entry.id === activeMainComp.id) ?? activeMainComp;
    const summaries = finalMedia.compositions
      .filter((composition) => [
        activeMainComp.id,
        nestedComp.id,
        subComp.id,
      ].includes(composition.id))
      .map((composition) => composition.id === activeComposition.id
        ? summarizeActiveComposition(activeComposition)
        : summarizeStoredComposition(composition));

    return {
      success: true,
      data: {
        projectName,
        elapsedMs: Math.round(performance.now() - startedAt),
        activeCompositionId: activeComposition.id,
        activeCompositionName: activeComposition.name,
        imported: preparedMedia.imported,
        importErrors: preparedMedia.errors,
        mediaRoles: {
          primaryMotion: preparedMedia.roles['primary-motion'].id,
          blendMask: preparedMedia.roles['blend-mask'].id,
          detailNested: preparedMedia.roles['detail-nested'].id,
        },
        compositionSummaries: summaries,
        timeline: {
          duration: finalTimeline.duration,
          trackCount: finalTimeline.tracks.length,
          clipCount: finalTimeline.clips.length,
          clips: summarizeClips(finalTimeline.clips),
          markers: finalTimeline.markers.map((marker) => ({
            id: marker.id,
            time: marker.time,
            label: marker.label,
            color: marker.color,
          })),
        },
      },
    };
  } catch (error) {
    log.error('Failed to create stress test fixture', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      data: {
        elapsedMs: Math.round(performance.now() - startedAt),
      },
    };
  }
}
