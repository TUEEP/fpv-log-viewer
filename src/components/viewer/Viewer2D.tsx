import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { FlightPoint, MapProvider, MapStyleMode } from "../../types/flight";
import { wgs84ToGcj02 } from "../../lib/math/coordTransform";
import { buildRasterStyle } from "../../lib/map/rasterTiles";
import { resolveTrailCursorRange } from "../../lib/playback/trailWindow";
import { ViewerCornerControls } from "./ViewerCornerControls";

interface Viewer2DProps {
  points: FlightPoint[];
  smoothedTrack: [number, number][];
  selectedIndex: number;
  currentIndex: number;
  playbackCursor: number;
  isPlaying: boolean;
  autoFollowMode: boolean;
  frontFollowMode: boolean;
  mapProvider: MapProvider;
  mapStyle: MapStyleMode;
  pointSize: number;
  pointStride: number;
  setAutoFollowMode: (enabled: boolean) => void;
  setFrontFollowMode: (enabled: boolean) => void;
  onToggleViewMode: () => void;
  onSelect: (index: number) => void;
}

interface MapCoordPoint {
  index: number;
  lon: number;
  lat: number;
}

interface FollowSnapshot2D {
  current: MapCoordPoint;
  lead: {
    lon: number;
    lat: number;
  };
  headingDeg: number | null;
  speedMps: number;
  turnRateDegPerSec: number;
  lookAheadMs: number;
}

const SOURCE_SMOOTH = "fpv-smooth-track";
const SOURCE_POINTS = "fpv-track-points";
const LAYER_SMOOTH_OUTER = "fpv-smooth-line-outer";
const LAYER_SMOOTH_INNER = "fpv-smooth-line-inner";
const LAYER_MIDDLE = "fpv-point-middle";
const LAYER_START = "fpv-point-start";
const LAYER_END = "fpv-point-end";
const LAYER_CURRENT = "fpv-point-current";
const LAYER_CURRENT_RING = "fpv-point-current-ring";
const LAYER_SELECTED = "fpv-point-selected";
const PLAYBACK_TRAIL_WINDOW_MS = 10_000;
const PLAYBACK_DATA_PUSH_INTERVAL_MS = 16;
const PLAYBACK_MAX_LINE_VERTICES = 900;
const TRACK_MAX_GRADIENT_STOPS = 260;
const FOLLOW_LOOK_AHEAD_DEFAULT_MS = 1400;
const FOLLOW_LOOK_AHEAD_MIN_MS = 700;
const FOLLOW_LOOK_AHEAD_MAX_MS = 3200;
const FOLLOW_MANUAL_HOLD_MS = 3000;
const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const SPEED_COLOR_SLOW: [number, number, number] = [111, 140, 255];
const SPEED_COLOR_MID: [number, number, number] = [110, 205, 185];
const SPEED_COLOR_FAST: [number, number, number] = [255, 192, 122];
const TRACK_OUTER_GLOW: [number, number, number] = [244, 251, 255];
const TRACK_OUTER_GRADIENT_FALLBACK = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "rgba(200, 220, 255, 0.58)",
  1,
  "rgba(255, 222, 180, 0.58)"
];
const TRACK_INNER_GRADIENT_FALLBACK = [
  "interpolate",
  ["linear"],
  ["line-progress"],
  0,
  "rgba(120, 170, 255, 0.92)",
  1,
  "rgba(255, 192, 122, 0.92)"
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeBearingDeg(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

function bearingDiffDeg(target: number, source: number): number {
  return normalizeBearingDeg(target - source);
}

function measureOffsetMeters(
  from: { lon: number; lat: number },
  to: { lon: number; lat: number }
): { dx: number; dy: number; distance: number } {
  const meanLat = ((from.lat + to.lat) * 0.5) * DEG_TO_RAD;
  const cosLat = Math.max(Math.abs(Math.cos(meanLat)), 1e-6);
  const dx = (to.lon - from.lon) * DEG_TO_RAD * EARTH_RADIUS_M * cosLat;
  const dy = (to.lat - from.lat) * DEG_TO_RAD * EARTH_RADIUS_M;
  return {
    dx,
    dy,
    distance: Math.hypot(dx, dy)
  };
}

function deriveHeadingDeg(from: { lon: number; lat: number }, to: { lon: number; lat: number }): number | null {
  const offset = measureOffsetMeters(from, to);
  if (offset.distance < 0.8) {
    return null;
  }
  return normalizeBearingDeg((Math.atan2(offset.dx, offset.dy) * 180) / Math.PI);
}

function computeDynamicLookAheadMs(speedMps: number, turnRateDegPerSec: number): number {
  const baseMs = 900;
  const speedBoostMs = clamp(speedMps, 0, 42) * 60;
  const turnPenalty = 1 - clamp((turnRateDegPerSec - 8) / 40, 0, 1) * 0.5;
  const lookAheadMs = (baseMs + speedBoostMs) * turnPenalty;
  return clamp(lookAheadMs, FOLLOW_LOOK_AHEAD_MIN_MS, FOLLOW_LOOK_AHEAD_MAX_MS);
}

function smoothLookAheadMs(previousMs: number, nextMs: number): number {
  if (!Number.isFinite(previousMs) || previousMs <= 0) {
    return nextMs;
  }
  const alpha = nextMs < previousMs ? 0.36 : 0.2;
  return previousMs + (nextMs - previousMs) * alpha;
}

function resolveInterpolatedLeadCoord(
  displayPoints: MapCoordPoint[],
  points: FlightPoint[],
  currentIndex: number,
  lookAheadMs: number
): { lon: number; lat: number } {
  if (displayPoints.length === 0 || points.length === 0) {
    return { lon: 0, lat: 0 };
  }

  const clampedCurrent = Math.max(0, Math.min(points.length - 1, currentIndex));
  const current = displayPoints[clampedCurrent] ?? displayPoints[0];
  const currentTs = points[clampedCurrent]?.timestampMs;
  if (!Number.isFinite(currentTs)) {
    const fallback = displayPoints[Math.min(displayPoints.length - 1, clampedCurrent + 1)] ?? current;
    return { lon: fallback.lon, lat: fallback.lat };
  }

  const targetTs = currentTs + Math.max(0, lookAheadMs);
  let upper = clampedCurrent + 1;
  while (upper < points.length) {
    const ts = points[upper]?.timestampMs;
    if (!Number.isFinite(ts) || ts >= targetTs) {
      break;
    }
    upper += 1;
  }

  if (upper >= points.length) {
    const last = displayPoints[displayPoints.length - 1] ?? current;
    return { lon: last.lon, lat: last.lat };
  }

  const lower = Math.max(clampedCurrent, upper - 1);
  const lowerPoint = displayPoints[lower] ?? current;
  const upperPoint = displayPoints[upper] ?? lowerPoint;
  const lowerTs = points[lower]?.timestampMs;
  const upperTs = points[upper]?.timestampMs;

  if (!Number.isFinite(lowerTs) || !Number.isFinite(upperTs) || upperTs <= lowerTs) {
    return { lon: upperPoint.lon, lat: upperPoint.lat };
  }

  const alpha = clamp((targetTs - lowerTs) / (upperTs - lowerTs), 0, 1);
  return {
    lon: lowerPoint.lon + (upperPoint.lon - lowerPoint.lon) * alpha,
    lat: lowerPoint.lat + (upperPoint.lat - lowerPoint.lat) * alpha
  };
}

function downsampleLineVertices(track: [number, number][], maxVertices: number): [number, number][] {
  if (track.length <= maxVertices || maxVertices < 2) {
    return track;
  }

  const result: [number, number][] = [];
  const lastIndex = track.length - 1;
  const step = lastIndex / (maxVertices - 1);
  for (let i = 0; i < maxVertices; i += 1) {
    const sourceIndex = Math.min(lastIndex, Math.round(i * step));
    const coord = track[sourceIndex];
    if (!coord) {
      continue;
    }
    if (result.length === 0 || result[result.length - 1]![0] !== coord[0] || result[result.length - 1]![1] !== coord[1]) {
      result.push(coord);
    }
  }

  const first = track[0];
  const last = track[lastIndex];
  if (result.length === 0 || result[0] !== first) {
    result.unshift(first);
  }
  if (result[result.length - 1] !== last) {
    result.push(last);
  }

  return result;
}

function interpolateCoord(
  start: [number, number],
  end: [number, number],
  tRaw: number
): [number, number] {
  const t = clamp(tRaw, 0, 1);
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t
  ];
}

function buildWindowedTrack(
  track: [number, number][],
  startCursor: number,
  endCursor: number
): [number, number][] {
  if (track.length === 0) {
    return [];
  }

  const maxCursor = track.length - 1;
  const start = clamp(startCursor, 0, maxCursor);
  const end = clamp(endCursor, start, maxCursor);
  const startFloor = Math.floor(start);
  const endFloor = Math.floor(end);
  const startAlpha = start - startFloor;
  const endAlpha = end - endFloor;
  const result: [number, number][] = [];

  const startPoint =
    startAlpha > 1e-9 && startFloor < maxCursor
      ? interpolateCoord(track[startFloor]!, track[startFloor + 1]!, startAlpha)
      : track[startFloor]!;
  result.push(startPoint);

  for (let i = startFloor + 1; i <= endFloor; i += 1) {
    const point = track[i];
    if (point) {
      result.push(point);
    }
  }

  if (endAlpha > 1e-9 && endFloor < maxCursor) {
    const tail = interpolateCoord(track[endFloor]!, track[endFloor + 1]!, endAlpha);
    const last = result[result.length - 1];
    if (!last || last[0] !== tail[0] || last[1] !== tail[1]) {
      result.push(tail);
    }
  }

  return result;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }

  const idx = clamp(p, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const alpha = idx - lower;
  const lowerValue = sorted[lower] ?? sorted[0];
  const upperValue = sorted[upper] ?? sorted[sorted.length - 1];
  return lowerValue + (upperValue - lowerValue) * alpha;
}

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  tRaw: number
): [number, number, number] {
  const t = clamp(tRaw, 0, 1);
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function speedColorFromNormalized(normalizedSpeed: number): [number, number, number] {
  const t = clamp(normalizedSpeed, 0, 1);
  if (t <= 0.58) {
    return mixRgb(SPEED_COLOR_SLOW, SPEED_COLOR_MID, t / 0.58);
  }
  return mixRgb(SPEED_COLOR_MID, SPEED_COLOR_FAST, (t - 0.58) / 0.42);
}

function toRgba(color: [number, number, number], alpha: number): string {
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${clamp(alpha, 0, 1).toFixed(3)})`;
}

function resolveSegmentSpeedKmh(
  points: FlightPoint[],
  displayPoints: MapCoordPoint[],
  segmentIndex: number
): number {
  const clampedSegmentIndex = Math.max(0, Math.min(points.length - 2, segmentIndex));
  const current = points[clampedSegmentIndex];
  const next = points[clampedSegmentIndex + 1];
  if (!current || !next) {
    return 0;
  }

  const currentSpeed = current.speedKmh;
  const nextSpeed = next.speedKmh;
  if (typeof currentSpeed === "number" && Number.isFinite(currentSpeed)) {
    return Math.max(0, currentSpeed);
  }
  if (typeof nextSpeed === "number" && Number.isFinite(nextSpeed)) {
    return Math.max(0, nextSpeed);
  }

  const from = displayPoints[clampedSegmentIndex];
  const to = displayPoints[clampedSegmentIndex + 1];
  if (!from || !to) {
    return 0;
  }

  const dtMs = next.timestampMs - current.timestampMs;
  if (dtMs <= 0) {
    return 0;
  }
  const distance = measureOffsetMeters(from, to).distance;
  if (!Number.isFinite(distance)) {
    return 0;
  }
  return (distance / (dtMs / 1000)) * 3.6;
}

function ensureLayers(map: maplibregl.Map) {
  if (!map.getSource(SOURCE_SMOOTH)) {
    map.addSource(SOURCE_SMOOTH, {
      type: "geojson",
      lineMetrics: true,
      data: {
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: []
        }
      }
    });
  }

  if (!map.getSource(SOURCE_POINTS)) {
    map.addSource(SOURCE_POINTS, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: []
      }
    });
  }

  if (!map.getLayer(LAYER_SMOOTH_OUTER)) {
    map.addLayer({
      id: LAYER_SMOOTH_OUTER,
      type: "line",
      source: SOURCE_SMOOTH,
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-gradient": TRACK_OUTER_GRADIENT_FALLBACK as any,
        "line-width": 5.8,
        "line-opacity": 1
      }
    });
  }

  if (!map.getLayer(LAYER_SMOOTH_INNER)) {
    map.addLayer({
      id: LAYER_SMOOTH_INNER,
      type: "line",
      source: SOURCE_SMOOTH,
      layout: {
        "line-cap": "round",
        "line-join": "round"
      },
      paint: {
        "line-gradient": TRACK_INNER_GRADIENT_FALLBACK as any,
        "line-width": 2.9,
        "line-opacity": 1
      }
    });
  }

  if (!map.getLayer(LAYER_MIDDLE)) {
    map.addLayer({
      id: LAYER_MIDDLE,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["all", ["==", ["get", "role"], "middle"], ["==", ["get", "isActive"], 0]],
      paint: {
        "circle-color": "#76d2ff",
        "circle-stroke-color": "#235f8e",
        "circle-stroke-width": 1
      }
    });
  }

  if (!map.getLayer(LAYER_START)) {
    map.addLayer({
      id: LAYER_START,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["==", ["get", "role"], "start"],
      paint: {
        "circle-color": "#42d26f",
        "circle-stroke-color": "#083f1b",
        "circle-stroke-width": 1.5
      }
    });
  }

  if (!map.getLayer(LAYER_END)) {
    map.addLayer({
      id: LAYER_END,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["==", ["get", "role"], "end"],
      paint: {
        "circle-color": "#ff5b57",
        "circle-stroke-color": "#581313",
        "circle-stroke-width": 1.5
      }
    });
  }

  if (!map.getLayer(LAYER_CURRENT)) {
    map.addLayer({
      id: LAYER_CURRENT,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["==", ["get", "isCurrent"], 1],
      paint: {
        "circle-color": "#ffe8a4",
        "circle-stroke-color": "#7a5f1a",
        "circle-stroke-width": 1.4
      }
    });
  }

  if (!map.getLayer(LAYER_CURRENT_RING)) {
    map.addLayer({
      id: LAYER_CURRENT_RING,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["==", ["get", "isCurrent"], 1],
      paint: {
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-stroke-color": "#ffe082",
        "circle-stroke-width": 1.8,
        "circle-stroke-opacity": 0.56,
        "circle-radius": 7.5
      }
    });
  }

  if (!map.getLayer(LAYER_SELECTED)) {
    map.addLayer({
      id: LAYER_SELECTED,
      type: "circle",
      source: SOURCE_POINTS,
      filter: ["==", ["get", "isSelected"], 1],
      paint: {
        "circle-color": "rgba(0, 0, 0, 0)",
        "circle-stroke-color": "#1f5a85",
        "circle-stroke-width": 2
      }
    });
  }
}

export function Viewer2D({
  points,
  smoothedTrack,
  selectedIndex,
  currentIndex,
  playbackCursor,
  isPlaying,
  autoFollowMode,
  frontFollowMode,
  mapProvider,
  mapStyle,
  pointSize,
  pointStride: _pointStride,
  setAutoFollowMode,
  setFrontFollowMode,
  onToggleViewMode,
  onSelect
}: Viewer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const trackCoordsRef = useRef<[number, number][]>([]);
  const trackOuterGradientRef = useRef<any>(TRACK_OUTER_GRADIENT_FALLBACK);
  const trackInnerGradientRef = useRef<any>(TRACK_INNER_GRADIENT_FALLBACK);
  const pointFeaturesRef = useRef<Array<Record<string, unknown>>>([]);
  const pointSizeRef = useRef(pointSize);
  const manualFollowUntilRef = useRef(0);
  const lastDataPushAtRef = useRef(0);
  const dataPushTimerRef = useRef<number | null>(null);
  const dataPushPendingRef = useRef(false);
  const dataPushRetryRafRef = useRef<number | null>(null);
  const pointRadiiRetryRafRef = useRef<number | null>(null);
  const currentPulseRafRef = useRef<number | null>(null);
  const lookAheadMsRef = useRef(FOLLOW_LOOK_AHEAD_DEFAULT_MS);
  const followTargetRef = useRef<{
    trackPosition: boolean;
    trackZoom: boolean;
    trackHeading: boolean;
    lon: number;
    lat: number;
    zoom: number;
    bearing: number;
    speedMps: number;
    turnRateDegPerSec: number;
  } | null>(null);
  const followRafRef = useRef<number | null>(null);
  const followLastTickRef = useRef(0);
  const followStateRef = useRef<{ lon: number; lat: number; zoom: number; bearing: number } | null>(null);

  useEffect(() => {
    lookAheadMsRef.current = FOLLOW_LOOK_AHEAD_DEFAULT_MS;
  }, [points.length, mapProvider]);

  const clearPendingDataPush = () => {
    if (dataPushTimerRef.current !== null) {
      window.clearTimeout(dataPushTimerRef.current);
      dataPushTimerRef.current = null;
    }
    if (dataPushRetryRafRef.current !== null) {
      window.cancelAnimationFrame(dataPushRetryRafRef.current);
      dataPushRetryRafRef.current = null;
    }
  };

  const clearPendingPointRadiiRetry = () => {
    if (pointRadiiRetryRafRef.current !== null) {
      window.cancelAnimationFrame(pointRadiiRetryRafRef.current);
      pointRadiiRetryRafRef.current = null;
    }
  };

  const clearCurrentPulseLoop = () => {
    if (currentPulseRafRef.current !== null) {
      window.cancelAnimationFrame(currentPulseRafRef.current);
      currentPulseRafRef.current = null;
    }
  };

  const schedulePointRadiiRetry = (map: maplibregl.Map) => {
    if (pointRadiiRetryRafRef.current !== null) {
      return;
    }
    pointRadiiRetryRafRef.current = window.requestAnimationFrame(() => {
      pointRadiiRetryRafRef.current = null;
      applyPointRadii(map);
    });
  };

  const scheduleDataPushRetry = (map: maplibregl.Map) => {
    if (dataPushRetryRafRef.current !== null) {
      return;
    }
    dataPushRetryRafRef.current = window.requestAnimationFrame(() => {
      dataPushRetryRafRef.current = null;
      pushMapData(map);
    });
  };

  const applyPointRadii = (map: maplibregl.Map) => {
    if (!map || !map.getStyle()) {
      return;
    }

    try {
      map.setPaintProperty(LAYER_SMOOTH_OUTER, "line-gradient", trackOuterGradientRef.current);
      map.setPaintProperty(LAYER_SMOOTH_INNER, "line-gradient", trackInnerGradientRef.current);
      map.setPaintProperty(LAYER_SMOOTH_OUTER, "line-width", 5.8 * pointSizeRef.current);
      map.setPaintProperty(LAYER_SMOOTH_INNER, "line-width", 2.9 * pointSizeRef.current);
      map.setPaintProperty(LAYER_MIDDLE, "circle-radius", 2.2 * pointSizeRef.current);
      map.setPaintProperty(LAYER_START, "circle-radius", 4.1 * pointSizeRef.current);
      map.setPaintProperty(LAYER_END, "circle-radius", 4.1 * pointSizeRef.current);
      map.setPaintProperty(LAYER_CURRENT, "circle-radius", 3.3 * pointSizeRef.current);
      map.setPaintProperty(LAYER_CURRENT_RING, "circle-stroke-width", 1.7 * pointSizeRef.current);
      map.setPaintProperty(LAYER_SELECTED, "circle-radius", 4.8 * pointSizeRef.current);
      clearPendingPointRadiiRetry();
    } catch {
      schedulePointRadiiRetry(map);
    }
  };

  const applyCurrentPulse = (map: maplibregl.Map, nowMs: number) => {
    if (!map || !map.getStyle()) {
      return;
    }

    try {
      const phase = nowMs * 0.0062;
      const wave = 0.5 + 0.5 * Math.sin(phase);
      const radius = (6.2 + wave * 3.6) * pointSizeRef.current;
      const strokeOpacity = 0.2 + (1 - wave) * 0.58;
      map.setPaintProperty(LAYER_CURRENT_RING, "circle-radius", radius);
      map.setPaintProperty(LAYER_CURRENT_RING, "circle-stroke-opacity", strokeOpacity);
    } catch {
      // Style may be transitioning; next frame will retry.
    }
  };

  const startCurrentPulseLoop = (map: maplibregl.Map) => {
    clearCurrentPulseLoop();

    const tick = (now: number) => {
      if (mapRef.current !== map) {
        return;
      }
      applyCurrentPulse(map, now);
      currentPulseRafRef.current = window.requestAnimationFrame(tick);
    };

    currentPulseRafRef.current = window.requestAnimationFrame(tick);
  };

  const pushMapData = (map: maplibregl.Map) => {
    if (!map || !map.getStyle()) {
      return;
    }

    try {
      ensureLayers(map);

      const smoothSource = map.getSource(SOURCE_SMOOTH) as maplibregl.GeoJSONSource | undefined;
      smoothSource?.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: trackCoordsRef.current
        }
      } as any);
      map.setPaintProperty(LAYER_SMOOTH_OUTER, "line-gradient", trackOuterGradientRef.current);
      map.setPaintProperty(LAYER_SMOOTH_INNER, "line-gradient", trackInnerGradientRef.current);

      const pointSource = map.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined;
      pointSource?.setData({
        type: "FeatureCollection",
        features: pointFeaturesRef.current
      } as any);

      dataPushPendingRef.current = false;
      lastDataPushAtRef.current = performance.now();
      clearPendingDataPush();
    } catch {
      scheduleDataPushRetry(map);
    }
  };

  const scheduleMapDataPush = (map: maplibregl.Map, throttled: boolean) => {
    dataPushPendingRef.current = true;
    const flush = () => {
      const activeMap = mapRef.current ?? map;
      if (!activeMap || !dataPushPendingRef.current) {
        return;
      }
      pushMapData(activeMap);
    };

    if (!throttled) {
      clearPendingDataPush();
      flush();
      return;
    }

    const elapsed = performance.now() - lastDataPushAtRef.current;
    const waitMs = Math.max(0, PLAYBACK_DATA_PUSH_INTERVAL_MS - elapsed);
    if (waitMs <= 0) {
      clearPendingDataPush();
      flush();
      return;
    }

    if (dataPushTimerRef.current === null) {
      dataPushTimerRef.current = window.setTimeout(() => {
        dataPushTimerRef.current = null;
        flush();
      }, waitMs);
    }
  };

  useEffect(() => {
    return () => {
      clearPendingDataPush();
      clearPendingPointRadiiRetry();
      clearCurrentPulseLoop();
      dataPushPendingRef.current = false;
    };
  }, []);

  const fitMapToTrack = (map: maplibregl.Map, flightPoints: Array<{ lon: number; lat: number }>) => {
    if (flightPoints.length === 0) {
      return;
    }

    if (!map || !map.getStyle()) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => fitMapToTrack(map, flightPoints));
      return;
    }

    try {
      const bounds = new maplibregl.LngLatBounds(
        [flightPoints[0].lon, flightPoints[0].lat],
        [flightPoints[0].lon, flightPoints[0].lat]
      );
      flightPoints.forEach((point) => bounds.extend([point.lon, point.lat]));
      map.fitBounds(bounds, {
        padding: 40,
        duration: 380,
        maxZoom: 17.5
      });
    } catch {
      map.once("idle", () => fitMapToTrack(map, flightPoints));
    }
  };

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const displayPoints = useMemo<MapCoordPoint[]>(() => {
    return points.map((point) => {
      if (mapProvider === "amap") {
        const converted = wgs84ToGcj02(point.lon, point.lat);
        return {
          index: point.index,
          lon: converted.lon,
          lat: converted.lat
        };
      }

      return {
        index: point.index,
        lon: point.lon,
        lat: point.lat
      };
    });
  }, [points, mapProvider]);

  const displaySmoothedTrackBase = useMemo<[number, number][]>(() => {
    if (mapProvider !== "amap") {
      return smoothedTrack;
    }

    return smoothedTrack.map(([lon, lat]) => {
      const converted = wgs84ToGcj02(lon, lat);
      return [converted.lon, converted.lat];
    });
  }, [smoothedTrack, mapProvider]);

  const followSnapshot = useMemo<FollowSnapshot2D | null>(() => {
    if (displayPoints.length === 0 || points.length === 0) {
      return null;
    }

    const index = Math.max(0, Math.min(points.length - 1, currentIndex));
    const current = displayPoints[index];
    if (!current) {
      return null;
    }

    let speedMps = 0;
    const speedKmh = points[index]?.speedKmh;
    if (typeof speedKmh === "number" && Number.isFinite(speedKmh)) {
      speedMps = Math.max(0, speedKmh / 3.6);
    } else if (index > 0 && displayPoints[index - 1]) {
      const previous = displayPoints[index - 1];
      const deltaMs = points[index].timestampMs - points[index - 1].timestampMs;
      const distance = measureOffsetMeters(previous, current).distance;
      if (deltaMs > 0 && Number.isFinite(distance)) {
        speedMps = Math.max(0, distance / (deltaMs / 1000));
      }
    }

    let turnRateDegPerSec = 0;
    if (index > 2) {
      const prevAIndex = Math.max(0, index - 4);
      const prevBIndex = Math.max(0, index - 2);
      const prevA = displayPoints[prevAIndex];
      const prevB = displayPoints[prevBIndex];
      if (prevA && prevB) {
        const previousHeading = deriveHeadingDeg(prevA, prevB);
        const currentHeading = deriveHeadingDeg(prevB, current);
        const dtMs = points[index].timestampMs - points[prevBIndex].timestampMs;
        if (previousHeading !== null && currentHeading !== null && dtMs > 0) {
          turnRateDegPerSec = Math.abs(bearingDiffDeg(currentHeading, previousHeading)) / (dtMs / 1000);
        }
      }
    }

    const rawLookAheadMs = computeDynamicLookAheadMs(speedMps, turnRateDegPerSec);
    const lookAheadMs = smoothLookAheadMs(lookAheadMsRef.current, rawLookAheadMs);
    lookAheadMsRef.current = lookAheadMs;
    const lead = resolveInterpolatedLeadCoord(displayPoints, points, index, lookAheadMs);

    let headingDeg = deriveHeadingDeg(current, lead);
    if (headingDeg === null && index > 0 && displayPoints[index - 1]) {
      headingDeg = deriveHeadingDeg(displayPoints[index - 1], current);
    }

    return {
      current,
      lead,
      headingDeg,
      speedMps,
      turnRateDegPerSec,
      lookAheadMs
    };
  }, [displayPoints, points, currentIndex]);

  const segmentSpeeds = useMemo<number[]>(() => {
    const segmentCount = Math.min(points.length, displayPoints.length) - 1;
    if (segmentCount <= 0) {
      return [];
    }

    const nextSpeeds: number[] = [];
    for (let i = 0; i < segmentCount; i += 1) {
      nextSpeeds.push(resolveSegmentSpeedKmh(points, displayPoints, i));
    }
    return nextSpeeds;
  }, [points, displayPoints]);

  const speedScale = useMemo(() => {
    if (segmentSpeeds.length === 0) {
      return { min: 0, max: 1 };
    }

    const sorted = [...segmentSpeeds].sort((a, b) => a - b);
    const robustMin = percentile(sorted, 0.1);
    const robustMax = percentile(sorted, 0.9);
    const min = Number.isFinite(robustMin) ? robustMin : sorted[0] ?? 0;
    const max = Math.max(
      min + 0.001,
      Number.isFinite(robustMax) ? robustMax : sorted[sorted.length - 1] ?? min + 0.001
    );
    return { min, max };
  }, [segmentSpeeds]);

  const trackStyleData = useMemo(() => {
    const trailCursorRange = resolveTrailCursorRange(points, playbackCursor, isPlaying, PLAYBACK_TRAIL_WINDOW_MS);
    if (trailCursorRange.endCursor < 0) {
      return {
        coordinates: [] as [number, number][],
        outerGradient: TRACK_OUTER_GRADIENT_FALLBACK,
        innerGradient: TRACK_INNER_GRADIENT_FALLBACK
      };
    }
    if (displaySmoothedTrackBase.length < 2 || segmentSpeeds.length === 0) {
      return {
        coordinates: [] as [number, number][],
        outerGradient: TRACK_OUTER_GRADIENT_FALLBACK,
        innerGradient: TRACK_INNER_GRADIENT_FALLBACK
      };
    }

    let sourceTrack: [number, number][] = displaySmoothedTrackBase;
    let startPointIndex = 0;
    let endPointIndex = Math.max(0, points.length - 1);
    if (isPlaying && points.length > 1 && displaySmoothedTrackBase.length > 1) {
      const samplePerSegment = Math.max(
        1,
        Math.round((displaySmoothedTrackBase.length - 1) / Math.max(points.length - 1, 1))
      );
      const startOffsetFloat = trailCursorRange.startCursor * samplePerSegment;
      const endOffsetFloat = trailCursorRange.endCursor * samplePerSegment;
      sourceTrack = buildWindowedTrack(displaySmoothedTrackBase, startOffsetFloat, endOffsetFloat);
      startPointIndex = trailCursorRange.startCursor;
      endPointIndex = trailCursorRange.endCursor;
    }

    if (isPlaying) {
      sourceTrack = downsampleLineVertices(sourceTrack, PLAYBACK_MAX_LINE_VERTICES);
    }

    const segmentCount = sourceTrack.length - 1;
    if (segmentCount <= 0) {
      return {
        coordinates: sourceTrack,
        outerGradient: TRACK_OUTER_GRADIENT_FALLBACK,
        innerGradient: TRACK_INNER_GRADIENT_FALLBACK
      };
    }

    const pointSpan = Math.max(0.001, endPointIndex - startPointIndex);
    const stopCount = Math.max(1, Math.min(segmentCount, TRACK_MAX_GRADIENT_STOPS));
    const outerGradient: any[] = ["interpolate", ["linear"], ["line-progress"]];
    const innerGradient: any[] = ["interpolate", ["linear"], ["line-progress"]];
    for (let stop = 0; stop <= stopCount; stop += 1) {
      const progress = stop / stopCount;
      const pointPos = startPointIndex + progress * pointSpan;
      const mappedSegmentIndex = Math.max(
        0,
        Math.min(segmentSpeeds.length - 1, Math.floor(pointPos))
      );
      const speed = segmentSpeeds[mappedSegmentIndex] ?? 0;
      const normalizedSpeed = clamp((speed - speedScale.min) / (speedScale.max - speedScale.min), 0, 1);
      const innerColor = speedColorFromNormalized(normalizedSpeed);
      const outerBlend = isPlaying ? 0.58 + progress * 0.12 : 0.56;
      const outerColor = mixRgb(innerColor, TRACK_OUTER_GLOW, outerBlend);

      const fade = isPlaying ? 0.14 + 0.86 * Math.pow(progress, 0.86) : 1;
      const innerAlpha = isPlaying ? 0.06 + 0.94 * fade : 0.95;
      const outerAlpha = isPlaying ? 0.05 + 0.56 * fade : 0.66;
      innerGradient.push(progress, toRgba(innerColor, innerAlpha));
      outerGradient.push(progress, toRgba(outerColor, outerAlpha));
    }

    return {
      coordinates: sourceTrack,
      outerGradient,
      innerGradient
    };
  }, [displaySmoothedTrackBase, points, playbackCursor, isPlaying, segmentSpeeds, speedScale.min, speedScale.max]);

  const pointFeatures = useMemo(() => {
    const result: Array<Record<string, unknown>> = [];
    if (points.length === 0 || displayPoints.length === 0) {
      return result;
    }

    const clampedCursor = clamp(playbackCursor, 0, Math.max(displayPoints.length - 1, 0));
    const cursorIndex = Math.floor(clampedCursor);
    const cursorAlpha = clampedCursor - cursorIndex;
    const interpolatedCurrentPoint = (() => {
      const from = displayPoints[cursorIndex];
      if (!from) {
        return null;
      }
      if (cursorAlpha <= 1e-6 || cursorIndex >= displayPoints.length - 1) {
        return from;
      }
      const to = displayPoints[cursorIndex + 1];
      if (!to) {
        return from;
      }
      return {
        index: from.index,
        lon: from.lon + (to.lon - from.lon) * cursorAlpha,
        lat: from.lat + (to.lat - from.lat) * cursorAlpha
      };
    })();

    const includeIndexes = new Set<number>();
    includeIndexes.add(0);
    includeIndexes.add(points.length - 1);

    if (selectedIndex >= 0 && selectedIndex < points.length) {
      includeIndexes.add(selectedIndex);
    }
    if (currentIndex >= 0 && currentIndex < points.length) {
      includeIndexes.add(currentIndex);
    }

    includeIndexes.forEach((index) => {
      const point = points[index];
      const displayPoint = displayPoints[index];
      if (!point) {
        return;
      }
      if (!displayPoint) {
        return;
      }

      const role =
        index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
      const isCurrent = index === currentIndex ? 1 : 0;
      const isSelected = index === selectedIndex ? 1 : 0;
      const isActive = isCurrent || isSelected ? 1 : 0;
      const coordPoint =
        isCurrent && interpolatedCurrentPoint ? interpolatedCurrentPoint : displayPoint;

      result.push({
        type: "Feature",
        properties: {
          index,
          role,
          isCurrent,
          isSelected,
          isActive
        },
        geometry: {
          type: "Point",
          coordinates: [coordPoint.lon, coordPoint.lat]
        }
      });
    });

    return result;
  }, [points, displayPoints, selectedIndex, currentIndex, playbackCursor]);

  useEffect(() => {
    trackCoordsRef.current = trackStyleData.coordinates;
    trackOuterGradientRef.current = trackStyleData.outerGradient;
    trackInnerGradientRef.current = trackStyleData.innerGradient;
    pointFeaturesRef.current = pointFeatures;
    if (mapRef.current) {
      scheduleMapDataPush(mapRef.current, isPlaying);
    }
  }, [trackStyleData, pointFeatures, isPlaying]);

  useEffect(() => {
    pointSizeRef.current = pointSize;
    if (mapRef.current) {
      applyPointRadii(mapRef.current);
    }
  }, [pointSize]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const map = new maplibregl.Map({
      container,
      style: buildRasterStyle(mapProvider, mapStyle),
      center: displayPoints.length ? [displayPoints[0].lon, displayPoints[0].lat] : [120.3098, 31.9847],
      zoom: points.length ? 15 : 2,
      pitch: 0
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    mapRef.current = map;
    let cleanupManualFollow: (() => void) | null = null;

    const clickableLayers = [LAYER_MIDDLE, LAYER_START, LAYER_END, LAYER_CURRENT, LAYER_CURRENT_RING, LAYER_SELECTED];

    map.on("load", () => {
      ensureLayers(map);
      applyPointRadii(map);
      pushMapData(map);
      startCurrentPulseLoop(map);

      map.on("click", (event) => {
        const features = map.queryRenderedFeatures(event.point, { layers: clickableLayers });
        const target = features[0];
        if (!target?.properties) {
          return;
        }

        const index = Number(target.properties.index);
        if (Number.isFinite(index)) {
          onSelectRef.current(index);
        }
      });

      clickableLayers.forEach((layerId) => {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      });

      const markManualFollow = () => {
        manualFollowUntilRef.current = performance.now() + FOLLOW_MANUAL_HOLD_MS;
      };
      map.on("dragstart", markManualFollow);
      const canvas = map.getCanvas();
      const onCanvasWheel = () => markManualFollow();
      const onCanvasPointerDown = () => markManualFollow();
      canvas.addEventListener("wheel", onCanvasWheel, { passive: true });
      canvas.addEventListener("pointerdown", onCanvasPointerDown, { passive: true });
      cleanupManualFollow = () => {
        map.off("dragstart", markManualFollow);
        canvas.removeEventListener("wheel", onCanvasWheel);
        canvas.removeEventListener("pointerdown", onCanvasPointerDown);
      };

      if (displayPoints.length > 0) {
        fitMapToTrack(map, displayPoints);
      }
    });

    return () => {
      clearPendingDataPush();
      clearPendingPointRadiiRetry();
      clearCurrentPulseLoop();
      dataPushPendingRef.current = false;
      cleanupManualFollow?.();
      map.remove();
      mapRef.current = null;
    };
  }, [mapProvider, mapStyle, displayPoints, points.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) {
      return;
    }

    applyPointRadii(map);
    pushMapData(map);
    fitMapToTrack(map, displayPoints);
  }, [displayPoints, points.length, mapProvider, mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !followSnapshot) {
      return;
    }
    if (!map.getStyle()) {
      return;
    }

    const shouldTrackPosition = isPlaying && (autoFollowMode || frontFollowMode);
    const shouldTrackZoom = isPlaying && autoFollowMode;
    const shouldTrackHeading = isPlaying && frontFollowMode;

    if (!shouldTrackPosition && !shouldTrackZoom && !shouldTrackHeading) {
      followTargetRef.current = null;
      followStateRef.current = null;
      followLastTickRef.current = 0;
      return;
    }

    const speedFactor = clamp(followSnapshot.speedMps / 34, 0, 1);
    const turnFactor = clamp(followSnapshot.turnRateDegPerSec / 75, 0, 1);
    const zoomNow = map.getZoom();

    const leadFactor = shouldTrackPosition ? clamp(0.16 + speedFactor * 0.3, 0.16, 0.48) : 0;
    const targetLon =
      followSnapshot.current.lon + (followSnapshot.lead.lon - followSnapshot.current.lon) * leadFactor;
    const targetLat =
      followSnapshot.current.lat + (followSnapshot.lead.lat - followSnapshot.current.lat) * leadFactor;

    let targetZoom = zoomNow;
    if (shouldTrackZoom) {
      targetZoom = clamp(17.05 - speedFactor * 1.25 - turnFactor * 0.72, 13.4, 18.05);
    }

    const previousTarget = followTargetRef.current;
    let targetBearingRaw =
      shouldTrackHeading && followSnapshot.headingDeg !== null
        ? followSnapshot.headingDeg
        : normalizeBearingDeg(map.getBearing());
    if (previousTarget && shouldTrackHeading) {
      const blend = clamp(0.2 + turnFactor * 0.32, 0.2, 0.52);
      targetBearingRaw = normalizeBearingDeg(
        previousTarget.bearing + bearingDiffDeg(targetBearingRaw, previousTarget.bearing) * blend
      );
    }

    const targetBearing = targetBearingRaw;

    followTargetRef.current = {
      trackPosition: shouldTrackPosition,
      trackZoom: shouldTrackZoom,
      trackHeading: shouldTrackHeading,
      lon: targetLon,
      lat: targetLat,
      zoom: targetZoom,
      bearing: targetBearing,
      speedMps: followSnapshot.speedMps,
      turnRateDegPerSec: followSnapshot.turnRateDegPerSec
    };
  }, [followSnapshot, isPlaying, autoFollowMode, frontFollowMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const shouldAnimate = isPlaying && (autoFollowMode || frontFollowMode);
    if (!shouldAnimate) {
      if (followRafRef.current !== null) {
        cancelAnimationFrame(followRafRef.current);
        followRafRef.current = null;
      }
      followLastTickRef.current = 0;
      followStateRef.current = null;
      return;
    }

    let disposed = false;
    const tick = () => {
      if (disposed) {
        return;
      }

      const target = followTargetRef.current;
      if (!target) {
        followRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const now = performance.now();
      const dtSec =
        followLastTickRef.current > 0
          ? Math.max(1 / 120, (now - followLastTickRef.current) / 1000)
          : 1 / 60;
      followLastTickRef.current = now;

      if (now < manualFollowUntilRef.current) {
        followRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const centerNow = map.getCenter();
      const zoomNow = map.getZoom();
      const bearingNow = normalizeBearingDeg(map.getBearing());

      const smoothState = followStateRef.current ?? {
        lon: centerNow.lng,
        lat: centerNow.lat,
        zoom: zoomNow,
        bearing: bearingNow
      };
      const speedFactor = clamp(target.speedMps / 34, 0, 1);
      const turnFactor = clamp(target.turnRateDegPerSec / 75, 0, 1);
      const agitation = clamp(speedFactor * 0.32 + turnFactor * 0.78, 0, 1);

      if (target.trackPosition) {
        const centerAlpha = 1 - Math.exp(-dtSec * (2.9 + agitation * 2.2));
        smoothState.lon += (target.lon - smoothState.lon) * centerAlpha;
        smoothState.lat += (target.lat - smoothState.lat) * centerAlpha;
      } else {
        smoothState.lon = centerNow.lng;
        smoothState.lat = centerNow.lat;
      }

      if (target.trackZoom) {
        const zoomDelta = target.zoom - smoothState.zoom;
        if (Math.abs(zoomDelta) > 0.002) {
          const zoomingOut = zoomDelta < 0;
          const zoomRate = zoomingOut
            ? 1.7 + agitation * 1.25
            : 0.75 + agitation * 0.55;
          const zoomAlpha = 1 - Math.exp(-dtSec * zoomRate);
          smoothState.zoom += zoomDelta * zoomAlpha;
        }
      } else {
        smoothState.zoom = zoomNow;
      }

      const headingActive = target.trackHeading && (target.speedMps > 1.8 || target.turnRateDegPerSec > 10);
      if (headingActive) {
        const bearingDelta = bearingDiffDeg(target.bearing, smoothState.bearing);
        const deadband = 1.5 + (1 - agitation) * 1.2;
        if (Math.abs(bearingDelta) > deadband) {
          const maxStep = (24 + target.turnRateDegPerSec * 0.35) * dtSec;
          const step = clamp(
            bearingDelta * (1 - Math.exp(-dtSec * (2.3 + agitation * 3.1))),
            -maxStep,
            maxStep
          );
          smoothState.bearing = normalizeBearingDeg(smoothState.bearing + step);
        }
      } else {
        smoothState.bearing = bearingNow;
      }

      followStateRef.current = smoothState;

      const centerOffset = measureOffsetMeters(
        { lon: centerNow.lng, lat: centerNow.lat },
        { lon: smoothState.lon, lat: smoothState.lat }
      );
      const needCenterUpdate = target.trackPosition && centerOffset.distance > 0.2;
      const needZoomUpdate = target.trackZoom && Math.abs(smoothState.zoom - zoomNow) > 0.004;
      const needBearingUpdate =
        target.trackHeading && Math.abs(bearingDiffDeg(smoothState.bearing, bearingNow)) > 0.16;

      if (needCenterUpdate || needZoomUpdate || needBearingUpdate) {
        map.jumpTo({
          center: needCenterUpdate ? [smoothState.lon, smoothState.lat] : [centerNow.lng, centerNow.lat],
          zoom: needZoomUpdate ? smoothState.zoom : zoomNow,
          bearing: needBearingUpdate ? smoothState.bearing : bearingNow
        });
      }

      followRafRef.current = requestAnimationFrame(tick);
    };

    if (followRafRef.current !== null) {
      cancelAnimationFrame(followRafRef.current);
      followRafRef.current = null;
    }
    followLastTickRef.current = 0;
    followRafRef.current = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      if (followRafRef.current !== null) {
        cancelAnimationFrame(followRafRef.current);
        followRafRef.current = null;
      }
      followLastTickRef.current = 0;
    };
  }, [isPlaying, autoFollowMode, frontFollowMode, points.length, mapProvider, mapStyle]);

  return (
    <div className="viewer-canvas" style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0
        }}
      />

      <ViewerCornerControls
        viewMode="2d"
        autoFollowMode={autoFollowMode}
        frontFollowMode={frontFollowMode}
        onAutoFollowChange={setAutoFollowMode}
        onFrontFollowChange={setFrontFollowMode}
        onToggleViewMode={onToggleViewMode}
      />
    </div>
  );
}
