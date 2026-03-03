import { useEffect, useMemo, useRef } from "react";
import maplibregl from "maplibre-gl";
import type { FlightPoint, MapProvider, MapStyleMode } from "../../types/flight";
import { wgs84ToGcj02 } from "../../lib/math/coordTransform";
import { buildRasterStyle } from "../../lib/map/rasterTiles";

interface Viewer2DProps {
  points: FlightPoint[];
  smoothedTrack: [number, number][];
  selectedIndex: number;
  currentIndex: number;
  mapProvider: MapProvider;
  mapStyle: MapStyleMode;
  pointSize: number;
  pointStride: number;
  onSelect: (index: number) => void;
}

interface MapCoordPoint {
  index: number;
  lon: number;
  lat: number;
}

const SOURCE_SMOOTH = "fpv-smooth-track";
const SOURCE_POINTS = "fpv-track-points";
const LAYER_SMOOTH = "fpv-smooth-line";
const LAYER_MIDDLE = "fpv-point-middle";
const LAYER_START = "fpv-point-start";
const LAYER_END = "fpv-point-end";
const LAYER_CURRENT = "fpv-point-current";
const LAYER_SELECTED = "fpv-point-selected";

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
  mapProvider,
  mapStyle,
  pointSize,
  pointStride,
  onSelect
}: Viewer2DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const onSelectRef = useRef(onSelect);
  const smoothedTrackRef = useRef(smoothedTrack);
  const pointFeaturesRef = useRef<Array<Record<string, unknown>>>([]);
  const pointSizeRef = useRef(pointSize);

  const syncMapVisuals = (map: maplibregl.Map) => {
    if (!map || !map.getStyle()) {
      return;
    }

    if (!map.isStyleLoaded()) {
      map.once("idle", () => syncMapVisuals(map));
      return;
    }

    try {
      ensureLayers(map);

      const smoothSource = map.getSource(SOURCE_SMOOTH) as maplibregl.GeoJSONSource;
      smoothSource.setData({
        type: "Feature",
        properties: {},
        geometry: {
          type: "LineString",
          coordinates: smoothedTrackRef.current
        }
      } as any);

      const pointSource = map.getSource(SOURCE_POINTS) as maplibregl.GeoJSONSource;
      pointSource.setData({
        type: "FeatureCollection",
        features: pointFeaturesRef.current
      } as any);

      map.setPaintProperty(LAYER_MIDDLE, "circle-radius", 2.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_START, "circle-radius", 4.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_END, "circle-radius", 4.5 * pointSizeRef.current);
      map.setPaintProperty(LAYER_CURRENT, "circle-radius", 5.3 * pointSizeRef.current);
      map.setPaintProperty(LAYER_SELECTED, "circle-radius", 5 * pointSizeRef.current);
    } catch {
      map.once("idle", () => syncMapVisuals(map));
    }
  };

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

  const displaySmoothedTrack = useMemo<[number, number][]>(() => {
    if (mapProvider !== "amap") {
      return smoothedTrack;
    }

    return smoothedTrack.map(([lon, lat]) => {
      const converted = wgs84ToGcj02(lon, lat);
      return [converted.lon, converted.lat];
    });
  }, [smoothedTrack, mapProvider]);

  const pointFeatures = useMemo(() => {
    const result: Array<Record<string, unknown>> = [];
    if (points.length === 0 || displayPoints.length === 0) {
      return result;
    }

    const includeIndexes = new Set<number>();
    points.forEach((_, index) => {
      if (index === 0 || index === points.length - 1 || index % pointStride === 0) {
        includeIndexes.add(index);
      }
      if (index === selectedIndex || index === currentIndex) {
        includeIndexes.add(index);
      }
    });

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
  }, [points, displayPoints, pointStride, selectedIndex, currentIndex]);

  useEffect(() => {
    smoothedTrackRef.current = displaySmoothedTrack;
    pointFeaturesRef.current = pointFeatures;
    pointSizeRef.current = pointSize;
    if (mapRef.current) {
      syncMapVisuals(mapRef.current);
    }
  }, [displaySmoothedTrack, pointFeatures, pointSize]);

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

    const clickableLayers = [LAYER_MIDDLE, LAYER_START, LAYER_END, LAYER_CURRENT, LAYER_SELECTED];

    map.on("load", () => {
      ensureLayers(map);
      syncMapVisuals(map);
      map.once("idle", () => syncMapVisuals(map));

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

      if (displayPoints.length > 0) {
        fitMapToTrack(map, displayPoints);
      }
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapProvider, mapStyle, displayPoints, points.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) {
      return;
    }

    syncMapVisuals(map);
    map.once("idle", () => syncMapVisuals(map));
    fitMapToTrack(map, displayPoints);
  }, [displayPoints, points.length, mapProvider, mapStyle]);

  return <div className="viewer-canvas" ref={containerRef} />;
}
