import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { wgs84ToGcj02 } from "../../lib/math/coordTransform";
import { buildTileUrl, getRasterTileConfig } from "../../lib/map/rasterTiles";
import { resolveTrailCursorRange } from "../../lib/playback/trailWindow";
import type { AltitudeMode, FlightPoint, MapProvider, MapStyleMode } from "../../types/flight";
import { ViewerCornerControls } from "./ViewerCornerControls";
import { ViewerNavigationControls } from "./ViewerNavigationControls";
import { ViewerSpeedLegend } from "./ViewerSpeedLegend";

interface Viewer3DProps {
  points: FlightPoint[];
  altitudeMode: AltitudeMode;
  mapProvider: MapProvider;
  mapStyle: MapStyleMode;
  zScale: number;
  currentIndex: number;
  playbackCursor: number;
  isPlaying: boolean;
  autoFollowMode: boolean;
  frontFollowMode: boolean;
  trackWidth: number;
  setAutoFollowMode: (enabled: boolean) => void;
  setFrontFollowMode: (enabled: boolean) => void;
  onToggleViewMode: () => void;
}

interface DisplayGeoPoint {
  index: number;
  timestampMs: number;
  lon: number;
  lat: number;
  altitude: number;
  speedKmh: number | null;
}

interface LocalTrackPoint {
  index: number;
  x: number;
  y: number;
  z: number;
}

interface MarkerData {
  index: number;
  role: "start" | "middle" | "end";
  isCurrent: boolean;
  position: [number, number, number];
}

interface CometLineData {
  points: Array<[number, number, number]>;
  outerColors: Array<[number, number, number, number]>;
  innerColors: Array<[number, number, number, number]>;
}

interface TilePlaneData {
  key: string;
  url: string;
  position: [number, number, number];
  width: number;
  height: number;
}

interface TileViewport {
  centerX: number;
  centerY: number;
  coverageMeters: number;
  token: string;
}

interface TileTextureCacheEntry {
  status: "loading" | "loaded" | "error";
  texture: THREE.Texture | null;
  promise: Promise<THREE.Texture> | null;
  lastUsedAt: number;
}

interface SceneData {
  localTrackPoints: LocalTrackPoint[];
  target: [number, number, number];
  xySpan: number;
  zSpan: number;
  hasProjection: boolean;
  originLon: number;
  originLat: number;
  cosOriginLat: number;
  fitToken: string;
}

interface FollowSnapshot3D {
  current: [number, number, number];
  lead: [number, number, number];
  speedMps: number;
  verticalSpeedMps: number;
  turnRateDegPerSec: number;
  lookAheadMs: number;
}

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MAX_MERCATOR_LAT = 85.05112878;
const TILE_BUDGET = 196;
const TILE_MIN_ZOOM = 5;
const TILE_MAX_ZOOM = 19;
const TILE_LAYOUT_ROUND = true;
const TILE_TEXTURE_CACHE_MAX_ENTRIES = 320;
const SKY_TOP_COLOR = "#0a2138";
const SKY_HORIZON_COLOR = "#55788f";
const SKY_BOTTOM_COLOR = "#5b7688";
const FOG_COLOR = SKY_HORIZON_COLOR;
const GROUND_HAZE_INNER_COLOR = "#4b6477";
const GROUND_HAZE_OUTER_COLOR = "#7f99ac";
const PLAYBACK_TRAIL_WINDOW_MS = 10_000;
const PLAYBACK_MAX_LINE_VERTICES = 900;
const PLAYBACK_SMOOTH_SAMPLES_PER_SEGMENT = 4;
const PLAYBACK_SMOOTH_TENSION = 0.2;
const FOLLOW_LOOK_AHEAD_DEFAULT_MS = 1400;
const FOLLOW_LOOK_AHEAD_MIN_MS = 700;
const FOLLOW_LOOK_AHEAD_MAX_MS = 3200;
const FOLLOW_MANUAL_HOLD_MS = 3000;
const CAMERA_NAV_ANIMATION_MS = 220;
const TRACK_OUTER_WIDTH_3D = 1.92;
const TRACK_OUTER_MIN_WIDTH_3D = 1.72;
const TRACK_INNER_WIDTH_3D = 1.52;
const TRACK_INNER_MIN_WIDTH_3D = 1.22;
const TRACK_INNER_SHADE_3D = 0.2;

const SKY_VERTEX_SHADER = `
varying float vHeight;

void main() {
  vHeight = normalize(position).z;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT_SHADER = `
uniform vec3 topColor;
uniform vec3 horizonColor;
uniform vec3 bottomColor;
varying float vHeight;

void main() {
  float h = clamp(vHeight, -1.0, 1.0);
  float t = h * 0.5 + 0.5;
  float lowMix = smoothstep(0.0, 0.62, t);
  float highMix = smoothstep(0.45, 1.0, t);
  vec3 lowColor = mix(bottomColor, horizonColor, lowMix);
  vec3 highColor = mix(horizonColor, topColor, highMix);
  vec3 color = mix(lowColor, highColor, smoothstep(0.2, 0.86, t));
  gl_FragColor = vec4(color, 1.0);
}
`;

const GROUND_HAZE_VERTEX_SHADER = `
uniform float radius;
varying float vR;

void main() {
  vR = clamp(length(position.xy) / max(radius, 0.001), 0.0, 1.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const GROUND_HAZE_FRAGMENT_SHADER = `
uniform vec3 innerColor;
uniform vec3 outerColor;
varying float vR;

void main() {
  float haze = smoothstep(0.2, 0.78, vR);
  float edgeFade = 1.0 - smoothstep(0.9, 1.0, vR);
  float alpha = (0.01 + 0.2 * haze) * edgeFade;
  vec3 color = mix(innerColor, outerColor, haze);
  gl_FragColor = vec4(color, alpha);
}
`;

const tileTextureLoader = new THREE.TextureLoader();
tileTextureLoader.setCrossOrigin("anonymous");
const tileTextureCache = new Map<string, TileTextureCacheEntry>();
let tileTextureCacheEpoch = 0;

function markTileTextureUsed(entry: TileTextureCacheEntry) {
  entry.lastUsedAt = performance.now();
}

function configureTileTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

function disposeTileTextureCacheEntry(entry: TileTextureCacheEntry) {
  entry.texture?.dispose();
}

function pruneTileTextureCache(activeUrls: Iterable<string>) {
  const activeSet = new Set(activeUrls);
  const targetSize = Math.max(TILE_TEXTURE_CACHE_MAX_ENTRIES, activeSet.size);
  if (tileTextureCache.size <= targetSize) {
    return;
  }

  const evictable: Array<{ url: string; lastUsedAt: number }> = [];
  tileTextureCache.forEach((entry, url) => {
    if (entry.status === "loading" || activeSet.has(url)) {
      return;
    }
    evictable.push({ url, lastUsedAt: entry.lastUsedAt });
  });
  evictable.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

  let removeCount = tileTextureCache.size - targetSize;
  for (const candidate of evictable) {
    if (removeCount <= 0) {
      break;
    }
    const entry = tileTextureCache.get(candidate.url);
    if (!entry || entry.status === "loading" || activeSet.has(candidate.url)) {
      continue;
    }
    disposeTileTextureCacheEntry(entry);
    tileTextureCache.delete(candidate.url);
    removeCount -= 1;
  }
}

function clearTileTextureCache() {
  tileTextureCacheEpoch += 1;
  tileTextureCache.forEach((entry) => {
    disposeTileTextureCacheEntry(entry);
  });
  tileTextureCache.clear();
}

function getLoadedTileTexture(url: string): THREE.Texture | null {
  const cached = tileTextureCache.get(url);
  if (!cached || cached.status !== "loaded" || !cached.texture) {
    return null;
  }
  markTileTextureUsed(cached);
  return cached.texture;
}

function ensureTileTexture(url: string): Promise<THREE.Texture> {
  const requestEpoch = tileTextureCacheEpoch;
  const existing = tileTextureCache.get(url);
  if (existing?.status === "loaded" && existing.texture) {
    markTileTextureUsed(existing);
    return Promise.resolve(existing.texture);
  }
  if (existing?.status === "loading" && existing.promise) {
    markTileTextureUsed(existing);
    return existing.promise;
  }
  if (existing?.status === "error") {
    markTileTextureUsed(existing);
  }

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    tileTextureLoader.load(
      url,
      (texture) => {
        configureTileTexture(texture);
        if (requestEpoch !== tileTextureCacheEpoch) {
          texture.dispose();
          reject(new Error("stale-tile-request"));
          return;
        }
        tileTextureCache.set(url, {
          status: "loaded",
          texture,
          promise: null,
          lastUsedAt: performance.now()
        });
        resolve(texture);
      },
      undefined,
      (error) => {
        if (requestEpoch !== tileTextureCacheEpoch) {
          reject(error);
          return;
        }
        const previous = tileTextureCache.get(url);
        if (previous) {
          disposeTileTextureCacheEntry(previous);
        }
        tileTextureCache.set(url, {
          status: "error",
          texture: null,
          promise: null,
          lastUsedAt: performance.now()
        });
        reject(error);
      }
    );
  });

  const previous = tileTextureCache.get(url);
  if (previous) {
    disposeTileTextureCacheEntry(previous);
  }
  tileTextureCache.set(url, {
    status: "loading",
    texture: null,
    promise,
    lastUsedAt: performance.now()
  });

  return promise;
}

function preloadTileTextures(urls: string[]): Promise<void> {
  return Promise.allSettled(urls.map((url) => ensureTileTexture(url))).then(() => undefined);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeAngleDeg(value: number): number {
  let normalized = value % 360;
  if (normalized > 180) {
    normalized -= 360;
  }
  if (normalized <= -180) {
    normalized += 360;
  }
  return normalized;
}

function angleDiffDeg(target: number, source: number): number {
  return normalizeAngleDeg(target - source);
}

function deriveHeadingDeg(from: LocalTrackPoint, to: LocalTrackPoint): number | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.hypot(dx, dy) < 0.8) {
    return null;
  }
  return normalizeAngleDeg((Math.atan2(dx, dy) * 180) / Math.PI);
}

function computeDynamicLookAheadMs(
  speedMps: number,
  turnRateDegPerSec: number,
  verticalSpeedMps: number
): number {
  const baseMs = 900;
  const speedBoostMs = clamp(speedMps, 0, 42) * 60;
  const turnPenalty = 1 - clamp((turnRateDegPerSec - 8) / 40, 0, 1) * 0.5;
  const verticalPenalty = 1 - clamp((Math.abs(verticalSpeedMps) - 1.2) / 6, 0, 1) * 0.25;
  const lookAheadMs = (baseMs + speedBoostMs) * turnPenalty * verticalPenalty;
  return clamp(lookAheadMs, FOLLOW_LOOK_AHEAD_MIN_MS, FOLLOW_LOOK_AHEAD_MAX_MS);
}

function smoothLookAheadMs(previousMs: number, nextMs: number): number {
  if (!Number.isFinite(previousMs) || previousMs <= 0) {
    return nextMs;
  }
  const alpha = nextMs < previousMs ? 0.36 : 0.2;
  return previousMs + (nextMs - previousMs) * alpha;
}

function easeOutCubic(tRaw: number): number {
  const t = clamp(tRaw, 0, 1);
  return 1 - Math.pow(1 - t, 3);
}

function resolveInterpolatedLeadLocalPoint(
  localTrackPoints: LocalTrackPoint[],
  points: FlightPoint[],
  currentIndex: number,
  lookAheadMs: number
): LocalTrackPoint {
  const clampedCurrent = Math.max(0, Math.min(points.length - 1, currentIndex));
  const current = localTrackPoints[clampedCurrent] ?? {
    index: clampedCurrent,
    x: 0,
    y: 0,
    z: 0
  };
  const currentTs = points[clampedCurrent]?.timestampMs;
  if (!Number.isFinite(currentTs)) {
    return localTrackPoints[Math.min(localTrackPoints.length - 1, clampedCurrent + 1)] ?? current;
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
    return localTrackPoints[localTrackPoints.length - 1] ?? current;
  }

  const lower = Math.max(clampedCurrent, upper - 1);
  const lowerPoint = localTrackPoints[lower] ?? current;
  const upperPoint = localTrackPoints[upper] ?? lowerPoint;
  const lowerTs = points[lower]?.timestampMs;
  const upperTs = points[upper]?.timestampMs;

  if (!Number.isFinite(lowerTs) || !Number.isFinite(upperTs) || upperTs <= lowerTs) {
    return upperPoint;
  }

  const alpha = clamp((targetTs - lowerTs) / (upperTs - lowerTs), 0, 1);
  return {
    index: lower,
    x: lowerPoint.x + (upperPoint.x - lowerPoint.x) * alpha,
    y: lowerPoint.y + (upperPoint.y - lowerPoint.y) * alpha,
    z: lowerPoint.z + (upperPoint.z - lowerPoint.z) * alpha
  };
}

function projectToLocal(
  lon: number,
  lat: number,
  originLon: number,
  originLat: number,
  cosOriginLat: number
): { x: number; y: number } {
  const dLon = (lon - originLon) * DEG_TO_RAD;
  const dLat = (lat - originLat) * DEG_TO_RAD;

  return {
    x: dLon * cosOriginLat * EARTH_RADIUS_M,
    y: dLat * EARTH_RADIUS_M
  };
}

function localToGeo(
  x: number,
  y: number,
  originLon: number,
  originLat: number,
  cosOriginLat: number
): { lon: number; lat: number } {
  const lat = originLat + (y / EARTH_RADIUS_M) * RAD_TO_DEG;
  const lon = originLon + (x / (EARTH_RADIUS_M * Math.max(Math.abs(cosOriginLat), 1e-6))) * RAD_TO_DEG;
  return {
    lon: clamp(lon, -180, 180),
    lat: clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT)
  };
}

function lonToTileX(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * Math.pow(2, zoom);
}

function latToTileY(lat: number, zoom: number): number {
  const limitedLat = clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
  const latRad = limitedLat * DEG_TO_RAD;
  const n = Math.pow(2, zoom);
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
}

function tileXToLon(x: number, zoom: number): number {
  return (x / Math.pow(2, zoom)) * 360 - 180;
}

function tileYToLat(y: number, zoom: number): number {
  const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, zoom);
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

function pickFallbackSpeedKmh(
  start: DisplayGeoPoint,
  end: DisplayGeoPoint,
  startLocal: LocalTrackPoint,
  endLocal: LocalTrackPoint
): number {
  const dtMs = end.timestampMs - start.timestampMs;
  if (dtMs <= 0) {
    return 0;
  }

  const horizontalDistM = Math.hypot(endLocal.x - startLocal.x, endLocal.y - startLocal.y);
  const speedKmh = (horizontalDistM / (dtMs / 1000)) * 3.6;
  return Number.isFinite(speedKmh) ? speedKmh : 0;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    return 0;
  }

  const clampedP = clamp(p, 0, 1);
  if (sorted.length === 1) {
    return sorted[0];
  }

  const idx = clampedP * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  const alpha = idx - lower;
  const lowerValue = sorted[lower] ?? sorted[0];
  const upperValue = sorted[upper] ?? sorted[sorted.length - 1];
  return lowerValue + (upperValue - lowerValue) * alpha;
}

const SPEED_COLOR_SLOW: [number, number, number] = [0.4352941176, 0.5490196078, 1];
const SPEED_COLOR_MID: [number, number, number] = [0.431372549, 0.8039215686, 0.7254901961];
const SPEED_COLOR_FAST: [number, number, number] = [1, 0.7529411765, 0.4784313725];
const TRACK_OUTER_GLOW: [number, number, number] = [0.9568627451, 0.9843137255, 1];

function mixRgb(
  a: [number, number, number],
  b: [number, number, number],
  tRaw: number
): [number, number, number] {
  const t = clamp(tRaw, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function speedColorFromNormalized(normalizedSpeed: number): [number, number, number] {
  const t = clamp(normalizedSpeed, 0, 1);
  if (t <= 0.58) {
    return mixRgb(SPEED_COLOR_SLOW, SPEED_COLOR_MID, t / 0.58);
  }
  return mixRgb(SPEED_COLOR_MID, SPEED_COLOR_FAST, (t - 0.58) / 0.42);
}

function interpolateLocalTrackPoint(
  from: LocalTrackPoint,
  to: LocalTrackPoint,
  tRaw: number
): LocalTrackPoint {
  const t = clamp(tRaw, 0, 1);
  return {
    index: from.index,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    z: from.z + (to.z - from.z) * t
  };
}

function downsampleLineVertices3D(
  track: Array<[number, number, number]>,
  maxVertices: number
): Array<[number, number, number]> {
  if (track.length <= maxVertices || maxVertices < 2) {
    return track;
  }

  const result: Array<[number, number, number]> = [];
  const lastIndex = track.length - 1;
  const step = lastIndex / (maxVertices - 1);
  for (let i = 0; i < maxVertices; i += 1) {
    const sourceIndex = Math.min(lastIndex, Math.round(i * step));
    const coord = track[sourceIndex];
    if (!coord) {
      continue;
    }
    if (
      result.length === 0 ||
      result[result.length - 1]![0] !== coord[0] ||
      result[result.length - 1]![1] !== coord[1] ||
      result[result.length - 1]![2] !== coord[2]
    ) {
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

function catmullRom3(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number],
  t: number
): [number, number, number] {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 *
      ((2 * p1[0]) +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 *
      ((2 * p1[1]) +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
    0.5 *
      ((2 * p1[2]) +
        (-p0[2] + p2[2]) * t +
        (2 * p0[2] - 5 * p1[2] + 4 * p2[2] - p3[2]) * t2 +
        (-p0[2] + 3 * p1[2] - 3 * p2[2] + p3[2]) * t3)
  ];
}

function lerp3(
  a: [number, number, number],
  b: [number, number, number],
  tRaw: number
): [number, number, number] {
  const t = clamp(tRaw, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t
  ];
}

function buildSmoothedPolylineWithColors(
  points: Array<[number, number, number]>,
  colors: Array<[number, number, number, number]>,
  samplesPerSegment: number,
  tension: number
): { points: Array<[number, number, number]>; colors: Array<[number, number, number, number]> } {
  const segmentCount = points.length - 1;
  if (segmentCount <= 0) {
    return { points, colors: [] };
  }

  const smoothFactor = clamp(1 - tension, 0, 1);
  if (samplesPerSegment <= 1 || points.length <= 2 || smoothFactor <= 0) {
    const nextColors: Array<[number, number, number, number]> = [];
    for (let i = 0; i < segmentCount; i += 1) {
      const color = colors[i] ?? colors[colors.length - 1] ?? [0.5, 0.5, 0.5, 1];
      nextColors.push(color);
    }
    nextColors.push(nextColors[nextColors.length - 1] ?? [0.5, 0.5, 0.5, 1]);
    return { points, colors: nextColors };
  }

  const nextPoints: Array<[number, number, number]> = [];
  const nextColors: Array<[number, number, number, number]> = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const p0 = points[Math.max(0, i - 1)] ?? points[0];
    const p1 = points[i] ?? points[0];
    const p2 = points[i + 1] ?? p1;
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? p2;
    const color = colors[i] ?? colors[colors.length - 1] ?? [0.5, 0.5, 0.5, 1];

    for (let j = 0; j < samplesPerSegment; j += 1) {
      const t = j / samplesPerSegment;
      const smooth = catmullRom3(p0, p1, p2, p3, t);
      const linear = lerp3(p1, p2, t);
      nextPoints.push(lerp3(linear, smooth, smoothFactor));
      nextColors.push(color);
    }
  }

  nextPoints.push(points[points.length - 1] ?? points[0]!);
  nextColors.push(nextColors[nextColors.length - 1] ?? colors[colors.length - 1] ?? [0.5, 0.5, 0.5, 1]);
  return {
    points: nextPoints,
    colors: nextColors
  };
}

function markerColor(marker: MarkerData): string {
  if (marker.isCurrent) {
    return "#ffe39a";
  }
  if (marker.role === "start") {
    return "#53d584";
  }
  if (marker.role === "end") {
    return "#ff8b7f";
  }
  return "#7fd9e7";
}

function markerRadius(marker: MarkerData, trackWidth: number): number {
  if (marker.isCurrent) {
    return 1.22 * trackWidth;
  }
  if (marker.role === "start" || marker.role === "end") {
    return 1.35 * trackWidth;
  }
  return 1.02 * trackWidth;
}

function buildTilePlanes(
  tileTemplates: string[],
  centerX: number,
  centerY: number,
  coverageMeters: number,
  originLon: number,
  originLat: number,
  cosOriginLat: number,
  project: (lon: number, lat: number) => { x: number; y: number }
): TilePlaneData[] {
  if (tileTemplates.length === 0) {
    return [];
  }

  const effectiveCoverage = Math.max(coverageMeters * 1.2, 1000);
  const half = effectiveCoverage * 0.5;
  const corners = [
    localToGeo(centerX - half, centerY - half, originLon, originLat, cosOriginLat),
    localToGeo(centerX + half, centerY - half, originLon, originLat, cosOriginLat),
    localToGeo(centerX + half, centerY + half, originLon, originLat, cosOriginLat),
    localToGeo(centerX - half, centerY + half, originLon, originLat, cosOriginLat)
  ];

  let minLon = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const corner of corners) {
    minLon = Math.min(minLon, corner.lon);
    maxLon = Math.max(maxLon, corner.lon);
    minLat = Math.min(minLat, corner.lat);
    maxLat = Math.max(maxLat, corner.lat);
  }

  let chosenZoom = TILE_MIN_ZOOM;
  let chosenTileBounds: [number, number, number, number] = [0, 0, 0, 0];

  for (let zoom = TILE_MAX_ZOOM; zoom >= TILE_MIN_ZOOM; zoom -= 1) {
    const n = Math.pow(2, zoom);
    const tileXMin = clamp(Math.floor(lonToTileX(minLon, zoom)), 0, n - 1);
    const tileXMax = clamp(Math.floor(lonToTileX(maxLon, zoom)), 0, n - 1);
    const tileYMin = clamp(Math.floor(latToTileY(maxLat, zoom)), 0, n - 1);
    const tileYMax = clamp(Math.floor(latToTileY(minLat, zoom)), 0, n - 1);

    const count = (tileXMax - tileXMin + 1) * (tileYMax - tileYMin + 1);
    if (count <= TILE_BUDGET) {
      chosenZoom = zoom;
      chosenTileBounds = [tileXMin, tileXMax, tileYMin, tileYMax];
      break;
    }

    chosenZoom = zoom;
    chosenTileBounds = [tileXMin, tileXMax, tileYMin, tileYMax];
  }

  const [tileXMin, tileXMax, tileYMin, tileYMax] = chosenTileBounds;
  const tilePlanes: TilePlaneData[] = [];
  const circleRadius = half;
  const seamPadding = Math.max(12, circleRadius * 0.015);

  for (let tileX = tileXMin; tileX <= tileXMax; tileX += 1) {
    for (let tileY = tileYMin; tileY <= tileYMax; tileY += 1) {
      const westLon = tileXToLon(tileX, chosenZoom);
      const eastLon = tileXToLon(tileX + 1, chosenZoom);
      const northLat = tileYToLat(tileY, chosenZoom);
      const southLat = tileYToLat(tileY + 1, chosenZoom);

      const centerLon = (westLon + eastLon) / 2;
      const centerLat = (northLat + southLat) / 2;
      const center = project(centerLon, centerLat);

      const east = project(eastLon, centerLat);
      const west = project(westLon, centerLat);
      const north = project(centerLon, northLat);
      const south = project(centerLon, southLat);

      const width = Math.max(1, Math.abs(east.x - west.x));
      const height = Math.max(1, Math.abs(north.y - south.y));
      if (TILE_LAYOUT_ROUND) {
        const centerDistance = Math.hypot(center.x - centerX, center.y - centerY);
        const tileCornerAllowance = Math.hypot(width, height) * 0.32;
        const includeLimit = circleRadius + tileCornerAllowance + seamPadding;
        if (centerDistance > includeLimit) {
          continue;
        }
      }

      const url = buildTileUrl(tileTemplates, chosenZoom, tileX, tileY);

      tilePlanes.push({
        key: `${chosenZoom}-${tileX}-${tileY}`,
        url,
        position: [center.x, center.y, -0.25],
        width,
        height
      });
    }
  }

  return tilePlanes;
}

function pickDynamicCoverageMeters(distance: number, xySpan: number): number {
  return clamp(Math.max(xySpan * 3.2, distance * 4.6, 2500), 2500, 260000);
}

function buildViewToken(centerX: number, centerY: number, coverageMeters: number): string {
  return `${centerX.toFixed(0)}-${centerY.toFixed(0)}-${coverageMeters.toFixed(0)}`;
}

function parseTileZoom(tile: TilePlaneData | undefined): number | null {
  if (!tile) {
    return null;
  }
  const zoom = Number(tile.key.split("-")[0]);
  return Number.isFinite(zoom) ? zoom : null;
}

function buildTilePlanesFromViewport(
  tileTemplates: string[],
  centerX: number,
  centerY: number,
  coverageMeters: number,
  originLon: number,
  originLat: number,
  cosOriginLat: number
): TilePlaneData[] {
  return buildTilePlanes(
    tileTemplates,
    centerX,
    centerY,
    coverageMeters,
    originLon,
    originLat,
    cosOriginLat,
    (lon, lat) => projectToLocal(lon, lat, originLon, originLat, cosOriginLat)
  );
}

function HorizonSky({
  centerX,
  centerY,
  radius
}: {
  centerX: number;
  centerY: number;
  radius: number;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          topColor: { value: new THREE.Color(SKY_TOP_COLOR) },
          horizonColor: { value: new THREE.Color(SKY_HORIZON_COLOR) },
          bottomColor: { value: new THREE.Color(SKY_BOTTOM_COLOR) }
        },
        vertexShader: SKY_VERTEX_SHADER,
        fragmentShader: SKY_FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false
      }),
    []
  );

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  return (
    <mesh position={[centerX, centerY, 0]} renderOrder={-20}>
      <sphereGeometry args={[radius, 48, 24]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function GroundHaze({
  centerX,
  centerY,
  radius,
  z
}: {
  centerX: number;
  centerY: number;
  radius: number;
  z: number;
}) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          radius: { value: radius },
          innerColor: { value: new THREE.Color(GROUND_HAZE_INNER_COLOR) },
          outerColor: { value: new THREE.Color(GROUND_HAZE_OUTER_COLOR) }
        },
        vertexShader: GROUND_HAZE_VERTEX_SHADER,
        fragmentShader: GROUND_HAZE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false
      }),
    [radius]
  );

  useEffect(() => {
    material.uniforms.radius.value = radius;
  }, [material, radius]);

  useEffect(() => {
    return () => material.dispose();
  }, [material]);

  return (
    <mesh position={[centerX, centerY, z]} renderOrder={-6}>
      <circleGeometry args={[radius, 96]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}

function RasterTile({ tile }: { tile: TilePlaneData }) {
  const [texture, setTexture] = useState<THREE.Texture | null>(() => getLoadedTileTexture(tile.url));

  useEffect(() => {
    const cached = getLoadedTileTexture(tile.url);
    if (cached) {
      setTexture(cached);
      return;
    }

    let disposed = false;
    setTexture(null);
    void ensureTileTexture(tile.url)
      .then((nextTexture) => {
        if (!disposed) {
          setTexture(nextTexture);
        }
      })
      .catch(() => {
        if (!disposed) {
          setTexture(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, [tile.url]);

  if (!texture) {
    return null;
  }

  return (
    <mesh position={tile.position} renderOrder={0}>
      <planeGeometry args={[tile.width, tile.height]} />
      <meshBasicMaterial map={texture} toneMapped={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
    </mesh>
  );
}

function AutoFollowRig({
  controlsRef,
  followSnapshot,
  isPlaying,
  autoFollowMode,
  frontFollowMode,
  xySpan,
  manualFollowUntilRef
}: {
  controlsRef: MutableRefObject<OrbitControlsImpl | null>;
  followSnapshot: FollowSnapshot3D | null;
  isPlaying: boolean;
  autoFollowMode: boolean;
  frontFollowMode: boolean;
  xySpan: number;
  manualFollowUntilRef: MutableRefObject<number>;
}) {
  const initializedRef = useRef(false);
  const cameraOffsetRef = useRef(new THREE.Vector3(160, -150, 100));
  const smoothedForwardRef = useRef(new THREE.Vector3(0, 1, 0));
  const currentRef = useRef(new THREE.Vector3());
  const leadRef = useRef(new THREE.Vector3());
  const desiredForwardRef = useRef(new THREE.Vector3());
  const desiredPositionRef = useRef(new THREE.Vector3());
  const desiredTargetRef = useRef(new THREE.Vector3());
  const chasePositionRef = useRef(new THREE.Vector3());
  const topPositionRef = useRef(new THREE.Vector3());
  const chaseTargetRef = useRef(new THREE.Vector3());
  const topTargetRef = useRef(new THREE.Vector3());
  const rightRef = useRef(new THREE.Vector3());
  const up = useMemo(() => new THREE.Vector3(0, 0, 1), []);

  useEffect(() => {
    if (!isPlaying || (!autoFollowMode && !frontFollowMode) || !followSnapshot) {
      initializedRef.current = false;
    }
  }, [isPlaying, autoFollowMode, frontFollowMode, followSnapshot]);

  useFrame((state, delta) => {
    const controls = controlsRef.current;
    if (!controls || !followSnapshot) {
      return;
    }

    const shouldTrack = isPlaying && (autoFollowMode || frontFollowMode);
    if (!shouldTrack) {
      return;
    }

    if (performance.now() < manualFollowUntilRef.current) {
      return;
    }

    const camera = state.camera as THREE.PerspectiveCamera;
    currentRef.current.set(...followSnapshot.current);
    leadRef.current.set(...followSnapshot.lead);
    desiredForwardRef.current.copy(leadRef.current).sub(currentRef.current);
    if (desiredForwardRef.current.lengthSq() < 1e-6) {
      return;
    }
    desiredForwardRef.current.normalize();

    if (!initializedRef.current) {
      initializedRef.current = true;
      smoothedForwardRef.current.copy(desiredForwardRef.current);
      cameraOffsetRef.current.copy(camera.position).sub(controls.target);
      if (cameraOffsetRef.current.lengthSq() < 1) {
        cameraOffsetRef.current.set(160, -150, 100);
      }
    }

    const speed = followSnapshot.speedMps;
    const turn = followSnapshot.turnRateDegPerSec;
    const vertical = Math.abs(followSnapshot.verticalSpeedMps);
    const speedFactor = clamp(speed / 34, 0, 1);
    const turnFactor = clamp(turn / 70, 0, 1);
    const verticalFactor = clamp(vertical / 9, 0, 1);
    const agitation = clamp(speedFactor * 0.22 + turnFactor * 0.72 + verticalFactor * 0.38, 0, 1);

    const dirAngle = smoothedForwardRef.current.angleTo(desiredForwardRef.current);
    const dirDeadZone = THREE.MathUtils.degToRad(1.3 + (1 - agitation) * 1.2);
    if (dirAngle > dirDeadZone) {
      const dirAlpha = 1 - Math.exp(-delta * (2.2 + agitation * 3.1));
      smoothedForwardRef.current.lerp(desiredForwardRef.current, dirAlpha).normalize();
    }

    const dynamicDistance = clamp(155 + speed * 4.8 + turn * 1.15, 155, Math.max(560, xySpan * 4.8));
    const dynamicHeight = clamp(52 + speed * 2.15 + vertical * 5.4, 48, Math.max(260, xySpan * 2.05));
    const fixedDistance = clamp(Math.max(170, xySpan * 1.28), 170, Math.max(520, xySpan * 4.3));
    const fixedHeight = clamp(Math.max(52, xySpan * 0.4), 50, Math.max(220, xySpan * 1.85));
    const followDistance = autoFollowMode ? dynamicDistance : fixedDistance;
    const followHeight = autoFollowMode ? dynamicHeight : fixedHeight;
    const stableTurn = clamp(1 - turn / 16, 0, 1);
    const stableVertical = clamp(1 - vertical / 3.4, 0, 1);
    const stableSpeed = clamp((speed - 4.5) / 10, 0, 1);
    const topBlend = autoFollowMode && !frontFollowMode ? stableTurn * stableVertical * stableSpeed : 0;

    rightRef.current.crossVectors(smoothedForwardRef.current, up);
    if (rightRef.current.lengthSq() < 1e-6) {
      rightRef.current.set(1, 0, 0);
    } else {
      rightRef.current.normalize();
    }

    if (frontFollowMode) {
      desiredTargetRef.current
        .copy(currentRef.current)
        .addScaledVector(smoothedForwardRef.current, Math.max(18, followDistance * 0.26));
      desiredPositionRef.current
        .copy(currentRef.current)
        .addScaledVector(smoothedForwardRef.current, -followDistance)
        .addScaledVector(up, followHeight)
        .addScaledVector(rightRef.current, followDistance * 0.06);
    } else {
      chasePositionRef.current
        .copy(currentRef.current)
        .addScaledVector(smoothedForwardRef.current, -followDistance * 0.72)
        .addScaledVector(up, followHeight)
        .addScaledVector(rightRef.current, followDistance * 0.05);
      topPositionRef.current
        .copy(currentRef.current)
        .addScaledVector(up, followHeight * 1.95 + followDistance * 0.42)
        .addScaledVector(rightRef.current, followDistance * 0.02);

      desiredPositionRef.current.copy(chasePositionRef.current).lerp(topPositionRef.current, topBlend);

      chaseTargetRef.current
        .copy(currentRef.current)
        .addScaledVector(smoothedForwardRef.current, followDistance * 0.12);
      topTargetRef.current.copy(currentRef.current).addScaledVector(up, Math.min(14, followHeight * 0.09));
      desiredTargetRef.current.copy(chaseTargetRef.current).lerp(topTargetRef.current, topBlend);
    }

    const positionAlpha = 1 - Math.exp(-delta * (1.7 + agitation * 2.1));
    const targetAlpha = 1 - Math.exp(-delta * (frontFollowMode ? 2.1 + agitation * 2 : 1.5 + agitation * 1.6));
    camera.position.lerp(desiredPositionRef.current, positionAlpha);
    controls.target.lerp(desiredTargetRef.current, targetAlpha);
    controls.update();
    cameraOffsetRef.current.copy(camera.position).sub(controls.target);
  });

  return null;
}

function CurrentPulseRing({
  position,
  trackWidth
}: {
  position: [number, number, number];
  trackWidth: number;
}) {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const baseRadius = Math.max(1.4, trackWidth * 2.25);
  const tubeRadius = Math.max(0.16, trackWidth * 0.28);

  useFrame((state) => {
    const mesh = meshRef.current;
    const material = materialRef.current;
    if (!mesh || !material) {
      return;
    }

    const wave = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 5.2);
    const scale = 1 + 0.22 * wave;
    mesh.scale.setScalar(scale);
    material.opacity = 0.24 + (1 - wave) * 0.62;
  });

  return (
    <mesh
      ref={meshRef}
      position={[position[0], position[1], position[2] + 0.22]}
      renderOrder={9}
    >
      <torusGeometry args={[baseRadius, tubeRadius, 14, 56]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#ffe082"
        transparent
        opacity={0.68}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

export function Viewer3D({
  points,
  altitudeMode,
  mapProvider,
  mapStyle,
  zScale,
  currentIndex,
  playbackCursor,
  isPlaying,
  autoFollowMode,
  frontFollowMode,
  trackWidth,
  setAutoFollowMode,
  setFrontFollowMode,
  onToggleViewMode
}: Viewer3DProps) {
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const manualFollowUntilRef = useRef(0);
  const lookAheadMsRef = useRef(FOLLOW_LOOK_AHEAD_DEFAULT_MS);
  const tileTransitionJobRef = useRef(0);
  const prevRenderedTileZoomRef = useRef<number | null>(null);
  const lastTileViewportUpdateMsRef = useRef(0);
  const cameraNavAnimationFrameRef = useRef<number | null>(null);
  const cameraNavStartPositionRef = useRef(new THREE.Vector3());
  const cameraNavEndPositionRef = useRef(new THREE.Vector3());
  const cameraNavStartTargetRef = useRef(new THREE.Vector3());
  const cameraNavEndTargetRef = useRef(new THREE.Vector3());
  const [cameraBearingDeg, setCameraBearingDeg] = useState(0);
  const [tileViewport, setTileViewport] = useState<TileViewport>({
    centerX: 0,
    centerY: 0,
    coverageMeters: 2500,
    token: buildViewToken(0, 0, 2500)
  });
  const [renderTilePlanes, setRenderTilePlanes] = useState<TilePlaneData[]>([]);
  const renderTilePlanesRef = useRef<TilePlaneData[]>([]);

  const displayGeoPoints = useMemo<DisplayGeoPoint[]>(() => {
    return points.map((point) => {
      const geo = mapProvider === "amap" ? wgs84ToGcj02(point.lon, point.lat) : { lon: point.lon, lat: point.lat };
      return {
        index: point.index,
        timestampMs: point.timestampMs,
        lon: geo.lon,
        lat: geo.lat,
        altitude: altitudeMode === "alt1" ? point.alt1 : point.alt2,
        speedKmh: point.speedKmh
      };
    });
  }, [points, mapProvider, altitudeMode]);

  const tileConfig = useMemo(() => getRasterTileConfig(mapProvider, mapStyle), [mapProvider, mapStyle]);

  const clampedPlaybackCursor = useMemo(
    () => clamp(playbackCursor, 0, Math.max(points.length - 1, 0)),
    [playbackCursor, points.length]
  );

  const trailCursorRange = useMemo(
    () => resolveTrailCursorRange(points, clampedPlaybackCursor, isPlaying, PLAYBACK_TRAIL_WINDOW_MS),
    [points, clampedPlaybackCursor, isPlaying]
  );

  const sceneData = useMemo<SceneData>(() => {
    if (displayGeoPoints.length === 0) {
      return {
        localTrackPoints: [],
        target: [0, 0, 0],
        xySpan: 120,
        zSpan: 80,
        hasProjection: false,
        originLon: 0,
        originLat: 0,
        cosOriginLat: 1,
        fitToken: "empty"
      };
    }

    const origin = displayGeoPoints[0];
    const cosOriginLat = Math.cos(origin.lat * DEG_TO_RAD);
    const minAltitude = displayGeoPoints.reduce((min, point) => Math.min(min, point.altitude), Number.POSITIVE_INFINITY);

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    const localTrackPoints = displayGeoPoints.map((point) => {
      const local = projectToLocal(point.lon, point.lat, origin.lon, origin.lat, cosOriginLat);
      const z = Math.max(0, (point.altitude - minAltitude) * zScale);

      minX = Math.min(minX, local.x);
      maxX = Math.max(maxX, local.x);
      minY = Math.min(minY, local.y);
      maxY = Math.max(maxY, local.y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);

      return {
        index: point.index,
        x: local.x,
        y: local.y,
        z
      };
    });

    const xySpan = Math.max(maxX - minX, maxY - minY, 120);
    const zSpan = Math.max(maxZ - minZ, 60);
    const target: [number, number, number] = [
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2
    ];

    return {
      localTrackPoints,
      target,
      xySpan,
      zSpan,
      hasProjection: true,
      originLon: origin.lon,
      originLat: origin.lat,
      cosOriginLat,
      fitToken: `${localTrackPoints.length}-${minX.toFixed(2)}-${maxX.toFixed(2)}-${minY.toFixed(2)}-${maxY.toFixed(2)}`
    };
  }, [
    displayGeoPoints,
    zScale
  ]);

  const baseSegmentSpeeds = useMemo<number[]>(() => {
    const maxSegmentIndex = Math.min(displayGeoPoints.length, sceneData.localTrackPoints.length) - 1;
    if (maxSegmentIndex <= 0) {
      return [];
    }

    const speeds: number[] = [];
    for (let i = 0; i < maxSegmentIndex; i += 1) {
      const current = displayGeoPoints[i];
      const next = displayGeoPoints[i + 1];
      const currentLocal = sceneData.localTrackPoints[i];
      const nextLocal = sceneData.localTrackPoints[i + 1];
      if (!current || !next || !currentLocal || !nextLocal) {
        speeds.push(0);
        continue;
      }

      const speedFromCsv =
        typeof current.speedKmh === "number" && Number.isFinite(current.speedKmh)
          ? current.speedKmh
          : typeof next.speedKmh === "number" && Number.isFinite(next.speedKmh)
            ? next.speedKmh
            : null;
      const speed = speedFromCsv ?? pickFallbackSpeedKmh(current, next, currentLocal, nextLocal);
      speeds.push(Math.max(0, speed));
    }

    return speeds;
  }, [displayGeoPoints, sceneData.localTrackPoints]);

  const speedScale = useMemo(() => {
    if (baseSegmentSpeeds.length === 0) {
      return { min: 0, max: 1 };
    }

    const sorted = [...baseSegmentSpeeds].sort((a, b) => a - b);
    const robustMin = percentile(sorted, 0.1);
    const robustMax = percentile(sorted, 0.9);
    const min = Number.isFinite(robustMin) ? robustMin : sorted[0] ?? 0;
    const max = Math.max(
      min + 0.001,
      Number.isFinite(robustMax) ? robustMax : sorted[sorted.length - 1] ?? min + 0.001
    );
    return { min, max };
  }, [baseSegmentSpeeds]);

  const followSnapshot = useMemo<FollowSnapshot3D | null>(() => {
    const localTrackPoints = sceneData.localTrackPoints;
    if (localTrackPoints.length === 0 || points.length === 0) {
      return null;
    }

    const clampedCursor = clamp(clampedPlaybackCursor, 0, points.length - 1);
    const index = Math.floor(clampedCursor);
    const currentBase = localTrackPoints[index];
    if (!currentBase) {
      return null;
    }
    const cursorAlpha = clampedCursor - index;
    const current =
      cursorAlpha > 1e-6 && localTrackPoints[index + 1]
        ? interpolateLocalTrackPoint(currentBase, localTrackPoints[index + 1]!, cursorAlpha)
        : currentBase;

    let speedMps = 0;
    const speedKmh = points[index]?.speedKmh;
    if (typeof speedKmh === "number" && Number.isFinite(speedKmh)) {
      speedMps = Math.max(0, speedKmh / 3.6);
    } else if (index > 0 && localTrackPoints[index - 1]) {
      const previous = localTrackPoints[index - 1];
      const dtMs = points[index].timestampMs - points[index - 1].timestampMs;
      const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
      if (dtMs > 0 && Number.isFinite(distance)) {
        speedMps = Math.max(0, distance / (dtMs / 1000));
      }
    }

    let verticalSpeedMps = 0;
    if (index > 0 && localTrackPoints[index - 1]) {
      const previous = localTrackPoints[index - 1];
      const dtMs = points[index].timestampMs - points[index - 1].timestampMs;
      if (dtMs > 0) {
        verticalSpeedMps = (current.z - previous.z) / (dtMs / 1000);
      }
    }

    let turnRateDegPerSec = 0;
    if (index > 2) {
      const prevAIndex = Math.max(0, index - 4);
      const prevBIndex = Math.max(0, index - 2);
      const prevA = localTrackPoints[prevAIndex];
      const prevB = localTrackPoints[prevBIndex];
      if (prevA && prevB) {
        const previousHeading = deriveHeadingDeg(prevA, prevB);
        const currentHeading = deriveHeadingDeg(prevB, current);
        const dtMs = points[index].timestampMs - points[prevBIndex].timestampMs;
        if (previousHeading !== null && currentHeading !== null && dtMs > 0) {
          turnRateDegPerSec = Math.abs(angleDiffDeg(currentHeading, previousHeading)) / (dtMs / 1000);
        }
      }
    }

    const rawLookAheadMs = computeDynamicLookAheadMs(speedMps, turnRateDegPerSec, verticalSpeedMps);
    const lookAheadMs = smoothLookAheadMs(lookAheadMsRef.current, rawLookAheadMs);
    lookAheadMsRef.current = lookAheadMs;
    const lead = resolveInterpolatedLeadLocalPoint(localTrackPoints, points, index, lookAheadMs);

    return {
      current: [current.x, current.y, current.z],
      lead: [lead.x, lead.y, lead.z],
      speedMps,
      verticalSpeedMps,
      turnRateDegPerSec,
      lookAheadMs
    };
  }, [sceneData.localTrackPoints, points, clampedPlaybackCursor]);

  const markers = useMemo<MarkerData[]>(() => {
    if (sceneData.localTrackPoints.length === 0) {
      return [];
    }

    const clampedCursor = clamp(clampedPlaybackCursor, 0, Math.max(sceneData.localTrackPoints.length - 1, 0));
    const cursorIndex = Math.floor(clampedCursor);
    const cursorAlpha = clampedCursor - cursorIndex;
    const interpolatedCurrentPoint = (() => {
      const from = sceneData.localTrackPoints[cursorIndex];
      if (!from) {
        return null;
      }
      if (cursorAlpha <= 1e-6 || cursorIndex >= sceneData.localTrackPoints.length - 1) {
        return from;
      }
      const to = sceneData.localTrackPoints[cursorIndex + 1];
      if (!to) {
        return from;
      }
      return interpolateLocalTrackPoint(from, to, cursorAlpha);
    })();

    const includeIndexes = new Set<number>();
    includeIndexes.add(0);
    includeIndexes.add(points.length - 1);

    if (currentIndex >= 0 && currentIndex < points.length) {
      includeIndexes.add(currentIndex);
    }

    const nextMarkers: MarkerData[] = [];
    includeIndexes.forEach((index) => {
      const point = sceneData.localTrackPoints[index];
      if (!point) {
        return;
      }

      const isCurrent = index === currentIndex;
      const markerPoint =
        isCurrent && interpolatedCurrentPoint ? interpolatedCurrentPoint : point;

      nextMarkers.push({
        index,
        role: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        isCurrent,
        position: [markerPoint.x, markerPoint.y, markerPoint.z]
      });
    });

    return nextMarkers;
  }, [
    sceneData.localTrackPoints,
    clampedPlaybackCursor,
    points,
    currentIndex
  ]);

  const currentMarker = useMemo(
    () => markers.find((marker) => marker.isCurrent) ?? null,
    [markers]
  );

  const cometLineData = useMemo<CometLineData | null>(() => {
    const localTrackPoints = sceneData.localTrackPoints;
    const pointCount = localTrackPoints.length;
    if (pointCount <= 1 || displayGeoPoints.length <= 1 || baseSegmentSpeeds.length === 0) {
      return null;
    }

    const maxSegmentIndex = Math.min(pointCount, displayGeoPoints.length) - 1;
    if (maxSegmentIndex <= 0) {
      return null;
    }

    if (trailCursorRange.endCursor < 0) {
      return null;
    }
    const clampedStartCursor = clamp(trailCursorRange.startCursor, 0, maxSegmentIndex);
    const clampedEndCursor = clamp(trailCursorRange.endCursor, clampedStartCursor, maxSegmentIndex);
    const startIndexFloor = Math.floor(clampedStartCursor);
    const endIndexFloor = Math.floor(clampedEndCursor);
    const startIndexFrac = clampedStartCursor - startIndexFloor;
    const endIndexFrac = clampedEndCursor - endIndexFloor;
    if (endIndexFloor < startIndexFloor) {
      return null;
    }

    const sourcePoints: Array<[number, number, number]> = [];
    const sourceSegmentSpeeds: number[] = [];
    const first = localTrackPoints[startIndexFloor];
    if (!first) {
      return null;
    }

    if (startIndexFrac > 1e-9 && startIndexFloor < maxSegmentIndex) {
      const next = localTrackPoints[startIndexFloor + 1];
      if (next) {
        const head = interpolateLocalTrackPoint(first, next, startIndexFrac);
        sourcePoints.push([head.x, head.y, head.z]);
      } else {
        sourcePoints.push([first.x, first.y, first.z]);
      }
    } else {
      sourcePoints.push([first.x, first.y, first.z]);
    }

    for (let i = startIndexFloor + 1; i <= endIndexFloor; i += 1) {
      const point = localTrackPoints[i];
      if (!point) {
        break;
      }
      sourcePoints.push([point.x, point.y, point.z]);
      sourceSegmentSpeeds.push(baseSegmentSpeeds[i - 1] ?? 0);
    }

    if (endIndexFrac > 1e-9 && endIndexFloor < maxSegmentIndex) {
      const from = localTrackPoints[endIndexFloor];
      const to = localTrackPoints[endIndexFloor + 1];
      if (from && to) {
        const tail = interpolateLocalTrackPoint(from, to, endIndexFrac);
        sourcePoints.push([tail.x, tail.y, tail.z]);
        sourceSegmentSpeeds.push(baseSegmentSpeeds[endIndexFloor] ?? 0);
      }
    }

    if (sourcePoints.length <= 1 || sourceSegmentSpeeds.length === 0) {
      return null;
    }

    let pointsData = sourcePoints;
    let segmentSpeeds = sourceSegmentSpeeds;
    const shouldDownsample = isPlaying || sourcePoints.length > PLAYBACK_MAX_LINE_VERTICES * 2;
    if (shouldDownsample && sourcePoints.length > PLAYBACK_MAX_LINE_VERTICES) {
      pointsData = downsampleLineVertices3D(sourcePoints, PLAYBACK_MAX_LINE_VERTICES);
      const reducedSegmentCount = pointsData.length - 1;
      if (reducedSegmentCount <= 0) {
        return null;
      }
      if (reducedSegmentCount !== sourceSegmentSpeeds.length) {
        const remappedSpeeds: number[] = [];
        const sourceLast = sourceSegmentSpeeds.length - 1;
        const denominator = Math.max(1, reducedSegmentCount - 1);
        for (let i = 0; i < reducedSegmentCount; i += 1) {
          const mappedIndex = Math.max(0, Math.min(sourceLast, Math.round((i / denominator) * sourceLast)));
          remappedSpeeds.push(sourceSegmentSpeeds[mappedIndex] ?? 0);
        }
        segmentSpeeds = remappedSpeeds;
      }
    }

    const outerSegmentColors: Array<[number, number, number, number]> = [];
    const innerSegmentColors: Array<[number, number, number, number]> = [];
    const minSpeed = speedScale.min;
    const maxSpeed = speedScale.max;

    for (let i = 0; i < segmentSpeeds.length; i += 1) {
      const age = segmentSpeeds.length <= 1 ? 1 : i / (segmentSpeeds.length - 1);
      const fade = isPlaying ? 0.14 + 0.86 * Math.pow(age, 0.86) : 1;
      const normalizedSpeed = clamp((segmentSpeeds[i] - minSpeed) / (maxSpeed - minSpeed), 0, 1);
      const innerColor = speedColorFromNormalized(normalizedSpeed);
      const shadedInnerColor = mixRgb(innerColor, [0, 0, 0], TRACK_INNER_SHADE_3D);
      const outerBlend = isPlaying ? 0.22 + age * 0.05 : 0.2;
      const outerColor = mixRgb(shadedInnerColor, TRACK_OUTER_GLOW, outerBlend);

      const innerAlpha = isPlaying ? 0.88 + 0.12 * fade : 1;
      const outerAlpha = isPlaying ? 0.015 + 0.16 * fade : 0.18;
      innerSegmentColors.push([shadedInnerColor[0], shadedInnerColor[1], shadedInnerColor[2], innerAlpha]);
      outerSegmentColors.push([outerColor[0], outerColor[1], outerColor[2], outerAlpha]);
    }

    const samplesPerSegment = isPlaying ? PLAYBACK_SMOOTH_SAMPLES_PER_SEGMENT : 2;
    const smoothedInner = buildSmoothedPolylineWithColors(
      pointsData,
      innerSegmentColors,
      samplesPerSegment,
      PLAYBACK_SMOOTH_TENSION
    );
    const smoothedOuter = buildSmoothedPolylineWithColors(
      pointsData,
      outerSegmentColors,
      samplesPerSegment,
      PLAYBACK_SMOOTH_TENSION
    );

    return {
      points: smoothedInner.points,
      outerColors: smoothedOuter.colors,
      innerColors: smoothedInner.colors
    };
  }, [
    sceneData.localTrackPoints,
    displayGeoPoints,
    baseSegmentSpeeds,
    speedScale.min,
    speedScale.max,
    isPlaying,
    trailCursorRange.startCursor,
    trailCursorRange.endCursor
  ]);

  useEffect(() => {
    const baseCoverage = Math.max(sceneData.xySpan * 3.2, 2500);
    const nextToken = buildViewToken(sceneData.target[0], sceneData.target[1], baseCoverage);
    setTileViewport({
      centerX: sceneData.target[0],
      centerY: sceneData.target[1],
      coverageMeters: baseCoverage,
      token: nextToken
    });
  }, [sceneData.target, sceneData.xySpan]);

  const tilePlanes = useMemo(() => {
    if (!sceneData.hasProjection) {
      return [];
    }
    return buildTilePlanesFromViewport(
      tileConfig.templates,
      tileViewport.centerX,
      tileViewport.centerY,
      tileViewport.coverageMeters,
      sceneData.originLon,
      sceneData.originLat,
      sceneData.cosOriginLat
    );
  }, [
    tileConfig.templates,
    tileViewport.centerX,
    tileViewport.centerY,
    tileViewport.coverageMeters,
    sceneData.hasProjection,
    sceneData.originLon,
    sceneData.originLat,
    sceneData.cosOriginLat
  ]);

  useEffect(() => {
    renderTilePlanesRef.current = renderTilePlanes;
  }, [renderTilePlanes]);

  useEffect(() => {
    if (!sceneData.hasProjection) {
      setRenderTilePlanes([]);
      prevRenderedTileZoomRef.current = null;
      return;
    }
    if (tilePlanes.length === 0) {
      // Keep existing tiles visible to avoid flicker when next viewport resolves to no tiles temporarily.
      return;
    }

    const nextZoom = parseTileZoom(tilePlanes[0]);
    const prevZoom = prevRenderedTileZoomRef.current;
    const isZoomTransition = prevZoom !== null && nextZoom !== null && prevZoom !== nextZoom;
    prevRenderedTileZoomRef.current = nextZoom;

    const targetMap = new Map(tilePlanes.map((tile) => [tile.key, tile]));
    const jobId = ++tileTransitionJobRef.current;

    if (isZoomTransition) {
      // Keep previous zoom level fully visible until new zoom level finishes loading.
      if (renderTilePlanesRef.current.length === 0) {
        const loadedNow = tilePlanes.filter((tile) => getLoadedTileTexture(tile.url));
        if (loadedNow.length > 0) {
          setRenderTilePlanes(loadedNow);
        }
      }
    } else {
      // Pan: keep overlapping tiles in current viewport, leave new out-of-view areas temporarily blank.
      setRenderTilePlanes((previous) => {
        const overlap = previous.filter((tile) => targetMap.has(tile.key));
        const loadedInTarget = tilePlanes.filter((tile) => getLoadedTileTexture(tile.url));
        const merged = new Map<string, TilePlaneData>();
        overlap.forEach((tile) => {
          merged.set(tile.key, tile);
        });
        loadedInTarget.forEach((tile) => {
          merged.set(tile.key, tile);
        });
        const next = Array.from(merged.values());
        return next.length > 0 ? next : previous;
      });
    }

    void preloadTileTextures(tilePlanes.map((tile) => tile.url)).then(() => {
      if (tileTransitionJobRef.current !== jobId) {
        return;
      }
      setRenderTilePlanes(tilePlanes);
      const activeTileUrls = new Set(tilePlanes.map((tile) => tile.url));
      renderTilePlanesRef.current.forEach((tile) => {
        activeTileUrls.add(tile.url);
      });
      pruneTileTextureCache(activeTileUrls);
    });
  }, [tilePlanes, sceneData.hasProjection]);

  const horizonVisual = useMemo(() => {
    const coverage = Math.max(tileViewport.coverageMeters, 2500);
    return {
      centerX: tileViewport.centerX,
      centerY: tileViewport.centerY,
      skyRadius: Math.max(coverage * 2.5, 6800),
      hazeRadius: Math.max(coverage * 1.95, 4200),
      hazeZ: -0.12
    };
  }, [tileViewport.centerX, tileViewport.centerY, tileViewport.coverageMeters]);

  const fogRange = useMemo(() => {
    const coverage = Math.max(tileViewport.coverageMeters, sceneData.xySpan * 3.2, 2500);
    return {
      near: clamp(coverage * 0.55, 1000, 150000),
      far: clamp(coverage * 2.8, 5000, 380000)
    };
  }, [tileViewport.coverageMeters, sceneData.xySpan]);

  const syncCameraBearingFromControls = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    const camera = controls.object as THREE.PerspectiveCamera;
    const forward = new THREE.Vector3().copy(controls.target).sub(camera.position);
    forward.z = 0;
    if (forward.lengthSq() < 1e-6) {
      setCameraBearingDeg(0);
      return;
    }

    const nextBearing = normalizeAngleDeg((Math.atan2(forward.x, forward.y) * RAD_TO_DEG));
    setCameraBearingDeg((prev) => (Math.abs(angleDiffDeg(nextBearing, prev)) < 0.1 ? prev : nextBearing));
  }, []);

  const stopCameraNavigationAnimation = useCallback(() => {
    if (cameraNavAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(cameraNavAnimationFrameRef.current);
      cameraNavAnimationFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopCameraNavigationAnimation();
      tileTransitionJobRef.current += 1;
      clearTileTextureCache();
    };
  }, [stopCameraNavigationAnimation]);

  const syncTileViewportFromControls = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls || !sceneData.hasProjection) {
      return;
    }

    syncCameraBearingFromControls();
    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target;
    const nextCoverage = pickDynamicCoverageMeters(camera.position.distanceTo(target), sceneData.xySpan);
    const nextToken = buildViewToken(target.x, target.y, nextCoverage);
    const now = performance.now();

    setTileViewport((prev) => {
      const baseCoverage = Math.max(prev.coverageMeters, 1);
      const shift = Math.hypot(prev.centerX - target.x, prev.centerY - target.y);
      const coverageRatio = Math.abs(prev.coverageMeters - nextCoverage) / baseCoverage;
      const quietMove = shift < baseCoverage * 0.08 && coverageRatio < 0.08;
      const recentlyUpdated = now - lastTileViewportUpdateMsRef.current < 140;
      const mediumMove = shift < baseCoverage * 0.16 && coverageRatio < 0.16;
      if (quietMove || (recentlyUpdated && mediumMove)) {
        return prev;
      }
      if (prev.token === nextToken) {
        return prev;
      }
      lastTileViewportUpdateMsRef.current = now;
      return {
        centerX: target.x,
        centerY: target.y,
        coverageMeters: nextCoverage,
        token: nextToken
      };
    });
  }, [sceneData.hasProjection, sceneData.xySpan, syncCameraBearingFromControls]);

  const animateCameraTo = useCallback((nextPosition: THREE.Vector3, nextTarget: THREE.Vector3) => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    stopCameraNavigationAnimation();

    const camera = controls.object as THREE.PerspectiveCamera;
    cameraNavStartPositionRef.current.copy(camera.position);
    cameraNavEndPositionRef.current.copy(nextPosition);
    cameraNavStartTargetRef.current.copy(controls.target);
    cameraNavEndTargetRef.current.copy(nextTarget);

    const startedAt = performance.now();
    const tick = () => {
      const innerControls = controlsRef.current;
      if (!innerControls) {
        cameraNavAnimationFrameRef.current = null;
        return;
      }

      const innerCamera = innerControls.object as THREE.PerspectiveCamera;
      const elapsed = performance.now() - startedAt;
      const progress = clamp(elapsed / CAMERA_NAV_ANIMATION_MS, 0, 1);
      const eased = easeOutCubic(progress);

      innerCamera.position.copy(
        cameraNavStartPositionRef.current.clone().lerp(cameraNavEndPositionRef.current, eased)
      );
      innerControls.target.copy(
        cameraNavStartTargetRef.current.clone().lerp(cameraNavEndTargetRef.current, eased)
      );
      innerControls.update();
      syncCameraBearingFromControls();
      syncTileViewportFromControls();

      if (progress >= 1) {
        cameraNavAnimationFrameRef.current = null;
        return;
      }
      cameraNavAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    cameraNavAnimationFrameRef.current = window.requestAnimationFrame(tick);
  }, [stopCameraNavigationAnimation, syncCameraBearingFromControls, syncTileViewportFromControls]);

  const handleControlsStart = useCallback(() => {
    manualFollowUntilRef.current = performance.now() + FOLLOW_MANUAL_HOLD_MS;
  }, []);

  const fitCameraToScene = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    stopCameraNavigationAnimation();

    const target = new THREE.Vector3(...sceneData.target);
    const baseDistance = Math.max(100, sceneData.xySpan * 1.05);
    const offset = new THREE.Vector3(baseDistance, -baseDistance * 0.95, Math.max(40, baseDistance * 0.62));

    const camera = controls.object as THREE.PerspectiveCamera;
    camera.position.copy(target).add(offset);
    camera.near = 0.1;
    camera.far = Math.max(12000, sceneData.xySpan * 30);
    camera.updateProjectionMatrix();

    controls.target.copy(target);
    controls.update();
    syncCameraBearingFromControls();
    syncTileViewportFromControls();
  },
    [sceneData.target, sceneData.xySpan, stopCameraNavigationAnimation, syncCameraBearingFromControls, syncTileViewportFromControls]
  );

  const handleZoomIn = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    manualFollowUntilRef.current = performance.now() + FOLLOW_MANUAL_HOLD_MS;
    const camera = controls.object as THREE.PerspectiveCamera;
    const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
    if (offset.lengthSq() < 1e-6) {
      return;
    }

    const nextDistance = clamp(offset.length() * 0.82, controls.minDistance, controls.maxDistance);
    offset.setLength(nextDistance);
    animateCameraTo(new THREE.Vector3().copy(controls.target).add(offset), controls.target.clone());
  }, [animateCameraTo]);

  const handleZoomOut = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    manualFollowUntilRef.current = performance.now() + FOLLOW_MANUAL_HOLD_MS;
    const camera = controls.object as THREE.PerspectiveCamera;
    const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
    if (offset.lengthSq() < 1e-6) {
      return;
    }

    const nextDistance = clamp(offset.length() * 1.22, controls.minDistance, controls.maxDistance);
    offset.setLength(nextDistance);
    animateCameraTo(new THREE.Vector3().copy(controls.target).add(offset), controls.target.clone());
  }, [animateCameraTo]);

  const handleResetNorth = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls) {
      return;
    }

    manualFollowUntilRef.current = performance.now() + FOLLOW_MANUAL_HOLD_MS;
    const camera = controls.object as THREE.PerspectiveCamera;
    const offset = new THREE.Vector3().copy(camera.position).sub(controls.target);
    const horizontalDistance = Math.max(1, Math.hypot(offset.x, offset.y));
    const nextPosition = new THREE.Vector3(
      controls.target.x,
      controls.target.y - horizontalDistance,
      controls.target.z + offset.z
    );
    camera.up.set(0, 0, 1);
    animateCameraTo(nextPosition, controls.target.clone());
  }, [animateCameraTo]);

  useEffect(() => {
    fitCameraToScene();
  }, [fitCameraToScene]);

  return (
    <div className="viewer-canvas viewer-3d">
      <Canvas
        onCreated={({ camera }) => {
          camera.up.set(0, 0, 1);
        }}
        camera={{
          position: [180, -180, 120],
          fov: 52,
          near: 0.1,
          far: 12000
        }}
      >
        <color attach="background" args={[SKY_TOP_COLOR]} />
        <fog attach="fog" args={[FOG_COLOR, fogRange.near, fogRange.far]} />

        <HorizonSky
          centerX={horizonVisual.centerX}
          centerY={horizonVisual.centerY}
          radius={horizonVisual.skyRadius}
        />
        <GroundHaze
          centerX={horizonVisual.centerX}
          centerY={horizonVisual.centerY}
          radius={horizonVisual.hazeRadius}
          z={horizonVisual.hazeZ}
        />

        <ambientLight intensity={0.78} />
        <directionalLight position={[180, -120, 220]} intensity={0.9} />

        {renderTilePlanes.map((tile) => (
          <RasterTile key={tile.key} tile={tile} />
        ))}

        {cometLineData ? (
          <>
            <Line
              points={cometLineData.points}
              vertexColors={cometLineData.outerColors}
              lineWidth={Math.max(TRACK_OUTER_MIN_WIDTH_3D, trackWidth * TRACK_OUTER_WIDTH_3D)}
              worldUnits
              transparent
              depthWrite={false}
              renderOrder={1}
            />
            <Line
              points={cometLineData.points}
              vertexColors={cometLineData.innerColors}
              lineWidth={Math.max(TRACK_INNER_MIN_WIDTH_3D, trackWidth * TRACK_INNER_WIDTH_3D)}
              worldUnits
              transparent
              depthWrite
              renderOrder={2}
            />
          </>
        ) : null}

        <AutoFollowRig
          controlsRef={controlsRef}
          followSnapshot={followSnapshot}
          isPlaying={isPlaying}
          autoFollowMode={autoFollowMode}
          frontFollowMode={frontFollowMode}
          xySpan={sceneData.xySpan}
          manualFollowUntilRef={manualFollowUntilRef}
        />

        {currentMarker ? (
          <CurrentPulseRing
            position={currentMarker.position}
            trackWidth={trackWidth}
          />
        ) : null}

        {markers.map((marker) => (
          <mesh key={marker.index} position={marker.position}>
            <sphereGeometry args={[markerRadius(marker, trackWidth), 14, 14]} />
            <meshStandardMaterial
              color={markerColor(marker)}
              emissive={marker.isCurrent ? "#715610" : "#000000"}
              emissiveIntensity={marker.isCurrent ? 0.36 : 0}
              roughness={0.4}
              metalness={0.06}
            />
          </mesh>
        ))}

        <OrbitControls
          ref={controlsRef}
          makeDefault
          enablePan={true}
          enableRotate={true}
          enableZoom={true}
          dampingFactor={0.08}
          maxPolarAngle={Math.PI * 0.495}
          minDistance={10}
          maxDistance={Math.max(900, sceneData.xySpan * 12)}
          onChange={syncTileViewportFromControls}
          onStart={handleControlsStart}
        />
      </Canvas>

      <ViewerSpeedLegend />
      <ViewerNavigationControls
        bearingDeg={cameraBearingDeg}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetNorth={handleResetNorth}
      />

      <ViewerCornerControls
        viewMode="3d"
        autoFollowMode={autoFollowMode}
        frontFollowMode={frontFollowMode}
        onAutoFollowChange={setAutoFollowMode}
        onFrontFollowChange={setFrontFollowMode}
        onToggleViewMode={onToggleViewMode}
      />
    </div>
  );
}
