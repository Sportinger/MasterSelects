import { FileTypeIcon } from '../FileTypeIcon';
import { handleSubmenuHover, handleSubmenuLeave } from '../submenuPosition';
import type { MeshPrimitiveType } from '../../../../stores/mediaStore/types';
import type { ShapePrimitive } from '../../../../types/motionDesign';

type MediaAddItemsMenuVariant = 'dropdown' | 'context';

export interface MediaAddItemsMenuProps {
  variant: MediaAddItemsMenuVariant;
  onClose: () => void;
  onImport: () => void;
  onNewComposition: () => void;
  onNewFolder: () => void;
  onNewText: () => void;
  onNewSolid: () => void;
  onNewLiveInput: () => void;
  onNewMesh: (meshType: MeshPrimitiveType) => void;
  onNewText3D: () => void;
  onNewCamera: () => void;
  onNewLight: () => void;
  onNewSplatEffector: () => void;
  onImportGaussianSplat: () => void;
  onNewMathScene: () => void;
  onNewMotionShape: (primitive: ShapePrimitive) => void;
}

const MESH_PRIMITIVES: readonly MeshPrimitiveType[] = ['cube', 'sphere', 'plane', 'cylinder', 'torus', 'cone'];

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function MediaAddItemsMenu({
  variant,
  onClose,
  onImport,
  onNewComposition,
  onNewFolder,
  onNewText,
  onNewSolid,
  onNewLiveInput,
  onNewMesh,
  onNewText3D,
  onNewCamera,
  onNewLight,
  onNewSplatEffector,
  onImportGaussianSplat,
  onNewMathScene,
  onNewMotionShape,
}: MediaAddItemsMenuProps) {
  const itemClass = variant === 'dropdown' ? 'add-dropdown-item' : 'context-menu-item';
  const separatorClass = variant === 'dropdown' ? 'add-dropdown-separator' : 'context-menu-separator';
  const submenuClass = variant === 'dropdown' ? 'add-dropdown-submenu' : 'context-submenu';
  const iconClass = variant === 'dropdown' ? 'add-dropdown-icon' : 'context-menu-icon';
  const hintClass = variant === 'dropdown' ? 'add-dropdown-hint' : 'context-menu-hint';

  const run = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <>
      <div className={itemClass} onClick={() => run(onNewComposition)}>
        <span className={iconClass}><FileTypeIcon type="composition" /></span>
        <span>Composition</span>
      </div>
      <div className={itemClass} onClick={() => run(onNewFolder)}>
        <span className={iconClass}><span className="media-folder-icon">&#128193;</span></span>
        <span>Folder</span>
      </div>
      <div className={itemClass} onClick={() => run(onImport)}>
        <span className={iconClass}><FileTypeIcon /></span>
        <span>Import files...</span>
      </div>
      <div className={separatorClass} />
      <div className={itemClass} onClick={() => run(onNewText)}>
        <span className={iconClass}><FileTypeIcon type="text" /></span>
        <span>Text</span>
      </div>
      <div className={itemClass} onClick={() => run(onNewSolid)}>
        <span className={iconClass}><FileTypeIcon type="solid" /></span>
        <span>Solid</span>
      </div>
      <div className={itemClass} onClick={() => run(onNewLiveInput)}>
        <span className={iconClass}><FileTypeIcon type="video" /></span>
        <span>Live Input...</span>
      </div>
      <div className={`${itemClass} has-submenu`} onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span className={iconClass}><FileTypeIcon type="mesh" /></span>
        <span>3D</span>
        <span className="submenu-arrow">&#9654;</span>
        <div className={submenuClass}>
          <div className={`${itemClass} has-submenu`} onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
            <span className={iconClass}><FileTypeIcon type="mesh" /></span>
            <span>Mesh</span>
            <span className="submenu-arrow">&#9654;</span>
            <div className={submenuClass}>
              {MESH_PRIMITIVES.map((meshType) => (
                <div key={meshType} className={itemClass} onClick={() => run(() => onNewMesh(meshType))}>
                  <span>{titleCase(meshType)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className={itemClass} onClick={() => run(onNewText3D)}>
            <span className={iconClass}><FileTypeIcon type="text-3d" /></span>
            <span>3D Text</span>
          </div>
          <div className={itemClass} onClick={() => run(onNewCamera)}>
            <span className={iconClass}><FileTypeIcon type="camera" /></span>
            <span>Camera</span>
          </div>
          <div className={itemClass} onClick={() => run(onNewLight)}>
            <span className={iconClass}><FileTypeIcon type="light" /></span>
            <span>Light</span>
          </div>
          <div className={itemClass} onClick={() => run(onNewSplatEffector)}>
            <span className={iconClass}><FileTypeIcon type="splat-effector" /></span>
            <span>3D Effector</span>
          </div>
          <div className={itemClass} onClick={() => run(onImportGaussianSplat)}>
            <span className={iconClass}><FileTypeIcon type="gaussian-splat" /></span>
            <span>Gaussian Splat</span>
          </div>
        </div>
      </div>
      <div className={separatorClass} />
      <div className={itemClass} onClick={() => run(onNewMathScene)}>
        <span className={iconClass}><FileTypeIcon type="math-scene" /></span>
        <span>Math Scene</span>
      </div>
      <div className={`${itemClass} has-submenu`} onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
        <span className={iconClass}><FileTypeIcon type="motion-shape" /></span>
        <span>Motion Shape</span>
        <span className="submenu-arrow">&#9654;</span>
        <div className={submenuClass}>
          <div className={itemClass} onClick={() => run(() => onNewMotionShape('rectangle'))}>
            <span>Rectangle</span>
          </div>
          <div className={itemClass} onClick={() => run(() => onNewMotionShape('ellipse'))}>
            <span>Ellipse</span>
          </div>
        </div>
      </div>
      <div className={separatorClass} />
      <div className={`${itemClass} disabled`} onClick={onClose}>
        <span className={iconClass}><FileTypeIcon type="solid" /></span>
        <span>Adjustment Layer</span>
        <span className={hintClass}>Coming soon</span>
      </div>
    </>
  );
}
