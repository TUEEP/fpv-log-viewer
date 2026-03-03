import { create } from "zustand";
import type {
  AltitudeMode,
  FlightPoint,
  Language,
  MapProvider,
  MapStyleMode,
  PlaybackSpeed,
  ThemeMode,
  ViewMode
} from "../types/flight";
import { advancePlaybackByDelta, stepIndex } from "../lib/playback/playbackEngine";

const SPEED_OPTIONS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8];

function detectInitialLanguage(): Language {
  const language =
    typeof navigator === "undefined" ? "zh-CN" : (navigator.language || "zh-CN").toLowerCase();

  if (language.startsWith("zh")) {
    return "zh-CN";
  }
  if (language.startsWith("ja")) {
    return "ja";
  }
  return "en";
}

interface ViewerState {
  headers: string[];
  points: FlightPoint[];
  errors: string[];
  selectedIndex: number;
  playback: {
    isPlaying: boolean;
    currentIndex: number;
    speed: PlaybackSpeed;
  };
  viewMode: ViewMode;
  mapProvider: MapProvider;
  mapStyle: MapStyleMode;
  altitudeMode: AltitudeMode;
  theme: ThemeMode;
  language: Language;
  pointSize: number;
  pointStride: number;
  zScale: number;
  autoFollowMode: boolean;
  frontFollowMode: boolean;
  isFullscreen: boolean;
  playbackCarryMs: number;
  setData: (payload: { headers: string[]; points: FlightPoint[]; errors: string[] }) => void;
  setSelectedIndex: (index: number) => void;
  setCurrentIndex: (index: number) => void;
  stepFrame: (delta: number) => void;
  togglePlay: () => void;
  pause: () => void;
  setSpeed: (speed: PlaybackSpeed) => void;
  advancePlayback: (elapsedMs: number) => void;
  setViewMode: (mode: ViewMode) => void;
  setMapProvider: (provider: MapProvider) => void;
  setMapStyle: (style: MapStyleMode) => void;
  setAltitudeMode: (mode: AltitudeMode) => void;
  setTheme: (mode: ThemeMode) => void;
  setLanguage: (language: Language) => void;
  setPointSize: (size: number) => void;
  setPointStride: (stride: number) => void;
  setZScale: (scale: number) => void;
  setAutoFollowMode: (enabled: boolean) => void;
  setFrontFollowMode: (enabled: boolean) => void;
  setIsFullscreen: (value: boolean) => void;
}

export const useViewerStore = create<ViewerState>((set) => ({
  headers: [],
  points: [],
  errors: [],
  selectedIndex: 0,
  playback: {
    isPlaying: false,
    currentIndex: 0,
    speed: 1
  },
  viewMode: "2d",
  mapProvider: "osm",
  mapStyle: "street",
  altitudeMode: "alt1",
  theme: "dark",
  language: detectInitialLanguage(),
  pointSize: 1,
  pointStride: 1,
  zScale: 5,
  autoFollowMode: false,
  frontFollowMode: false,
  isFullscreen: false,
  playbackCarryMs: 0,

  setData: ({ headers, points, errors }) =>
    set(() => ({
      headers,
      points,
      errors,
      selectedIndex: 0,
      playback: {
        isPlaying: false,
        currentIndex: 0,
        speed: 1
      },
      playbackCarryMs: 0
    })),

  setSelectedIndex: (index) =>
    set((state) => ({
      selectedIndex: Math.max(0, Math.min(state.points.length - 1, index))
    })),

  setCurrentIndex: (index) =>
    set((state) => ({
      playback: {
        ...state.playback,
        currentIndex: Math.max(0, Math.min(state.points.length - 1, index))
      },
      playbackCarryMs: 0
    })),

  stepFrame: (delta) =>
    set((state) => ({
      playback: {
        ...state.playback,
        currentIndex: stepIndex(state.playback.currentIndex, delta, state.points.length)
      },
      playbackCarryMs: 0
    })),

  togglePlay: () =>
    set((state) => {
      if (state.points.length <= 1) {
        return state;
      }

      const shouldPlay =
        state.playback.currentIndex >= state.points.length - 1 ? false : !state.playback.isPlaying;

      return {
        playback: {
          ...state.playback,
          isPlaying: shouldPlay
        },
        playbackCarryMs: shouldPlay ? state.playbackCarryMs : 0
      };
    }),

  pause: () =>
    set((state) => ({
      playback: {
        ...state.playback,
        isPlaying: false
      },
      playbackCarryMs: 0
    })),

  setSpeed: (speed) => {
    if (!SPEED_OPTIONS.includes(speed)) {
      return;
    }

    set((state) => ({
      playback: {
        ...state.playback,
        speed
      },
      playbackCarryMs: 0
    }));
  },

  advancePlayback: (elapsedMs) =>
    set((state) => {
      if (!state.playback.isPlaying || state.points.length <= 1) {
        return state;
      }

      const result = advancePlaybackByDelta(
        state.points,
        state.playback.currentIndex,
        elapsedMs,
        state.playback.speed,
        state.playbackCarryMs
      );
      const isEnd = result.nextIndex >= state.points.length - 1;

      return {
        playback: {
          ...state.playback,
          currentIndex: result.nextIndex,
          isPlaying: isEnd ? false : state.playback.isPlaying
        },
        playbackCarryMs: isEnd ? 0 : result.carryMs
      };
    }),

  setViewMode: (mode) => set(() => ({ viewMode: mode })),
  setMapProvider: (provider) => set(() => ({ mapProvider: provider })),
  setMapStyle: (style) => set(() => ({ mapStyle: style })),
  setAltitudeMode: (mode) => set(() => ({ altitudeMode: mode })),
  setTheme: (mode) => set(() => ({ theme: mode })),
  setLanguage: (language) => set(() => ({ language })),
  setPointSize: (size) => set(() => ({ pointSize: Math.max(0.4, Math.min(3, size)) })),
  setPointStride: (stride) => set(() => ({ pointStride: Math.max(1, Math.min(10, stride)) })),
  setZScale: (scale) => set(() => ({ zScale: Math.max(0.5, Math.min(20, scale)) })),
  setAutoFollowMode: (enabled) => set(() => ({ autoFollowMode: enabled })),
  setFrontFollowMode: (enabled) => set(() => ({ frontFollowMode: enabled })),
  setIsFullscreen: (value) => set(() => ({ isFullscreen: value }))
}));

export const playbackSpeedOptions = SPEED_OPTIONS;
