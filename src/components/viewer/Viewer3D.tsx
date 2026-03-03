import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { wgs84ToGcj02 } from "../../lib/math/coordTransform";
import { buildTileUrl, getRasterTileConfig } from "../../lib/map/rasterTiles";
import { resolveTrailRange } from "../../lib/playback/trailWindow";
import type { AltitudeMode, FlightPoint, MapProvider, MapStyleMode } from "../../types/flight";

interface Viewer3DProps {
  points: FlightPoint[];
  altitudeMode: AltitudeMode;
  mapProvider: MapProvider;
  mapStyle: MapStyleMode;
  zScale: number;
  selectedIndex: number;
  currentIndex: number;
  isPlaying: boolean;
  pointSize: number;
  pointStride: number;
  onSelect: (index: number) => void;
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
  isSelected: boolean;
  position: [number, number, number];
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

type CameraPreset = "perspective" | "top" | "side";

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const MAX_MERCATOR_LAT = 85.05112878;
const TILE_BUDGET = 196;
const TILE_MIN_ZOOM = 5;
const TILE_MAX_ZOOM = 19;
const TILE_LAYOUT_ROUND = true;
const SKY_TOP_COLOR = "#0a2138";
const SKY_HORIZON_COLOR = "#55788f";
const SKY_BOTTOM_COLOR = "#5b7688";
const FOG_COLOR = SKY_HORIZON_COLOR;
const GROUND_HAZE_INNER_COLOR = "#4b6477";
const GROUND_HAZE_OUTER_COLOR = "#7f99ac";
const PLAYBACK_TRAIL_WINDOW_MS = 10_000;

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

function configureTileTexture(texture: THREE.Texture) {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
}

function getLoadedTileTexture(url: string): THREE.Texture | null {
  const cached = tileTextureCache.get(url);
  if (!cached || cached.status !== "loaded" || !cached.texture) {
    return null;
  }
  return cached.texture;
}

function ensureTileTexture(url: string): Promise<THREE.Texture> {
  const existing = tileTextureCache.get(url);
  if (existing?.status === "loaded" && existing.texture) {
    return Promise.resolve(existing.texture);
  }
  if (existing?.status === "loading" && existing.promise) {
    return existing.promise;
  }

  const promise = new Promise<THREE.Texture>((resolve, reject) => {
    tileTextureLoader.load(
      url,
      (texture) => {
        configureTileTexture(texture);
        tileTextureCache.set(url, {
          status: "loaded",
          texture,
          promise: null
        });
        resolve(texture);
      },
      undefined,
      (error) => {
        tileTextureCache.set(url, {
          status: "error",
          texture: null,
          promise: null
        });
        reject(error);
      }
    );
  });

  tileTextureCache.set(url, {
    status: "loading",
    texture: null,
    promise
  });

  return promise;
}

function preloadTileTextures(urls: string[]): Promise<void> {
  return Promise.allSettled(urls.map((url) => ensureTileTexture(url))).then(() => undefined);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  const speedKmh = (horizontalDistM / dtMs) * 3.6;
  return Number.isFinite(speedKmh) ? speedKmh : 0;
}

function speedColor(speed: number, minSpeed: number, maxSpeed: number): THREE.Color {
  const slow = new THREE.Color("#2f77ff");
  const fast = new THREE.Color("#ff3f2c");
  if (maxSpeed - minSpeed < 0.001) {
    return slow.clone().lerp(fast, 0.5);
  }

  const t = clamp((speed - minSpeed) / (maxSpeed - minSpeed), 0, 1);
  return slow.clone().lerp(fast, t);
}

function markerColor(marker: MarkerData): string {
  if (marker.isCurrent) {
    return "#ffe164";
  }
  if (marker.isSelected) {
    return "#ffffff";
  }
  if (marker.role === "start") {
    return "#42d26f";
  }
  if (marker.role === "end") {
    return "#ff6058";
  }
  return "#86d9ff";
}

function markerRadius(marker: MarkerData, pointSize: number): number {
  if (marker.isCurrent) {
    return 1.9 * pointSize;
  }
  if (marker.isSelected) {
    return 1.7 * pointSize;
  }
  if (marker.role === "start" || marker.role === "end") {
    return 1.45 * pointSize;
  }
  return 1.02 * pointSize;
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
    []
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

export function Viewer3D({
  points,
  altitudeMode,
  mapProvider,
  mapStyle,
  zScale,
  selectedIndex,
  currentIndex,
  isPlaying,
  pointSize,
  pointStride,
  onSelect
}: Viewer3DProps) {
  const { t } = useTranslation();
  const controlsRef = useRef<OrbitControlsImpl | null>(null);
  const tileTransitionJobRef = useRef(0);
  const prevRenderedTileZoomRef = useRef<number | null>(null);
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>("perspective");
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

  const trailRange = useMemo(
    () => resolveTrailRange(points, currentIndex, isPlaying, PLAYBACK_TRAIL_WINDOW_MS),
    [points, currentIndex, isPlaying]
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

  const markers = useMemo<MarkerData[]>(() => {
    if (sceneData.localTrackPoints.length === 0) {
      return [];
    }

    const includeIndexes = new Set<number>();
    if (isPlaying && trailRange.endIndex >= 0) {
      for (let index = trailRange.startIndex; index <= trailRange.endIndex; index += 1) {
        includeIndexes.add(index);
      }
    } else {
      points.forEach((_, index) => {
        if (index === 0 || index === points.length - 1 || index % pointStride === 0) {
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

    const nextMarkers: MarkerData[] = [];
    includeIndexes.forEach((index) => {
      if (isPlaying && trailRange.endIndex >= 0) {
        if (index < trailRange.startIndex || index > trailRange.endIndex) {
          return;
        }
      }

      const point = sceneData.localTrackPoints[index];
      if (!point) {
        return;
      }

      nextMarkers.push({
        index,
        role: index === 0 ? "start" : index === points.length - 1 ? "end" : "middle",
        isCurrent: index === currentIndex,
        isSelected: index === selectedIndex,
        position: [point.x, point.y, point.z]
      });
    });

    return nextMarkers;
  }, [
    sceneData.localTrackPoints,
    points,
    pointStride,
    selectedIndex,
    currentIndex,
    isPlaying,
    trailRange.startIndex,
    trailRange.endIndex
  ]);

  const speedGeometry = useMemo(() => {
    const pointCount = sceneData.localTrackPoints.length;
    if (pointCount <= 1 || displayGeoPoints.length <= 1) {
      return null;
    }

    const maxSegmentIndex = Math.min(pointCount, displayGeoPoints.length) - 1;
    const startIndex = isPlaying && trailRange.endIndex >= 0 ? trailRange.startIndex : 0;
    const endIndex = isPlaying && trailRange.endIndex >= 0 ? trailRange.endIndex : maxSegmentIndex;
    const segmentCount = Math.max(0, Math.min(endIndex, maxSegmentIndex) - startIndex);
    if (segmentCount <= 0) {
      return null;
    }

    const segmentSpeeds: number[] = [];
    for (let i = startIndex; i < startIndex + segmentCount; i += 1) {
      const current = displayGeoPoints[i];
      const next = displayGeoPoints[i + 1];
      const currentLocal = sceneData.localTrackPoints[i];
      const nextLocal = sceneData.localTrackPoints[i + 1];

      const speedFromCsv =
        typeof current.speedKmh === "number" && Number.isFinite(current.speedKmh)
          ? current.speedKmh
          : typeof next.speedKmh === "number" && Number.isFinite(next.speedKmh)
            ? next.speedKmh
            : null;
      const speed = speedFromCsv ?? pickFallbackSpeedKmh(current, next, currentLocal, nextLocal);
      segmentSpeeds.push(Math.max(0, speed));
    }

    if (segmentSpeeds.length === 0) {
      return null;
    }

    const minSpeed = Math.min(...segmentSpeeds);
    const maxSpeed = Math.max(...segmentSpeeds);
    const speedPositions = new Float32Array(segmentSpeeds.length * 6);
    const speedColors = new Float32Array(segmentSpeeds.length * 6);

    let offset = 0;
    for (let i = 0; i < segmentSpeeds.length; i += 1) {
      const segmentStart = sceneData.localTrackPoints[startIndex + i];
      const segmentEnd = sceneData.localTrackPoints[startIndex + i + 1];

      const color = speedColor(segmentSpeeds[i], minSpeed, maxSpeed);
      speedPositions[offset] = segmentStart.x;
      speedPositions[offset + 1] = segmentStart.y;
      speedPositions[offset + 2] = segmentStart.z;
      speedPositions[offset + 3] = segmentEnd.x;
      speedPositions[offset + 4] = segmentEnd.y;
      speedPositions[offset + 5] = segmentEnd.z;

      speedColors[offset] = color.r;
      speedColors[offset + 1] = color.g;
      speedColors[offset + 2] = color.b;
      speedColors[offset + 3] = color.r;
      speedColors[offset + 4] = color.g;
      speedColors[offset + 5] = color.b;
      offset += 6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(speedPositions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(speedColors, 3));
    return geometry;
  }, [
    sceneData.localTrackPoints,
    displayGeoPoints,
    isPlaying,
    trailRange.startIndex,
    trailRange.endIndex
  ]);

  useEffect(() => {
    return () => {
      speedGeometry?.dispose();
    };
  }, [speedGeometry]);

  useEffect(() => {
    const baseCoverage = Math.max(sceneData.xySpan * 3.2, 2500);
    const nextToken = buildViewToken(sceneData.target[0], sceneData.target[1], baseCoverage);
    setTileViewport({
      centerX: sceneData.target[0],
      centerY: sceneData.target[1],
      coverageMeters: baseCoverage,
      token: nextToken
    });
  }, [sceneData.fitToken, sceneData.target, sceneData.xySpan]);

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
    tileViewport.token,
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
    if (tilePlanes.length === 0) {
      setRenderTilePlanes([]);
      prevRenderedTileZoomRef.current = null;
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
        overlap.forEach((tile) => merged.set(tile.key, tile));
        loadedInTarget.forEach((tile) => merged.set(tile.key, tile));
        return Array.from(merged.values());
      });
    }

    void preloadTileTextures(tilePlanes.map((tile) => tile.url)).then(() => {
      if (tileTransitionJobRef.current !== jobId) {
        return;
      }
      setRenderTilePlanes(tilePlanes);
    });
  }, [tilePlanes, tileViewport.token]);

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

  const syncTileViewportFromControls = useCallback(() => {
    const controls = controlsRef.current;
    if (!controls || !sceneData.hasProjection) {
      return;
    }

    const camera = controls.object as THREE.PerspectiveCamera;
    const target = controls.target;
    const nextCoverage = pickDynamicCoverageMeters(camera.position.distanceTo(target), sceneData.xySpan);
    const nextToken = buildViewToken(target.x, target.y, nextCoverage);

    setTileViewport((prev) => {
      const baseCoverage = Math.max(prev.coverageMeters, 1);
      const shift = Math.hypot(prev.centerX - target.x, prev.centerY - target.y);
      const coverageRatio = Math.abs(prev.coverageMeters - nextCoverage) / baseCoverage;
      if (shift < baseCoverage * 0.2 && coverageRatio < 0.22) {
        return prev;
      }
      if (prev.token === nextToken) {
        return prev;
      }
      return {
        centerX: target.x,
        centerY: target.y,
        coverageMeters: nextCoverage,
        token: nextToken
      };
    });
  }, [sceneData.hasProjection, sceneData.xySpan]);

  const applyCameraPreset = useCallback(
    (preset: CameraPreset) => {
      const controls = controlsRef.current;
      if (!controls) {
        return;
      }

      const target = new THREE.Vector3(...sceneData.target);
      const baseDistance = Math.max(100, sceneData.xySpan * 1.05);
      const sideDistance = Math.max(120, sceneData.xySpan * 1.35);
      const topDistance = Math.max(baseDistance * 1.35, sceneData.zSpan * 2.6);

      let offset: THREE.Vector3;
      if (preset === "top") {
        offset = new THREE.Vector3(0, 0, topDistance);
      } else if (preset === "side") {
        offset = new THREE.Vector3(sideDistance, 0, Math.max(30, sceneData.zSpan * 0.6));
      } else {
        offset = new THREE.Vector3(baseDistance, -baseDistance * 0.95, Math.max(40, baseDistance * 0.62));
      }

      const camera = controls.object as THREE.PerspectiveCamera;
      camera.position.copy(target).add(offset);
      camera.near = 0.1;
      camera.far = Math.max(12000, sceneData.xySpan * 30);
      camera.updateProjectionMatrix();

      controls.target.copy(target);
      controls.update();
      syncTileViewportFromControls();
    },
    [sceneData.target, sceneData.xySpan, sceneData.zSpan, syncTileViewportFromControls]
  );

  const setPerspectiveView = useCallback(() => {
    setCameraPreset("perspective");
    applyCameraPreset("perspective");
  }, [applyCameraPreset]);

  const setTopView = useCallback(() => {
    setCameraPreset("top");
    applyCameraPreset("top");
  }, [applyCameraPreset]);

  const setSideView = useCallback(() => {
    setCameraPreset("side");
    applyCameraPreset("side");
  }, [applyCameraPreset]);

  useEffect(() => {
    applyCameraPreset(cameraPreset);
  }, [sceneData.fitToken, cameraPreset, applyCameraPreset]);

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

        {speedGeometry ? (
          <lineSegments geometry={speedGeometry}>
            <lineBasicMaterial vertexColors transparent opacity={0.95} />
          </lineSegments>
        ) : null}

        {markers.map((marker) => (
          <mesh
            key={marker.index}
            position={marker.position}
            onPointerDown={(event) => {
              event.stopPropagation();
              onSelect(marker.index);
            }}
          >
            <sphereGeometry args={[markerRadius(marker, pointSize), 18, 18]} />
            <meshStandardMaterial
              color={markerColor(marker)}
              emissive={marker.isCurrent ? "#8f6f11" : marker.isSelected ? "#6f6f6f" : "#000000"}
              emissiveIntensity={marker.isCurrent || marker.isSelected ? 0.46 : 0}
              roughness={0.36}
              metalness={0.08}
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
        />
      </Canvas>

      <div className="viewer-3d-view-buttons" role="group" aria-label="3d-view-presets">
        <button
          type="button"
          className={`viewer-3d-view-button ${cameraPreset === "perspective" ? "active" : ""}`}
          onClick={setPerspectiveView}
        >
          {t("viewer3d.perspective", { defaultValue: "Perspective" })}
        </button>
        <button
          type="button"
          className={`viewer-3d-view-button ${cameraPreset === "top" ? "active" : ""}`}
          onClick={setTopView}
        >
          {t("viewer3d.top", { defaultValue: "Top" })}
        </button>
        <button
          type="button"
          className={`viewer-3d-view-button ${cameraPreset === "side" ? "active" : ""}`}
          onClick={setSideView}
        >
          {t("viewer3d.side", { defaultValue: "Side" })}
        </button>
      </div>

      <div className="viewer-3d-speed-legend" aria-hidden="true">
        <span>{t("viewer3d.slow", { defaultValue: "Slow" })}</span>
        <div className="viewer-3d-speed-gradient" />
        <span>{t("viewer3d.fast", { defaultValue: "Fast" })}</span>
      </div>
    </div>
  );
}
