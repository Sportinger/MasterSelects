import type {
  Rive,
  ViewModel,
  ViewModelInstance,
} from '@rive-app/canvas';

import type {
  VectorAnimationDataBindingProperty,
  VectorAnimationDataBindingType,
  VectorAnimationDataBindingValue,
  VectorAnimationMetadata,
  VectorAnimationStateMachineInput,
} from '../../types/vectorAnimation';
import { Logger } from '../logger';
import type { PreparedRiveAsset } from './types';

const log = Logger.create('RiveMetadata');

const preparedAssetCache = new Map<string, Promise<PreparedRiveAsset>>();
type RiveModule = typeof import('@rive-app/canvas');
type RiveConstructor = RiveModule['Rive'];
type RiveDataType = RiveModule['DataType'];
type RiveStateMachineInputType = RiveModule['StateMachineInputType'];
let riveModulePromise: Promise<RiveModule> | null = null;

function loadRiveModule(): Promise<RiveModule> {
  riveModulePromise ??= import('@rive-app/canvas');
  return riveModulePromise;
}

function getAssetCacheKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function createMetadataCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  return canvas;
}

function waitForRiveLoad(params: ConstructorParameters<RiveConstructor>[0], RiveConstructor: RiveConstructor): Promise<Rive> {
  let player: Rive | null = null;

  return new Promise<Rive>((resolve, reject) => {
    try {
      player = new RiveConstructor({
        ...params,
        onLoad: () => {
          if (player) {
            resolve(player);
          }
        },
        onLoadError: (event) => {
          reject(event.data instanceof Error ? event.data : new Error('Failed to load Rive asset'));
        },
      });
    } catch (error) {
      reject(error);
    }
  });
}

function normalizeStateMachineInput(input: {
  name: string;
  type: number;
  initialValue?: boolean | number;
}, StateMachineInputType: RiveStateMachineInputType): VectorAnimationStateMachineInput | null {
  if (!input.name.trim()) {
    return null;
  }

  if (input.type === StateMachineInputType.Boolean) {
    return {
      name: input.name,
      type: 'boolean',
      defaultValue: typeof input.initialValue === 'boolean' ? input.initialValue : Boolean(input.initialValue),
    };
  }

  if (input.type === StateMachineInputType.Number) {
    return {
      name: input.name,
      type: 'number',
      defaultValue: typeof input.initialValue === 'number' && Number.isFinite(input.initialValue)
        ? input.initialValue
        : 0,
    };
  }

  if (input.type === StateMachineInputType.Trigger) {
    return {
      name: input.name,
      type: 'trigger',
    };
  }

  return null;
}

function mapDataBindingType(type: unknown, DataType: RiveDataType): VectorAnimationDataBindingType | null {
  if (type === DataType.boolean) return 'boolean';
  if (type === DataType.number) return 'number';
  if (type === DataType.integer || type === DataType.listIndex) return 'integer';
  if (type === DataType.string) return 'string';
  if (type === DataType.color) return 'color';
  if (type === DataType.enumType) return 'enum';
  if (type === DataType.trigger) return 'trigger';
  return null;
}

function getDataBindingDefaultValue(
  instance: ViewModelInstance | null,
  propertyName: string,
  type: VectorAnimationDataBindingType,
): { value?: VectorAnimationDataBindingValue; values?: string[] } {
  if (!instance) {
    return {};
  }

  try {
    if (type === 'boolean') {
      return { value: instance.boolean(propertyName)?.value };
    }
    if (type === 'number' || type === 'integer') {
      return { value: instance.number(propertyName)?.value };
    }
    if (type === 'string') {
      return { value: instance.string(propertyName)?.value };
    }
    if (type === 'color') {
      return { value: instance.color(propertyName)?.value };
    }
    if (type === 'enum') {
      const enumValue = instance.enum(propertyName);
      return {
        value: enumValue?.value,
        values: enumValue?.values,
      };
    }
  } catch (error) {
    log.debug('Failed to read Rive data binding default', { propertyName, type, error });
  }

  return {};
}

function readViewModelMetadata(viewModel: ViewModel, DataType: RiveDataType): {
  name: string;
  instanceNames?: string[];
  properties: VectorAnimationDataBindingProperty[];
} {
  const instance = viewModel.defaultInstance() ?? viewModel.instance();

  try {
    const properties = viewModel.properties
      .map((property): VectorAnimationDataBindingProperty | null => {
        const type = mapDataBindingType(property.type, DataType);
        if (!type || !property.name.trim()) {
          return null;
        }

        const defaults = getDataBindingDefaultValue(instance, property.name, type);
        return {
          name: property.name,
          type,
          viewModelName: viewModel.name,
          ...(defaults.value !== undefined ? { defaultValue: defaults.value } : {}),
          ...(defaults.values && defaults.values.length > 0 ? { values: defaults.values } : {}),
        };
      })
      .filter((property): property is VectorAnimationDataBindingProperty => Boolean(property))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      name: viewModel.name,
      instanceNames: viewModel.instanceNames.length > 0 ? viewModel.instanceNames : undefined,
      properties,
    };
  } finally {
    instance?.cleanup();
  }
}

function buildMetadata(player: Rive, riveModule: RiveModule): VectorAnimationMetadata {
  const { DataType, StateMachineInputType } = riveModule;
  const contents = player.contents;
  const artboards = contents.artboards ?? [];
  const activeArtboardName = player.activeArtboard;
  const activeArtboard =
    artboards.find((artboard) => artboard.name === activeArtboardName) ??
    artboards[0];

  const stateMachineNames = activeArtboard?.stateMachines.map((stateMachine) => stateMachine.name) ?? player.stateMachineNames;
  const stateMachineInputs: Record<string, VectorAnimationStateMachineInput[]> = {};
  activeArtboard?.stateMachines.forEach((stateMachine) => {
    const inputs = stateMachine.inputs
      .map((input) => normalizeStateMachineInput(input, StateMachineInputType))
      .filter((input): input is VectorAnimationStateMachineInput => Boolean(input))
      .sort((a, b) => a.name.localeCompare(b.name));
    if (inputs.length > 0) {
      stateMachineInputs[stateMachine.name] = inputs;
    }
  });

  const viewModels = Array.from({ length: player.viewModelCount }, (_, index) => player.viewModelByIndex(index))
    .filter((viewModel): viewModel is ViewModel => Boolean(viewModel))
    .map((viewModel) => readViewModelMetadata(viewModel, DataType))
    .filter((viewModel) => viewModel.properties.length > 0);
  const defaultViewModelName = player.defaultViewModel()?.name;
  const dataBindingProperties = viewModels.flatMap((viewModel) => viewModel.properties);

  const duration = player.durations.find((candidate) => Number.isFinite(candidate) && candidate > 0);
  const fps = Number.isFinite(player.fps) && player.fps > 0 ? player.fps : undefined;

  return {
    provider: 'rive',
    width: player.artboardWidth || undefined,
    height: player.artboardHeight || undefined,
    fps,
    duration,
    animationNames: activeArtboard?.animations.length ? activeArtboard.animations : player.animationNames,
    defaultAnimationName: activeArtboard?.animations[0] ?? player.animationNames[0],
    artboardNames: artboards.map((artboard) => artboard.name).filter(Boolean),
    stateMachineNames: stateMachineNames.length > 0 ? stateMachineNames : undefined,
    stateMachineInputs: Object.keys(stateMachineInputs).length > 0 ? stateMachineInputs : undefined,
    viewModelNames: viewModels.map((viewModel) => viewModel.name),
    defaultViewModelName,
    viewModels: viewModels.length > 0 ? viewModels : undefined,
    dataBindingProperties: dataBindingProperties.length > 0 ? dataBindingProperties : undefined,
  };
}

async function readRiveMetadataFromBuffer(buffer: ArrayBuffer): Promise<VectorAnimationMetadata> {
  const riveModule = await loadRiveModule();
  const canvas = createMetadataCanvas();
  const player = await waitForRiveLoad({
    canvas,
    buffer: buffer.slice(0),
    autoplay: false,
    autoBind: false,
    enableRiveAssetCDN: true,
    shouldDisableRiveListeners: true,
    automaticallyHandleEvents: false,
  }, riveModule.Rive);

  try {
    player.pause();
    return buildMetadata(player, riveModule);
  } finally {
    player.cleanup();
  }
}

async function prepareRiveAssetInternal(file: File): Promise<PreparedRiveAsset> {
  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith('.riv')) {
    throw new Error(`Unsupported Rive file: ${file.name}`);
  }

  const buffer = await file.arrayBuffer();
  return {
    metadata: await readRiveMetadataFromBuffer(buffer),
    payload: {
      data: buffer,
      sourceKey: getAssetCacheKey(file),
    },
  };
}

export async function prepareRiveAsset(file: File): Promise<PreparedRiveAsset> {
  const cacheKey = getAssetCacheKey(file);
  const existing = preparedAssetCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const promise = prepareRiveAssetInternal(file).catch((error) => {
    preparedAssetCache.delete(cacheKey);
    log.warn('Failed to prepare Rive asset', { file: file.name, error });
    throw error;
  });

  preparedAssetCache.set(cacheKey, promise);
  return promise;
}

export async function readRiveMetadata(file: File): Promise<VectorAnimationMetadata> {
  return (await prepareRiveAsset(file)).metadata;
}
