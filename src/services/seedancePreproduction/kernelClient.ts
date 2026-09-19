import {
  parseSeedanceKernelResult,
  type CommonsSourceAsset,
  type SeedanceKernelResult,
  type SeedanceKeyframeBrief,
  type SeedanceMasterLook,
  type SeedanceProjectSourceEntry,
  type SeedanceStory,
  type SeedanceStoryIdea,
} from './contracts';

type SeedanceKernelRequest =
  | {
      operation: 'ingest-sources';
      input: {
        schemaVersion: 1;
        fingerprint: string;
        entries: SeedanceProjectSourceEntry[];
      };
    }
  | {
      operation: 'ideas';
      input: { prompt: string; inspiration?: SeedanceStoryIdea; sourceBundleId: string };
    }
  | {
      operation: 'story';
      input: { prompt: string; selectedIdea: SeedanceStoryIdea; sourceBundleId: string };
    }
  | {
      operation: 'asset-plan';
      input: { prompt: string; story: SeedanceStory; sourceBundleId: string };
    }
  | {
      operation: 'master-looks';
      input: { prompt: string; story: SeedanceStory; selectedAssets: CommonsSourceAsset[]; sourceBundleId: string };
    }
  | {
      operation: 'keyframes';
      input: {
        prompt: string;
        story: SeedanceStory;
        selectedAssets: CommonsSourceAsset[];
        masterLook: SeedanceMasterLook;
        sourceBundleId: string;
      };
    }
  | {
      operation: 'regenerate-keyframes';
      input: {
        prompt: string;
        story: SeedanceStory;
        selectedAssets: CommonsSourceAsset[];
        masterLook: SeedanceMasterLook;
        feedback: string;
        keyframes: SeedanceKeyframeBrief[];
        selectedKeyframeIds: string[];
        sourceBundleId: string;
      };
    };

export async function runSeedanceKernelStage(
  request: SeedanceKernelRequest,
  signal?: AbortSignal,
): Promise<SeedanceKernelResult> {
  const input = 'selectedAssets' in request.input
    ? {
        ...request.input,
        selectedAssets: request.input.selectedAssets.map((asset) => ({
          id: asset.id,
          title: asset.title,
          description: asset.description,
          creator: asset.creator,
          license: asset.license,
          sourceUrl: asset.sourceUrl,
          sceneIds: asset.sceneIds,
        })),
        ...('masterLook' in request.input
          ? {
              masterLook: {
                id: request.input.masterLook.id,
                title: request.input.masterLook.title,
                description: request.input.masterLook.description,
                prompt: request.input.masterLook.prompt,
                negativePrompt: request.input.masterLook.negativePrompt,
              },
            }
          : {}),
      }
    : request.input;
  const response = await fetch('/api/kernel/preproduction/seedance', {
    body: JSON.stringify({ operation: request.operation, input }),
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    method: 'POST',
    ...(signal === undefined ? {} : { signal }),
  });
  const payload = await response.json().catch(() => null) as unknown;
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload
      ? String((payload as { error: unknown }).error)
      : `Story workflow failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return parseSeedanceKernelResult(payload);
}
