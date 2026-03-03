import type { StyleSpecification } from "maplibre-gl";
import type { MapProvider, MapStyleMode } from "../../types/flight";

export interface RasterTileConfig {
  templates: string[];
  attribution: string;
  tileSize: number;
}

export function getRasterTileConfig(provider: MapProvider, mode: MapStyleMode): RasterTileConfig {
  const isSatellite = mode === "satellite";

  if (provider === "amap") {
    if (isSatellite) {
      return {
        templates: [
          "https://webst01.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
          "https://webst02.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
          "https://webst03.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}",
          "https://webst04.is.autonavi.com/appmaptile?style=6&x={x}&y={y}&z={z}"
        ],
        attribution: "Map data (c) AMap",
        tileSize: 256
      };
    }

    return {
      templates: [
        "https://webrd01.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        "https://webrd02.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        "https://webrd03.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}",
        "https://webrd04.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}"
      ],
      attribution: "Map data (c) AMap",
      tileSize: 256
    };
  }

  if (isSatellite) {
    return {
      templates: [
        "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
      ],
      attribution: "Tiles (c) Esri",
      tileSize: 256
    };
  }

  return {
    templates: [
      "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
      "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
    ],
    attribution: "(c) OpenStreetMap contributors",
    tileSize: 256
  };
}

export function buildRasterStyle(provider: MapProvider, mode: MapStyleMode): StyleSpecification {
  const config = getRasterTileConfig(provider, mode);
  return {
    version: 8,
    sources: {
      base: {
        type: "raster",
        tiles: config.templates,
        tileSize: config.tileSize,
        attribution: config.attribution
      }
    },
    layers: [
      {
        id: "base-raster",
        type: "raster",
        source: "base"
      }
    ]
  };
}

export function buildTileUrl(templates: string[], z: number, x: number, y: number): string {
  const template = templates[Math.abs((x * 31 + y * 17 + z) % templates.length)] ?? templates[0];
  return template
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{z}", String(z));
}
