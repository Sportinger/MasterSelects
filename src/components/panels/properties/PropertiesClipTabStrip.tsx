import { PropertiesTabStrip } from './PropertiesTabStrip';
import {
  PropertiesTabPresentation,
  ResolveOnlyPropertiesTab,
} from './resolveInspector/ResolvePropertiesTabPresentation';
import type { ClipPropertiesPresentation, PropertiesTab } from './propertiesPanelTypes';

interface PropertiesClipTabStripProps {
  activeTab: PropertiesTab;
  onTabChange: (tab: PropertiesTab) => void;
  presentation: ClipPropertiesPresentation;
  visualEffectCount: number;
  audioEditCount: number;
  maskCount: number;
  sourceAnalysisReady: boolean;
}

function guidedTabAttributes(tab: PropertiesTab) {
  return {
    'data-guided-properties-tab': tab,
    'data-guided-target': `properties-tab:${tab}`,
  };
}

export function PropertiesClipTabStrip({
  activeTab,
  onTabChange,
  presentation,
  visualEffectCount,
  audioEditCount,
  maskCount,
  sourceAnalysisReady,
}: PropertiesClipTabStripProps) {
  const {
    isStoryboardClip,
    isAudioClip,
    isCameraClip,
    isMathSceneClip,
    isFlockClip,
    isMotionAdjustmentClip,
    isMotionShapeClip,
    isEditableHookClip,
    isCaptionClip,
    isTextClip,
    is3DTextClip,
    isVectorAnimationClip,
    vectorAnimationTabLabel,
    isModelClip,
    isGaussianAvatar,
    isGaussianSplat,
    isLightClip,
    isSplatEffectorClip,
    isSolidClip,
  } = presentation;

  return (
    <PropertiesTabStrip>
      {isStoryboardClip ? (
        <button className={`tab-btn ${activeTab === 'storyboard' ? 'active' : ''}`} onClick={() => onTabChange('storyboard')}>
          Scene
        </button>
      ) : isAudioClip ? (
        <>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'audio-edits' ? 'active' : ''}`} onClick={() => onTabChange('audio-edits')}>
            Audio Edits {audioEditCount > 0 && <span className="badge">{audioEditCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => onTabChange('analysis')}>
            Analysis
          </button>
        </>
      ) : isCameraClip ? (
        <button className={`tab-btn resolve-property-tab resolve-order-video ${activeTab === 'transform' ? 'active' : ''}`} {...guidedTabAttributes('transform')} onClick={() => onTabChange('transform')}>
          <PropertiesTabPresentation fallback="Transform" icon="video" resolveLabel="Video" />
        </button>
      ) : isFlockClip ? (
        <>
          {/* A flock draws into the shared 3D scene: only controls that affect it are offered. */}
          <button type="button" className={`tab-btn ${activeTab === 'flock' ? 'active' : ''}`} {...guidedTabAttributes('flock')} onPointerUp={e => e.currentTarget.blur()} onClick={() => onTabChange('flock')}>Flock</button>
          <button type="button" className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} {...guidedTabAttributes('transform')} onPointerUp={e => e.currentTarget.blur()} onClick={() => onTabChange('transform')}>Transform</button>
        </>
      ) : isMathSceneClip ? (
        <>
          <button className={`tab-btn ${activeTab === 'math' ? 'active' : ''}`} onClick={() => onTabChange('math')}>Math</button>
          <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} {...guidedTabAttributes('transform')} onClick={() => onTabChange('transform')}>Transform</button>
          <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>Color</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...guidedTabAttributes('masks')} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : isMotionAdjustmentClip ? (
        <>
          <button className={`tab-btn ${activeTab === 'adjustment' ? 'active' : ''}`} onClick={() => onTabChange('adjustment')}>Adjustment</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...guidedTabAttributes('masks')} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : isMotionShapeClip ? (
        <>
          {isEditableHookClip && <button className={`tab-btn ${activeTab === 'hook' ? 'active' : ''}`} onClick={() => onTabChange('hook')}>Hook</button>}
          <button className={`tab-btn ${activeTab === 'motion' ? 'active' : ''}`} onClick={() => onTabChange('motion')}>Motion</button>
          <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => onTabChange('transform')}>Transform</button>
          <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>Color</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} {...guidedTabAttributes('masks')} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : isCaptionClip ? (
        <>
          <button className={`tab-btn ${activeTab === 'captions' ? 'active' : ''}`} onClick={() => onTabChange('captions')}>Captions</button>
          <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => onTabChange('transform')}>Transform</button>
          <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>Color</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : isTextClip ? (
        <>
          {isEditableHookClip && <button className={`tab-btn ${activeTab === 'hook' ? 'active' : ''}`} onClick={() => onTabChange('hook')}>Hook</button>}
          <button className={`tab-btn ${activeTab === 'text' ? 'active' : ''}`} onClick={() => onTabChange('text')}>Text</button>
          <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => onTabChange('transform')}>Transform</button>
          <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>Color</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : is3DTextClip ? (
        <>
          <button className={`tab-btn ${activeTab === '3d-text' ? 'active' : ''}`} onClick={() => onTabChange('3d-text')}>3D Text</button>
          <button className={`tab-btn ${activeTab === 'transform' ? 'active' : ''}`} onClick={() => onTabChange('transform')}>Transform</button>
          <button className={`tab-btn ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>Color</button>
          <button className={`tab-btn ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
            Effects {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
          </button>
          <button className={`tab-btn ${activeTab === 'masks' ? 'active' : ''}`} onClick={() => onTabChange('masks')}>
            Masks {maskCount > 0 && <span className="badge">{maskCount}</span>}
          </button>
        </>
      ) : (
        <>
          {isVectorAnimationClip && (
            <button className={`tab-btn ${activeTab === 'lottie' ? 'active' : ''}`} onClick={() => onTabChange('lottie')}>
              {vectorAnimationTabLabel}
            </button>
          )}
          <button className={`tab-btn resolve-property-tab resolve-order-video ${activeTab === 'transform' ? 'active' : ''}`} {...guidedTabAttributes('transform')} onClick={() => onTabChange('transform')}>
            <PropertiesTabPresentation fallback="Transform" icon="video" resolveLabel="Video" />
          </button>
          {!isLightClip && !isSplatEffectorClip && <ResolveOnlyPropertiesTab icon="audio" label="Audio" orderClass="resolve-order-audio" />}
          {isModelClip && <button className={`tab-btn ${activeTab === 'model-3d' ? 'active' : ''}`} onClick={() => onTabChange('model-3d')}>3D</button>}
          {!isSplatEffectorClip && (
            <button className={`tab-btn resolve-property-tab resolve-order-image ${activeTab === 'color' ? 'active' : ''}`} onClick={() => onTabChange('color')}>
              <PropertiesTabPresentation fallback="Color" icon="image" resolveLabel="Image" />
            </button>
          )}
          {isGaussianAvatar && <button className={`tab-btn ${activeTab === 'blendshapes' ? 'active' : ''}`} onClick={() => onTabChange('blendshapes')}>Blendshapes</button>}
          {isGaussianSplat && <button className={`tab-btn ${activeTab === 'gaussian-splat' ? 'active' : ''}`} onClick={() => onTabChange('gaussian-splat')}>Gaussian</button>}
          {isLightClip && <button className={`tab-btn ${activeTab === 'light' ? 'active' : ''}`} onClick={() => onTabChange('light')}>Light</button>}
          {isSplatEffectorClip && <button className={`tab-btn ${activeTab === 'splat-effector' ? 'active' : ''}`} onClick={() => onTabChange('splat-effector')}>Effector</button>}
          {!isLightClip && (
            <>
              <button className={`tab-btn resolve-property-tab resolve-order-effects ${activeTab === 'effects' ? 'active' : ''}`} onClick={() => onTabChange('effects')}>
                <PropertiesTabPresentation fallback="Effects" icon="effects" resolveLabel="Effects" />
                {visualEffectCount > 0 && <span className="badge">{visualEffectCount}</span>}
              </button>
              <ResolveOnlyPropertiesTab icon="transition" label="Transition" orderClass="resolve-order-transition" />
              <button className={`tab-btn resolve-property-tab resolve-order-masks ${activeTab === 'masks' ? 'active' : ''}`} {...guidedTabAttributes('masks')} onClick={() => onTabChange('masks')}>
                <PropertiesTabPresentation fallback="Masks" icon="mask" resolveLabel="Masks" />
                {maskCount > 0 && <span className="badge">{maskCount}</span>}
              </button>
            </>
          )}
          {!isSolidClip && !isVectorAnimationClip && !isLightClip && (
            <button className={`tab-btn resolve-property-tab resolve-order-file ${activeTab === 'analysis' ? 'active' : ''}`} onClick={() => onTabChange('analysis')}>
              <PropertiesTabPresentation fallback="Analysis" icon="file" resolveLabel="File" />
              {sourceAnalysisReady && <span className="badge">✓</span>}
            </button>
          )}
        </>
      )}
      {!isAudioClip && !isCameraClip && !isLightClip && !isSplatEffectorClip && !isModelClip && !is3DTextClip && !isGaussianAvatar && !isGaussianSplat && !isMathSceneClip && !isFlockClip && !isStoryboardClip && !isMotionAdjustmentClip && (
        <button type="button" className={`tab-btn ${activeTab === 'tracking' ? 'active' : ''}`} onPointerUp={e=>e.currentTarget.blur()} onClick={() => onTabChange('tracking')}>Tracking</button>
      )}
    </PropertiesTabStrip>
  );
}
