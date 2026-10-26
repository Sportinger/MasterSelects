import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { LinuxCodecNoticeContext, LinuxCodecNoticeId } from '../services/codecNotices/linuxCodecNoticePolicy';

export interface ActiveLinuxCodecNotice {
  id: LinuxCodecNoticeId;
  context: LinuxCodecNoticeContext;
}

interface LinuxCodecNoticeState {
  /** Notices visible right now (runtime only; dismissals persist in uiSettingsStore). */
  notices: ActiveLinuxCodecNotice[];
  show: (notice: ActiveLinuxCodecNotice) => void;
  hide: (id: LinuxCodecNoticeId) => void;
}

export const useLinuxCodecNoticeStore = create<LinuxCodecNoticeState>()(
  subscribeWithSelector((set) => ({
    notices: [],
    show: (notice) => set((state) => {
      const index = state.notices.findIndex(({ id }) => id === notice.id);
      if (index < 0) return { notices: [...state.notices, notice] };
      const notices = [...state.notices];
      notices[index] = notice;
      return { notices };
    }),
    hide: (id) => set((state) => (
      state.notices.some((notice) => notice.id === id)
        ? { notices: state.notices.filter((notice) => notice.id !== id) }
        : state
    )),
  })),
);
