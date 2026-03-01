import type { FlightPoint, PlaybackSpeed } from "../../types/flight";

export function stepIndex(currentIndex: number, delta: number, total: number): number {
  if (total <= 0) {
    return 0;
  }

  const next = currentIndex + delta;
  return Math.max(0, Math.min(total - 1, next));
}

export interface PlaybackAdvanceResult {
  nextIndex: number;
  carryMs: number;
}

export function advancePlaybackByDelta(
  points: FlightPoint[],
  currentIndex: number,
  elapsedMs: number,
  speed: PlaybackSpeed,
  carryMs: number
): PlaybackAdvanceResult {
  if (points.length <= 1) {
    return {
      nextIndex: 0,
      carryMs: 0
    };
  }

  let nextIndex = Math.max(0, Math.min(points.length - 1, currentIndex));
  let remainingMs = Math.max(0, carryMs) + Math.max(0, elapsedMs) * speed;

  while (nextIndex < points.length - 1) {
    const currentTime = points[nextIndex].timestampMs;
    const nextTime = points[nextIndex + 1].timestampMs;
    const deltaMs = Math.max(1, nextTime - currentTime);

    if (remainingMs < deltaMs) {
      break;
    }

    remainingMs -= deltaMs;
    nextIndex += 1;
  }

  if (nextIndex >= points.length - 1) {
    return {
      nextIndex: points.length - 1,
      carryMs: 0
    };
  }

  return {
    nextIndex,
    carryMs: remainingMs
  };
}

export function advancePlaybackIndex(
  points: FlightPoint[],
  currentIndex: number,
  elapsedMs: number,
  speed: PlaybackSpeed
): number {
  return advancePlaybackByDelta(points, currentIndex, elapsedMs, speed, 0).nextIndex;
}
