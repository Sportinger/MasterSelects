import type { CommonsSourceAsset } from './contracts';
import { importSelectedCommonsAsset } from './commonsClient';

export const MAX_SEEDANCE_GENERATION_REFERENCES = 14;
const COMMONS_IMPORT_CONCURRENCY = 2;

export function selectSeedanceGenerationAssets(
  assets: readonly CommonsSourceAsset[],
  maximum = MAX_SEEDANCE_GENERATION_REFERENCES,
): CommonsSourceAsset[] {
  if (maximum <= 0) return [];
  const groups = new Map<string, CommonsSourceAsset[]>();
  for (const asset of assets) {
    if (!asset.selected) continue;
    const key = asset.sceneIds[0] ?? asset.requirementId;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }

  const orderedGroups = [...groups.values()].map((group) => group.toSorted((left, right) => (
    Number(Boolean(right.mediaFileId)) - Number(Boolean(left.mediaFileId))
  )));
  const selected: CommonsSourceAsset[] = [];
  for (let round = 0; selected.length < maximum; round += 1) {
    let added = false;
    for (const group of orderedGroups) {
      const asset = group[round];
      if (!asset) continue;
      selected.push(asset);
      added = true;
      if (selected.length === maximum) break;
    }
    if (!added) break;
  }
  return selected;
}

export async function importSeedanceGenerationAssets(
  assets: readonly CommonsSourceAsset[],
  signal: AbortSignal,
): Promise<CommonsSourceAsset[]> {
  const imported: Array<CommonsSourceAsset | undefined> = Array.from({ length: assets.length });
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < assets.length) {
      const index = nextIndex;
      nextIndex += 1;
      const asset = assets[index];
      if (!asset) continue;
      signal.throwIfAborted();
      try {
        imported[index] = await importSelectedCommonsAsset(asset, signal);
      } catch {
        if (signal.aborted) throw signal.reason;
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(COMMONS_IMPORT_CONCURRENCY, assets.length) },
    () => worker(),
  ));
  return imported.filter((asset): asset is CommonsSourceAsset => Boolean(asset));
}
