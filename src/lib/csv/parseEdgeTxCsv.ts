import Papa from "papaparse";
import type { FlightPoint, ParsedCsvResult } from "../../types/flight";
import { normalizeHeaders } from "./normalizeHeaders";
import { parseGps } from "./parseGps";
import { haversineDistanceMeters } from "../math/geoToLocal";

const ENCODING_CANDIDATES = ["utf-8", "gb18030", "gbk"] as const;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

function looksLikeEdgeTx(text: string): boolean {
  return text.includes("Date,Time") && text.includes("GPS");
}

async function decodeCsvText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let fallback = "";

  for (const encoding of ENCODING_CANDIDATES) {
    try {
      const decoded = new TextDecoder(encoding).decode(buffer);
      if (looksLikeEdgeTx(decoded)) {
        return decoded;
      }
      if (!fallback) {
        fallback = decoded;
      }
    } catch {
      continue;
    }
  }

  return fallback || new TextDecoder().decode(buffer);
}

function parseNumeric(value: string | undefined | null): number | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || !DECIMAL_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCell(value: string | undefined): string | number | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed === "") {
    return null;
  }

  if (DECIMAL_PATTERN.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return trimmed;
}

function findHeader(headers: string[], candidates: string[]): string | null {
  for (const name of candidates) {
    if (headers.includes(name)) {
      return name;
    }
  }
  return null;
}

function getValue(row: string[], indexMap: Map<string, number>, header: string | null): string {
  if (!header) {
    return "";
  }
  const idx = indexMap.get(header);
  if (idx === undefined) {
    return "";
  }
  return row[idx] ?? "";
}

export async function parseEdgeTxCsv(file: File): Promise<ParsedCsvResult> {
  const text = await decodeCsvText(file);
  const parseResult = Papa.parse<string[]>(text, {
    delimiter: ",",
    skipEmptyLines: true
  });

  if (!parseResult.data.length) {
    return {
      headers: [],
      points: [],
      errors: ["CSV is empty."]
    };
  }

  const [rawHeaderRow, ...rawRows] = parseResult.data;
  const headers = normalizeHeaders(rawHeaderRow.map((item) => item.trim()));
  const indexMap = new Map(headers.map((header, index) => [header, index]));
  const errors: string[] = [];
  const points: FlightPoint[] = [];

  const alt1Header =
    findHeader(headers, ["Alt(m)#1", "Alt(m)"]) ?? findHeader(headers, ["Alt"]);
  const alt2Header =
    findHeader(headers, ["Alt(m)#2"]) ?? alt1Header ?? findHeader(headers, ["Alt"]);
  const dateHeader = findHeader(headers, ["Date"]);
  const timeHeader = findHeader(headers, ["Time"]);
  const gpsHeader = findHeader(headers, ["GPS"]);
  const speedHeader = findHeader(headers, ["GSpd(kmh)"]);
  const voltageHeader = findHeader(headers, ["RxBt(V)", "TxBat(V)"]);
  const currentHeader = findHeader(headers, ["Curr(A)"]);

  let cumulativeDistance = 0;
  let previousLat: number | null = null;
  let previousLon: number | null = null;

  rawRows.forEach((row, rawRowIndex) => {
    if (row.length < headers.length) {
      errors.push(`Row ${rawRowIndex + 2}: column count mismatch.`);
      return;
    }

    const date = getValue(row, indexMap, dateHeader);
    const time = getValue(row, indexMap, timeHeader);
    const gpsText = getValue(row, indexMap, gpsHeader);
    const gps = parseGps(gpsText);

    if (!gps) {
      errors.push(`Row ${rawRowIndex + 2}: invalid GPS value "${gpsText}".`);
      return;
    }

    const timestamp = Date.parse(`${date}T${time}`);
    if (Number.isNaN(timestamp)) {
      errors.push(`Row ${rawRowIndex + 2}: invalid timestamp "${date} ${time}".`);
      return;
    }

    if (previousLat !== null && previousLon !== null) {
      cumulativeDistance += haversineDistanceMeters(previousLat, previousLon, gps.lat, gps.lon);
    }
    previousLat = gps.lat;
    previousLon = gps.lon;

    const raw: Record<string, string | number | null> = {};
    headers.forEach((header, index) => {
      raw[header] = normalizeCell(row[index]);
    });
    raw.__distance_m = Number(cumulativeDistance.toFixed(1));

    points.push({
      index: points.length,
      timestampMs: timestamp,
      date,
      time,
      lat: gps.lat,
      lon: gps.lon,
      alt1: parseNumeric(getValue(row, indexMap, alt1Header)) ?? 0,
      alt2: parseNumeric(getValue(row, indexMap, alt2Header)) ?? 0,
      speedKmh: parseNumeric(getValue(row, indexMap, speedHeader)),
      voltageV: parseNumeric(getValue(row, indexMap, voltageHeader)),
      currentA: parseNumeric(getValue(row, indexMap, currentHeader)),
      raw
    });
  });

  if (parseResult.errors.length) {
    parseResult.errors.forEach((err) => {
      errors.push(`CSV parse warning: ${err.message}`);
    });
  }

  return { headers, points, errors };
}
