import type { FlightPoint } from "../../types/flight";

interface Vec2 {
  x: number;
  y: number;
}

function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const t2 = t * t;
  const t3 = t2 * t;

  const x =
    0.5 *
    ((2 * p1.x) +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    ((2 * p1.y) +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);

  return { x, y };
}

function lerp(a: Vec2, b: Vec2, t: number): Vec2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}

export function buildSmoothedTrack(
  points: FlightPoint[],
  tension: number,
  samplesPerSegment: number
): [number, number][] {
  if (points.length <= 2 || samplesPerSegment <= 1) {
    return points.map((p) => [p.lon, p.lat]);
  }

  const smoothFactor = Math.max(0, Math.min(1, 1 - tension));
  const raw = points.map((point) => ({ x: point.lon, y: point.lat }));
  const result: [number, number][] = [];

  for (let i = 0; i < raw.length - 1; i += 1) {
    const p0 = raw[Math.max(0, i - 1)];
    const p1 = raw[i];
    const p2 = raw[i + 1];
    const p3 = raw[Math.min(raw.length - 1, i + 2)];

    for (let j = 0; j < samplesPerSegment; j += 1) {
      const t = j / samplesPerSegment;
      const smooth = catmullRom(p0, p1, p2, p3, t);
      const linear = lerp(p1, p2, t);
      const finalPoint = lerp(linear, smooth, smoothFactor);
      result.push([finalPoint.x, finalPoint.y]);
    }
  }

  const last = raw[raw.length - 1];
  result.push([last.x, last.y]);
  return result;
}
