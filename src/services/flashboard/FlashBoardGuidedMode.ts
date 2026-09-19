interface FlashBoardGuidedModeState {
  active: boolean;
}

type FlashBoardGuidedModeHotData = {
  flashBoardGuidedModeState?: FlashBoardGuidedModeState;
};

const hotData = import.meta.hot?.data as FlashBoardGuidedModeHotData | undefined;
const state: FlashBoardGuidedModeState = hotData?.flashBoardGuidedModeState ?? {
  active: false,
};

export function setFlashBoardGuidedMode(active: boolean): void {
  state.active = active;
}

export function isFlashBoardGuidedMode(): boolean {
  return state.active;
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: FlashBoardGuidedModeHotData) => {
    data.flashBoardGuidedModeState = state;
  });
}
