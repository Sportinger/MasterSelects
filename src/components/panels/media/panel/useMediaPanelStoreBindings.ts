import {
  useMediaStore,
  type CameraItem,
  type LightItem,
  type MathSceneItem,
  type MeshItem,
  type MotionShapeItem,
  type SignalAssetItem,
  type SolidItem,
  type SplatEffectorItem,
  type TextItem,
} from '../../../../stores/mediaStore';

const EMPTY_TEXT_ITEMS: TextItem[] = [];
const EMPTY_SOLID_ITEMS: SolidItem[] = [];
const EMPTY_MESH_ITEMS: MeshItem[] = [];
const EMPTY_CAMERA_ITEMS: CameraItem[] = [];
const EMPTY_LIGHT_ITEMS: LightItem[] = [];
const EMPTY_SPLAT_EFFECTOR_ITEMS: SplatEffectorItem[] = [];
const EMPTY_MATH_SCENE_ITEMS: MathSceneItem[] = [];
const EMPTY_MOTION_SHAPE_ITEMS: MotionShapeItem[] = [];
const EMPTY_SIGNAL_ASSETS: SignalAssetItem[] = [];

export function useMediaPanelStoreBindings() {
  const files = useMediaStore(state => state.files);
  const compositions = useMediaStore(state => state.compositions);
  const folders = useMediaStore(state => state.folders);
  const textItems = useMediaStore(state => state.textItems ?? EMPTY_TEXT_ITEMS);
  const solidItems = useMediaStore(state => state.solidItems ?? EMPTY_SOLID_ITEMS);
  const meshItems = useMediaStore(state => state.meshItems ?? EMPTY_MESH_ITEMS);
  const cameraItems = useMediaStore(state => state.cameraItems ?? EMPTY_CAMERA_ITEMS);
  const lightItems = useMediaStore(state => state.lightItems ?? EMPTY_LIGHT_ITEMS);
  const splatEffectorItems = useMediaStore(state => state.splatEffectorItems ?? EMPTY_SPLAT_EFFECTOR_ITEMS);
  const mathSceneItems = useMediaStore(state => state.mathSceneItems ?? EMPTY_MATH_SCENE_ITEMS);
  const motionShapeItems = useMediaStore(state => state.motionShapeItems ?? EMPTY_MOTION_SHAPE_ITEMS);
  const signalAssets = useMediaStore(state => state.signalAssets ?? EMPTY_SIGNAL_ASSETS);
  const selectedIds = useMediaStore(state => state.selectedIds);
  const duplicateMediaItems = useMediaStore(state => state.duplicateMediaItems);
  const copyMediaItems = useMediaStore(state => state.copyMediaItems);
  const pasteMediaItems = useMediaStore(state => state.pasteMediaItems);
  const hasMediaClipboard = useMediaStore(state => state.hasMediaClipboard);
  const expandedFolderIds = useMediaStore(state => state.expandedFolderIds);
  const fileSystemSupported = useMediaStore(state => state.fileSystemSupported);
  const proxyFolderName = useMediaStore(state => state.proxyFolderName);
  const activeCompositionId = useMediaStore(state => state.activeCompositionId);
  const refreshFileUrls = useMediaStore(state => state.refreshFileUrls);
  const ensureFileThumbnail = useMediaStore(state => state.ensureFileThumbnail);

  return {
    files,
    compositions,
    folders,
    textItems,
    solidItems,
    meshItems,
    cameraItems,
    lightItems,
    splatEffectorItems,
    mathSceneItems,
    motionShapeItems,
    signalAssets,
    selectedIds,
    duplicateMediaItems,
    copyMediaItems,
    pasteMediaItems,
    hasMediaClipboard,
    expandedFolderIds,
    fileSystemSupported,
    proxyFolderName,
    activeCompositionId,
    refreshFileUrls,
    ensureFileThumbnail,
  };
}
