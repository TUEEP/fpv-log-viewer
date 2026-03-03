export interface FlightPoint {
  index: number;
  timestampMs: number;
  date: string;
  time: string;
  lat: number;
  lon: number;
  alt1: number;
  alt2: number;
  speedKmh: number | null;
  voltageV: number | null;
  currentA: number | null;
  raw: Record<string, string | number | null>;
}

export type AltitudeMode = "alt1" | "alt2";
export type MapStyleMode = "street" | "satellite";
export type MapProvider = "osm" | "amap";
export type ViewMode = "2d" | "3d";
export type Language = "zh-CN" | "en" | "ja";
export type ThemeMode = "dark" | "light";
export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8 | 16;

export interface PlaybackState {
  isPlaying: boolean;
  currentIndex: number;
  speed: PlaybackSpeed;
}

export interface ParsedCsvResult {
  headers: string[];
  points: FlightPoint[];
  errors: string[];
}

export interface PanelSummary {
  time: string;
  latLon: string;
  distance: string;
  altitude: string;
  speed: string;
  voltage: string;
  current: string;
  satellites: string;
  mode: string;
}

export interface PanelFormatResult {
  summary: PanelSummary;
}
