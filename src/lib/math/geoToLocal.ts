import type { AltitudeMode, FlightPoint } from "../../types/flight";

const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;

export interface Local3DPoint {
  x: number;
  y: number;
  z: number;
}

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) *
      Math.cos(lat2 * DEG_TO_RAD) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function toLocal3D(
  points: FlightPoint[],
  altitudeMode: AltitudeMode,
  zScale: number
): Local3DPoint[] {
  if (points.length === 0) {
    return [];
  }

  const origin = points[0];
  const originLatRad = origin.lat * DEG_TO_RAD;
  const baseAltitude = altitudeMode === "alt1" ? origin.alt1 : origin.alt2;

  return points.map((point) => {
    const dLat = (point.lat - origin.lat) * DEG_TO_RAD;
    const dLon = (point.lon - origin.lon) * DEG_TO_RAD;
    const x = dLon * Math.cos(originLatRad) * EARTH_RADIUS_M;
    const y = dLat * EARTH_RADIUS_M;
    const rawAltitude = altitudeMode === "alt1" ? point.alt1 : point.alt2;
    const z = (rawAltitude - baseAltitude) * zScale;

    return { x, y, z };
  });
}
