import { useEffect } from 'react';
import { useMediaStore } from '../../../../stores/mediaStore';
import { useTimelineStore } from '../../../../stores/timeline';
import { useTrackingStore } from '../../../../stores/trackingStore';
import { useTrackingEditorStore } from '../../../../stores/trackingEditorStore';
import { useDockStore } from '../../../../stores/dockStore';
import { TRACKING_ASSET_ACTION_EVENT, type TrackingAssetActionEventDetail } from '../../../../services/planarTracking/trackingAssetActions';
import { bindClipToTrackingAsset, isTrackingBindingEligibleClip } from '../../../../services/planarTracking/trackingBinding';
import { assessTrackingSceneCalibration } from '../../../../services/planarTracking/trackingSceneCamera';
import { layerBuilder } from '../../../../services/layerBuilder';
import { renderHostPort } from '../../../../services/render/renderHostPort';

/** Installed once by the application shell, including when Properties is closed. */
export function useTrackingAssetActions() {
  const setOpenedAssetId = (openedAssetId:string|null) => useTrackingEditorStore.getState().setEditor({openedAssetId});
  useEffect(() => {
    let disposed = false;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<TrackingAssetActionEventDetail>).detail;
      const asset = useTrackingStore.getState().assets.find(a => a.id === detail?.assetId);
      if (!asset) return;
      const editor = useTrackingEditorStore.getState();
      if (detail.action === 'scene-3d' && editor.actionBusy) return;
      if (detail.action === 'scene-3d') editor.setEditor({actionBusy:true});
      const openProperties = () => {
        useDockStore.getState().activatePanelType('clip-properties');
        requestAnimationFrame(() => {if(!disposed)window.dispatchEvent(new CustomEvent('openPropertiesTab',{detail:{tab:'tracking'}}));});
      };
      useTrackingStore.getState().selectAsset(asset.id);
      editor.setEditor({assetId:asset.id, message:''});
      void (async () => {
        if (detail.action === 'scene-3d') {
          if (!asset.track.terrain) throw new Error('This result has no 3D reconstruction.');
          if (!detail.allowApproximateCamera && !assessTrackingSceneCalibration(asset.track.terrain.intrinsics).exactSupported) {
            setOpenedAssetId(asset.id);
            editor.setEditor({active:true,clipId:null,trackId:asset.track.id,view:'3d',tool:'inspect',message:'Choose Create 3D scene below to use an approximate lens.'});
            openProperties();
            return;
          }
          editor.setEditor({message:'Creating 3D scene…'});
          const {createTrackingScene} = await import('../../../../services/planarTracking/createTrackingScene');
          const result = await createTrackingScene({assetId:asset.id,name:asset.name,sourceMediaId:asset.sourceMediaId,terrain:asset.track.terrain,sourceVideoClipId:detail.sourceVideoClipId ?? asset.sourceVideoClipId,allowApproximateCamera:detail.allowApproximateCamera});
          if (disposed) return;
          setOpenedAssetId(null);
          editor.setEditor({active:false,view:'video',message:'3D scene ready'});
          await useMediaStore.getState().openCompositionTab(result.compositionId);
          return;
        }
        if (detail.action === 'use') {
          const timeline = useTimelineStore.getState();
          const targets = timeline.clips.filter(c => timeline.selectedClipIds.has(c.id) && c.id !== (detail.sourceVideoClipId ?? asset.sourceVideoClipId) && isTrackingBindingEligibleClip(c));
          if (targets.length) {
            for (const target of targets) bindClipToTrackingAsset(target.id,asset.id,asset.track.terrain?'surface':'follow');
            layerBuilder.invalidateCache();
            renderHostPort.requestRender();
            setOpenedAssetId(null);
            openProperties();
            return;
          }
          editor.setEditor({attachMode:asset.track.terrain?'surface':'follow'});
        }
        let source = useTimelineStore.getState().clips.find(c => c.id === (detail.sourceVideoClipId ?? asset.sourceVideoClipId));
        if (!source && asset.sourceCompositionId) {
          await useMediaStore.getState().openCompositionTab(asset.sourceCompositionId);
          source = useTimelineStore.getState().clips.find(c => c.id === asset.sourceVideoClipId);
        }
        if (disposed) return;
        editor.setEditor({active:true,clipId:source?.id ?? null,trackId:asset.track.id,view:'video',tool:'inspect',draft:null});
        if (source) {
          setOpenedAssetId(null);
          useTimelineStore.getState().selectClip(source.id);
          openProperties();
        } else {setOpenedAssetId(asset.id);openProperties();}
      })().catch(error => {
        editor.setEditor({message:error instanceof Error?error.message:String(error)});
        setOpenedAssetId(asset.id);openProperties();
      }).finally(()=>{if(detail.action==='scene-3d')editor.setEditor({actionBusy:false});});
    };
    window.addEventListener(TRACKING_ASSET_ACTION_EVENT,handler);
    return () => {disposed=true;window.removeEventListener(TRACKING_ASSET_ACTION_EVENT,handler);};
  }, []);
}
