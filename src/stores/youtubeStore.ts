// YouTube panel state store - persisted with project
import { create } from 'zustand';

export interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  duration?: string;
  durationSeconds?: number;
  viewCount?: string;
}

interface YouTubeState {
  // Saved videos (search results, pasted URLs)
  videos: YouTubeVideo[];
  // Last search query
  lastQuery: string;

  // Actions
  addVideo: (video: YouTubeVideo) => void;
  addVideos: (videos: YouTubeVideo[]) => void;
  removeVideo: (videoId: string) => void;
  clearVideos: () => void;
  setLastQuery: (query: string) => void;

  // For project save/load
  getState: () => { videos: YouTubeVideo[]; lastQuery: string };
  loadState: (state: { videos: YouTubeVideo[]; lastQuery: string }) => void;
  reset: () => void;
}

export const useYouTubeStore = create<YouTubeState>((set, get) => ({
  videos: [],
  lastQuery: '',

  addVideo: (video) => {
    const { videos } = get();
    // Don't add duplicates
    if (videos.some(v => v.id === video.id)) return;
    set({ videos: [...videos, video] });
  },

  addVideos: (newVideos) => {
    const { videos } = get();
    // Filter out duplicates
    const uniqueNew = newVideos.filter(nv => !videos.some(v => v.id === nv.id));
    if (uniqueNew.length > 0) {
      set({ videos: [...videos, ...uniqueNew] });
    }
  },

  removeVideo: (videoId) => {
    const { videos } = get();
    set({ videos: videos.filter(v => v.id !== videoId) });
  },

  clearVideos: () => {
    set({ videos: [], lastQuery: '' });
  },

  setLastQuery: (query) => {
    set({ lastQuery: query });
  },

  // For project serialization
  getState: () => {
    const { videos, lastQuery } = get();
    return { videos, lastQuery };
  },

  loadState: (state) => {
    set({
      videos: state.videos || [],
      lastQuery: state.lastQuery || '',
    });
  },

  reset: () => {
    set({ videos: [], lastQuery: '' });
  },
}));
