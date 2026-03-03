import type { Language, PanelFormatResult, PanelSummary } from "../../types/flight";

const localeTable = {
  "zh-CN": {
    na: "-",
    distanceUnit: "m",
    altitudeUnit: "m",
    speedUnit: "km/h",
    voltageUnit: "V",
    currentUnit: "A"
  },
  en: {
    na: "-",
    distanceUnit: "m",
    altitudeUnit: "m",
    speedUnit: "km/h",
    voltageUnit: "V",
    currentUnit: "A"
  },
  ja: {
    na: "-",
    distanceUnit: "m",
    altitudeUnit: "m",
    speedUnit: "km/h",
    voltageUnit: "V",
    currentUnit: "A"
  }
} as const;

function formatNullable(value: string | number | null | undefined, fallback: string): string {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return String(value);
}

function formatNumber(value: number | null | undefined, digits: number, fallback: string): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }
  return value.toFixed(digits);
}

export function formatPointForPanel(
  point: {
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
  },
  lang: Language
): PanelFormatResult {
  const locale = localeTable[lang] ?? localeTable["zh-CN"];
  const distanceRaw = Number(point.raw.__distance_m);
  const distance =
    Number.isFinite(distanceRaw) && distanceRaw >= 0
      ? `${distanceRaw.toFixed(1)} ${locale.distanceUnit}`
      : locale.na;

  const satValue = point.raw["Sats"];
  const modeValue = point.raw["FM"];

  const summary: PanelSummary = {
    time: `${point.date} ${point.time}`,
    latLon: `${point.lat.toFixed(6)} / ${point.lon.toFixed(6)}`,
    distance,
    altitude: `${formatNumber(point.alt1, 1, locale.na)} / ${formatNumber(
      point.alt2,
      1,
      locale.na
    )} ${locale.altitudeUnit}`,
    speed: `${formatNumber(point.speedKmh, 1, locale.na)} ${locale.speedUnit}`,
    voltage: `${formatNumber(point.voltageV, 2, locale.na)} ${locale.voltageUnit}`,
    current: `${formatNumber(point.currentA, 2, locale.na)} ${locale.currentUnit}`,
    satellites: formatNullable(satValue, locale.na),
    mode: formatNullable(modeValue, locale.na)
  };

  return { summary };
}
