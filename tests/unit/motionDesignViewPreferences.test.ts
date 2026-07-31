import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_MOTION_PATH_ONION_FRAME_DISTANCE,
  MIN_MOTION_PATH_ONION_FRAME_DISTANCE,
  MOTION_PROPERTY_FAVORITES_CHANGED_EVENT,
  MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION,
  normalizeMotionPathOnionFrameDistance,
  parseMotionPropertyFavoritePathsPreference,
  persistStoredMotionPathOnionFrameDistance,
  persistStoredMotionPathOnionSkinVisible,
  persistStoredMotionPropertyFavoritePaths,
  persistStoredTimelineCurveMode,
  readStoredMotionPathOnionFrameDistance,
  readStoredMotionPathOnionSkinVisible,
  readStoredMotionPropertyFavoritePaths,
  readStoredTimelineCurveMode,
  serializeMotionPropertyFavoritePathsPreference,
} from '../../src/stores/timeline/viewPreferences';

describe('motion design per-user view preferences', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('serializes exact favorite paths in stable first-seen order', () => {
    const serialized = serializeMotionPropertyFavoritePathsPreference([
      'position.x',
      'motion.appearance.layer.dynamic-1.opacity',
      'position.x',
      '',
      ' position.x ',
    ]);

    expect(JSON.parse(serialized)).toEqual({
      version: MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION,
      favoritePropertyPaths: [
        'position.x',
        'motion.appearance.layer.dynamic-1.opacity',
        ' position.x ',
      ],
    });
  });

  it('reads the versioned envelope and backward-safe legacy forms', () => {
    const versioned = JSON.stringify({
      version: MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION,
      favoritePropertyPaths: ['opacity', 'opacity', 'motion.stale.dynamic.path'],
    });
    expect(parseMotionPropertyFavoritePathsPreference(versioned)).toEqual([
      'opacity',
      'motion.stale.dynamic.path',
    ]);

    expect(parseMotionPropertyFavoritePathsPreference(JSON.stringify([
      'position.y',
      'scale.all',
      'position.y',
    ]))).toEqual(['position.y', 'scale.all']);

    expect(parseMotionPropertyFavoritePathsPreference(JSON.stringify({
      favoritePropertyPaths: ['rotation.z'],
    }))).toEqual(['rotation.z']);
  });

  it('falls back safely for corrupt, future, and malformed favorite payloads', () => {
    const fallback = ['opacity', 'opacity', ''];

    expect(parseMotionPropertyFavoritePathsPreference('{broken', fallback)).toEqual(['opacity']);
    expect(parseMotionPropertyFavoritePathsPreference(JSON.stringify({
      version: MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION + 1,
      favoritePropertyPaths: ['position.x'],
    }), fallback)).toEqual(['opacity']);
    expect(parseMotionPropertyFavoritePathsPreference(JSON.stringify({
      version: MOTION_PROPERTY_FAVORITES_PREFERENCE_VERSION,
      favoritePropertyPaths: 'opacity',
    }), fallback)).toEqual(['opacity']);
  });

  it('persists favorites without resolving or dropping stale exact paths', () => {
    let changeCount = 0;
    const onChange = () => { changeCount += 1; };
    window.addEventListener(MOTION_PROPERTY_FAVORITES_CHANGED_EVENT, onChange);
    persistStoredMotionPropertyFavoritePaths([
      'position.x',
      'motion.unresolved.future.path',
      'position.x',
    ]);

    expect(readStoredMotionPropertyFavoritePaths()).toEqual([
      'position.x',
      'motion.unresolved.future.path',
    ]);
    expect(changeCount).toBe(1);
    window.removeEventListener(MOTION_PROPERTY_FAVORITES_CHANGED_EVENT, onChange);
  });

  it('persists graph mode and rejects unknown stored values', () => {
    persistStoredTimelineCurveMode('graph');
    expect(readStoredTimelineCurveMode('timeline')).toBe('graph');

    localStorage.setItem('masterselects.timelineCurveMode', 'curves-v2');
    expect(readStoredTimelineCurveMode('timeline')).toBe('timeline');
  });

  it('persists onion visibility independently of onion distance', () => {
    persistStoredMotionPathOnionSkinVisible(true);
    persistStoredMotionPathOnionFrameDistance(6);

    expect(readStoredMotionPathOnionSkinVisible(false)).toBe(true);
    expect(readStoredMotionPathOnionFrameDistance(2)).toBe(6);

    localStorage.setItem('masterselects.motionPathOnionSkinVisible', 'yes');
    expect(readStoredMotionPathOnionSkinVisible(false)).toBe(false);
  });

  it('rounds and clamps finite onion frame distances while rejecting invalid storage', () => {
    expect(normalizeMotionPathOnionFrameDistance(4.6)).toBe(5);
    expect(normalizeMotionPathOnionFrameDistance(-20)).toBe(MIN_MOTION_PATH_ONION_FRAME_DISTANCE);
    expect(normalizeMotionPathOnionFrameDistance(10_000)).toBe(MAX_MOTION_PATH_ONION_FRAME_DISTANCE);
    expect(normalizeMotionPathOnionFrameDistance(Number.NaN)).toBeNull();

    persistStoredMotionPathOnionFrameDistance(4.6);
    expect(readStoredMotionPathOnionFrameDistance(2)).toBe(5);
    persistStoredMotionPathOnionFrameDistance(Number.POSITIVE_INFINITY);
    expect(readStoredMotionPathOnionFrameDistance(2)).toBe(5);

    localStorage.setItem('masterselects.motionPathOnionFrameDistance', 'not-a-number');
    expect(readStoredMotionPathOnionFrameDistance(3)).toBe(3);
    localStorage.setItem('masterselects.motionPathOnionFrameDistance', '999');
    expect(readStoredMotionPathOnionFrameDistance(3)).toBe(MAX_MOTION_PATH_ONION_FRAME_DISTANCE);
  });
});
