import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { FlightPoint, MapProvider, MapStyleMode } from "../../types/flight";
import { wgs84ToGcj02 } from "../../lib/math/coordTransform";
import { buildRasterStyle } from "../../lib/map/rasterTiles";
import { resolveTrailRange } from "../../lib/playback/trailWindow";
import { ViewerCornerControls } from "./ViewerCornerControls";

interface Viewer2DProps {
  points: FlightPoint[];
  smoothedTrack: [number, number][];
  selectedIndex: number;
  currentIndex: number;
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
const LAYER_SMOOTH = "fpv-smooth-line";
const LAYER_MIDDLE = "fpv-point-middle";
const LAYER_START = "fpv-point-start";
const LAYER_END = "fpv-point-end";
const LAYER_CURRENT = "fpv-point-current";
const LAYER_SELECTED = "fpv-point-selected";
const PLAYBACK_TRAIL_WINDOW_MS = 10_000;
const PLAYBACK_DATA_PUSH_INTERVAL_MS = 50;
const PLAYBACK_MAX_LINE_VERTICES = 900;
const PLAYBACK_MAX_POINT_FEATURES = 220;
const FOLLOW_LOOK_AHEAD_DEFAULT_MS = 1400;
const FOLLOW_LOOK_AHEAD_MIN_MS = 700;
const FOLLOW_LOOK_AHEAD_MAX_MS = 3200;
const FOLLOW_MANUAL_HOLD_MS = 3000;
const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;

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

function ensureLayers(map: maplibregl.Map) {
  if (!map.getSource(SOURCE_SMOOTH)) {
    map.addSource(SOURCE_SMOOTH, {
      type: "geojson",
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

  if (!map.getLayer(LAYER_SMOOTH)) {
    map.addLayer({
      id: LAYER_SMOOTH,
      type: "line",
      source: SOURCE_SMOOTH,
      paint: {
        "line-color": "#3fb9ff",
        "line-width": 2.8,
        "line-opacity": 0.85
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
        "circle-color": "#ffe45c",
        "circle-stroke-color": "#6f5f00",
        "circle-stroke-width": 2
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
        "circle-color": "#ffffff",
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
  isPlaying,
  autoFollowMode,
  frontFollowMode,
  mapProvider,
  mapStyle,
  pointSize,
  pointStride,
  setAutoFollowMode,
  setFrontFollowMode,
  onToggleViewMode,
  onSelect
}: Viewer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const smoothedTrackRef = useRef(smoothedTrack);
  const pointFeaturesRef = useRef<Array<Record<string, unknown>>>([]);
  const pointSizeRef = useRef(pointSize);
  const manualFollowUntilRef = useRef(0);
  const lastDataPushAtRef = useRef(0);
  const dataPushTimerRef = useRef<number | null>(null);
  const dataPushPendingRef = useRef(false);
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
  };

  const applyPointRadii = (map: maplibregl.Map) => {
    if (!map || !map.getStyle()) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => applyPointRadii(map));
      return;
    }

    try {
      map.setPaintProperty(LAYER_MIDDLE, "circle-radius", 2.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_START, "circle-radius", 4.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_END, "circle-radius", 4.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_CURRENT, "circle-radius", 5.3 * pointSizeRef.current);
      map.setPaintProperty(LAYER_SELECTED, "circle-radius", 5 * pointSizeRef.current);
    } catch {
      map.once("idle", () => applyPointRadii(map));
    }
  };

  const pushMapData = (map: maplibregl.Map) => {
    if (!map || !map.getStyle()) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => pushMapData(map));
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
          coordinates: smoothedTrackRef.current
        }
      } as any);

      const pointSource = map.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource | undefined;
      pointSource?.setData({
        type: "FeatureCollection",
        features: pointFeaturesRef.current
      } as any);

      dataPushPendingRef.current = false;
      lastDataPushAtRef.current = performance.now();
    } catch {
      map.once("idle", () => pushMapData(map));
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

  const displaySmoothedTrack = useMemo<[number, number][]>(() => {
    const trailRange = resolveTrailRange(points, currentIndex, isPlaying, PLAYBACK_TRAIL_WINDOW_MS);
    if (trailRange.endIndex < 0) {
      return [];
    }

    let sourceTrack: [number, number][] = displaySmoothedTrackBase;
    if (isPlaying && points.length > 1 && displaySmoothedTrackBase.length > 1) {
      const samplePerSegment = Math.max(
        1,
        Math.round((displaySmoothedTrackBase.length - 1) / Math.max(points.length - 1, 1))
      );
      const startOffset = Math.max(
        0,
        Math.min(displaySmoothedTrackBase.length - 1, trailRange.startIndex * samplePerSegment)
      );
      const endOffset = Math.max(
        startOffset,
        Math.min(displaySmoothedTrackBase.length - 1, trailRange.endIndex * samplePerSegment)
      );
      sourceTrack = displaySmoothedTrackBase.slice(startOffset, endOffset + 1);
    }

    if (!isPlaying) {
      return sourceTrack;
    }

    return downsampleLineVertices(sourceTrack, PLAYBACK_MAX_LINE_VERTICES);
  }, [displaySmoothedTrackBase, points, currentIndex, isPlaying]);

  const pointFeatures = useMemo(() => {
    const result: Array<Record<string, unknown>> = [];
    if (points.length === 0 || displayPoints.length === 0) {
      return result;
    }

    const trailRange = resolveTrailRange(points, currentIndex, isPlaying, PLAYBACK_TRAIL_WINDOW_MS);
    const includeIndexes = new Set<number>();

    if (trailRange.endIndex >= 0 && isPlaying) {
      const total = Math.max(0, trailRange.endIndex - trailRange.startIndex + 1);
      const playbackStride = Math.max(1, Math.ceil(total / PLAYBACK_MAX_POINT_FEATURES));
      for (let index = trailRange.startIndex; index <= trailRange.endIndex; index += playbackStride) {
        includeIndexes.add(index);
      }
      includeIndexes.add(trailRange.endIndex);
    } else {
      points.forEach((_, index) => {
        if (index === 0 || index === points.length - 1 || index % pointStride === 0) {
          includeIndexes.add(index);
        }
        if (index === selectedIndex || index === currentIndex) {
          includeIndexes.add(index);
        }
      });
    }

    if (selectedIndex >= 0 && selectedIndex < points.length) {
      includeIndexes.add(selectedIndex);
    }
    if (currentIndex >= 0 && currentIndex < points.length) {
      includeIndexes.add(currentIndex);
    }

    includeIndexes.forEach((index) => {
      if (isPlaying && trailRange.endIndex >= 0) {
        if (index < trailRange.startIndex || index > trailRange.endIndex) {
          return;
        }
      }
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
          coordinates: [displayPoint.lon, displayPoint.lat]
        }
      });
    });

    return result;
  }, [points, displayPoints, pointStride, selectedIndex, currentIndex, isPlaying]);

  useEffect(() => {
    smoothedTrackRef.current = displaySmoothedTrack;
    pointFeaturesRef.current = pointFeatures;
    if (mapRef.current) {
      scheduleMapDataPush(mapRef.current, isPlaying);
    }
  }, [displaySmoothedTrack, pointFeatures, isPlaying]);

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

    const clickableLayers = [LAYER_MIDDLE, LAYER_START, LAYER_END, LAYER_CURRENT, LAYER_SELECTED];

    map.on("load", () => {
      ensureLayers(map);
      applyPointRadii(map);
      pushMapData(map);

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
