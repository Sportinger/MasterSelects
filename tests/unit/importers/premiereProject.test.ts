import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaFile } from '../../../src/stores/mediaStore/types';
import { parsePremiereProjectXml } from '../../../src/importers/premiereProject';
import { createPremiereProjectStreamParser } from '../../../src/importers/premiere/premiereProjectStreamParser';

const SECOND = '254016000000';
const TEN_SECONDS = '2540160000000';
const ELEVEN_SECONDS = '2794176000000';

describe('Premiere project import', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it('parses without constructing a browser DOM tree', () => {
    vi.stubGlobal('DOMParser', class {
      constructor() {
        throw new Error('DOMParser must not be used by the Premiere importer');
      }
    });
    const result = parsePremiereProjectXml(
      '<PremiereData><Sequence ObjectUID="seq-stream"><Name>Streaming</Name></Sequence></PremiereData>',
      'Streaming.prproj',
      [],
    );

    expect(result.compositions).toHaveLength(1);
    expect(result.compositions[0]?.name).toBe('Streaming');
  });

  it('accepts arbitrary input chunks and discards unrelated Premiere metadata', () => {
    const xml = `<PremiereData>
      <SecondaryContent ObjectID="noise"><Properties><Name>${'unused'.repeat(200)}</Name></Properties></SecondaryContent>
      <Sequence ObjectUID="seq-chunks"><Name>Chunked Sequence</Name></Sequence>
    </PremiereData>`;
    const parser = createPremiereProjectStreamParser();
    for (let offset = 0; offset < xml.length; offset += 7) {
      parser.write(xml.slice(offset, offset + 7));
    }
    const graph = parser.close();

    expect(graph.sequences).toEqual([{ uid: 'seq-chunks', name: 'Chunked Sequence', trackGroupRefs: [] }]);
    expect(graph.trackItemsById.size).toBe(0);
    expect(graph.paramsById.size).toBe(0);
  });

  it('keeps an offline original and attaches its Premiere proxy as a separate source', () => {
    const xml = `<?xml version="1.0"?>
      <PremiereData Version="3">
        <Sequence ObjectUID="seq-proxy">
          <TrackGroups><TrackGroup><Second ObjectRef="video-group"/></TrackGroup></TrackGroups>
          <Name>Proxy Sequence</Name>
        </Sequence>
        <VideoTrackGroup ObjectID="video-group">
          <TrackGroup><Tracks><Track ObjectURef="video-track"/></Tracks><FrameRate>8467200000</FrameRate></TrackGroup>
          <FrameRect>0,0,1080,1920</FrameRect>
        </VideoTrackGroup>
        <VideoClipTrack ObjectUID="video-track">
          <ClipTrack><Track/><ClipItems><TrackItems><TrackItem ObjectRef="item-proxy"/></TrackItems></ClipItems></ClipTrack>
        </VideoClipTrack>
        <VideoClipTrackItem ObjectID="item-proxy">
          <ClipTrackItem><TrackItem><Start>${TEN_SECONDS}</Start><End>${ELEVEN_SECONDS}</End></TrackItem><SubClip ObjectRef="sub-proxy"/></ClipTrackItem>
        </VideoClipTrackItem>
        <SubClip ObjectID="sub-proxy"><Clip ObjectRef="clip-proxy"/><Name>A006_08111727_C002.braw</Name></SubClip>
        <VideoClip ObjectID="clip-proxy"><Clip><Source ObjectRef="source-proxy"/><InPoint>0</InPoint><OutPoint>${SECOND}</OutPoint></Clip></VideoClip>
        <VideoMediaSource ObjectID="source-proxy">
          <MediaSource><Content><ProxyMedia ObjectURef="media-proxy"/></Content><Media ObjectURef="media-original"/></MediaSource>
          <OriginalDuration>${SECOND}</OriginalDuration>
        </VideoMediaSource>
        <Media ObjectUID="media-original">
          <Title>A006_08111727_C002.braw</Title><FilePath>/Volumes/MAIN3/A006_08111727_C002.braw</FilePath><FileKey>original-key</FileKey>
        </Media>
        <Media ObjectUID="media-proxy">
          <Title>A006_08111727_C002_Proxy.mov</Title><FilePath>/Volumes/MONTAGE/Proxies/A006_08111727_C002_Proxy.mov</FilePath>
          <FileKey>proxy-key</FileKey><IsProxy>true</IsProxy>
        </Media>
      </PremiereData>`;

    const result = parsePremiereProjectXml(xml, 'Proxy.prproj', []);

    expect(result.proxyMediaCount).toBe(1);
    expect(result.mediaFiles).toHaveLength(1);
    expect(result.mediaFiles[0]).toMatchObject({
      name: 'A006_08111727_C002.braw',
      filePath: '/Volumes/MAIN3/A006_08111727_C002.braw',
      sourceSelection: { mode: 'auto' },
      linkedSources: [{
        name: 'A006_08111727_C002_Proxy.mov',
        sourcePath: '/Volumes/MONTAGE/Proxies/A006_08111727_C002_Proxy.mov',
        role: 'proxy',
        origin: 'premiere',
      }],
    });
    expect(result.compositions[0]?.timelineData).toMatchObject({
      playheadPosition: 10,
      scrollX: 400,
    });

    const existingOriginal = {
      id: 'existing-braw',
      name: 'A006_08111727_C002.braw',
      type: 'video',
      parentId: null,
      createdAt: 1,
      url: '',
      filePath: '/Volumes/MAIN3/A006_08111727_C002.braw',
    } as MediaFile;
    const reused = parsePremiereProjectXml(xml, 'Proxy.prproj', [existingOriginal]);

    expect(reused.mediaFiles).toHaveLength(0);
    expect(reused.existingMediaUpdates).toEqual([expect.objectContaining({
      id: 'existing-braw',
      sourceSelection: { mode: 'auto' },
      linkedSources: [expect.objectContaining({
        name: 'A006_08111727_C002_Proxy.mov',
        role: 'proxy',
      })],
    })]);
  });
});
