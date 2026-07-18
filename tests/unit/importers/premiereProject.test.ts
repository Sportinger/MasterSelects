import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../../../src/stores/mediaStore/types';
import { parsePremiereProjectXml } from '../../../src/importers/premiereProject';

const SECOND = '254016000000';

describe('Premiere project import', () => {
  it('creates compositions and reuses existing media with static clip settings', () => {
    const existing = {
      id: 'existing-media',
      name: '1.mp4',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: 'blob:existing',
      file: new File(['video'], '1.mp4', { type: 'video/mp4' }),
      duration: 1,
    } as MediaFile;
    const xml = `<?xml version="1.0"?>
      <PremiereData Version="3">
        <Sequence ObjectUID="seq-1">
          <TrackGroups>
            <TrackGroup><Second ObjectRef="video-group"/></TrackGroup>
            <TrackGroup><Second ObjectRef="audio-group"/></TrackGroup>
          </TrackGroups>
          <Name>Main Sequence</Name>
        </Sequence>
        <VideoTrackGroup ObjectID="video-group">
          <TrackGroup><Tracks><Track ObjectURef="video-track"/></Tracks><FrameRate>8467200000</FrameRate></TrackGroup>
          <FrameRect>0,0,1080,1080</FrameRect>
        </VideoTrackGroup>
        <AudioTrackGroup ObjectID="audio-group"><TrackGroup/></AudioTrackGroup>
        <VideoClipTrack ObjectUID="video-track">
          <ClipTrack>
            <Track><IsLocked>false</IsLocked><IsMuted>false</IsMuted></Track>
            <ClipItems><TrackItems><TrackItem ObjectRef="item-1"/></TrackItems></ClipItems>
          </ClipTrack>
        </VideoClipTrack>
        <VideoClipTrackItem ObjectID="item-1">
          <ClipTrackItem>
            <ComponentOwner><Components ObjectRef="chain-1"/></ComponentOwner>
            <TrackItem><Start>0</Start><End>${SECOND}</End></TrackItem>
            <SubClip ObjectRef="sub-1"/>
          </ClipTrackItem>
        </VideoClipTrackItem>
        <VideoComponentChain ObjectID="chain-1"><ComponentChain><Components><Component ObjectRef="opacity-1"/></Components></ComponentChain></VideoComponentChain>
        <VideoFilterComponent ObjectID="opacity-1"><Component><Params><Param ObjectRef="opacity-param"/></Params></Component><MatchName>AE.ADBE Opacity</MatchName></VideoFilterComponent>
        <VideoComponentParam ObjectID="opacity-param"><Name>Opacity</Name><StartKeyframe>-1,70.,0,0</StartKeyframe></VideoComponentParam>
        <SubClip ObjectID="sub-1"><Clip ObjectRef="clip-1"/><Name>1.mp4</Name></SubClip>
        <VideoClip ObjectID="clip-1"><Clip><Source ObjectRef="source-1"/><InPoint>0</InPoint><OutPoint>${SECOND}</OutPoint></Clip></VideoClip>
        <VideoMediaSource ObjectID="source-1"><MediaSource><Media ObjectURef="media-1"/></MediaSource><OriginalDuration>${SECOND}</OriginalDuration></VideoMediaSource>
        <Media ObjectUID="media-1"><Title>1.mp4</Title><FilePath>/source/Mother/1.mp4</FilePath><RelativePath>Mother/1.mp4</RelativePath><FileKey>file-1</FileKey></Media>
      </PremiereData>`;

    const result = parsePremiereProjectXml(xml, 'Mother.prproj', [existing]);

    expect(result.mediaFiles).toEqual([]);
    expect(result.reusedMediaCount).toBe(1);
    expect(result.compositions).toHaveLength(1);
    expect(result.compositions[0]).toMatchObject({
      name: 'Main Sequence',
      width: 1080,
      height: 1080,
      frameRate: 30,
      duration: 1,
    });
    expect(result.compositions[0]!.timelineData?.clips[0]).toMatchObject({
      mediaFileId: 'existing-media',
      startTime: 0,
      duration: 1,
      inPoint: 0,
      outPoint: 1,
      transform: { opacity: 0.7 },
    });
  });
});
