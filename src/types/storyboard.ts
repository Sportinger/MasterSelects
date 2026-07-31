/**
 * Timeline-facing storyboard type surface.
 *
 * The canonical contracts are frozen in services/storyboard/contracts. Re-export
 * them here so timeline code does not redefine or drift from the persisted model.
 */
export {
  STORYBOARD_SCHEMA_VERSION,
  type StoryboardClipProperties,
  type StoryboardSceneStatus,
} from '../services/storyboard/contracts';
