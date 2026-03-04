interface TimestampedPoint {
  timestampMs: number;
}

export interface TrailRange {
  startIndex: number;
  endIndex: number;
}

export interface TrailCursorRange {
  startCursor: number;
  endCursor: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveTimestampAtCursor(points: TimestampedPoint[], cursor: number): number | null {
  if (points.length === 0) {
    return null;
  }

  const maxCursor = points.length - 1;
  const clampedCursor = clamp(cursor, 0, maxCursor);
  const floorIndex = Math.floor(clampedCursor);
  const alpha = clampedCursor - floorIndex;
  const currentTs = points[floorIndex]?.timestampMs;
  if (!Number.isFinite(currentTs)) {
    return null;
  }

  if (alpha <= 1e-9 || floorIndex >= points.length - 1) {
    return currentTs;
  }

  const nextTs = points[floorIndex + 1]?.timestampMs;
  if (!Number.isFinite(nextTs) || nextTs < currentTs) {
    return currentTs;
  }

  return currentTs + (nextTs - currentTs) * alpha;
}

export function resolveTrailCursorRange(
  points: TimestampedPoint[],
  currentCursor: number,
  isPlaying: boolean,
  windowMs: number
): TrailCursorRange {
  if (points.length === 0) {
    return { startCursor: 0, endCursor: -1 };
  }

  if (!isPlaying) {
    return { startCursor: 0, endCursor: points.length - 1 };
  }

  const maxCursor = points.length - 1;
  const endCursor = clamp(currentCursor, 0, maxCursor);
  if (windowMs <= 0) {
    return { startCursor: endCursor, endCursor };
  }

  const currentTimestamp = resolveTimestampAtCursor(points, endCursor);
  if (currentTimestamp === null || !Number.isFinite(currentTimestamp)) {
    return { startCursor: 0, endCursor };
  }

  const startTargetTs = currentTimestamp - windowMs;
  const firstTimestamp = points[0]?.timestampMs;
  if (!Number.isFinite(firstTimestamp) || startTargetTs <= firstTimestamp) {
    return { startCursor: 0, endCursor };
  }

  const endFloor = Math.floor(endCursor);
  const endAlpha = endCursor - endFloor;
  const endFloorTs = points[endFloor]?.timestampMs;
  if (endAlpha > 1e-9 && endFloor < points.length - 1 && Number.isFinite(endFloorTs)) {
    const nextTs = points[endFloor + 1]?.timestampMs;
    if (Number.isFinite(nextTs) && nextTs > endFloorTs && startTargetTs >= endFloorTs) {
      const alpha = clamp((startTargetTs - endFloorTs) / (nextTs - endFloorTs), 0, endAlpha);
      return { startCursor: endFloor + alpha, endCursor };
    }
  }

  for (let upper = endFloor; upper > 0; upper -= 1) {
    const lower = upper - 1;
    const lowerTs = points[lower]?.timestampMs;
    const upperTs = points[upper]?.timestampMs;
    if (!Number.isFinite(lowerTs) || !Number.isFinite(upperTs) || upperTs < lowerTs) {
      break;
    }

    if (startTargetTs >= lowerTs) {
      if (upperTs <= lowerTs) {
        return { startCursor: lower, endCursor };
      }
      const alpha = clamp((startTargetTs - lowerTs) / (upperTs - lowerTs), 0, 1);
      return { startCursor: lower + alpha, endCursor };
    }
  }

  return { startCursor: 0, endCursor };
}

export function resolveTrailRange(
  points: TimestampedPoint[],
  currentIndex: number,
  isPlaying: boolean,
  windowMs: number
): TrailRange {
  const cursorRange = resolveTrailCursorRange(points, currentIndex, isPlaying, windowMs);
  if (cursorRange.endCursor < 0) {
    return { startIndex: 0, endIndex: -1 };
  }
  return {
    startIndex: Math.max(0, Math.floor(cursorRange.startCursor)),
    endIndex: Math.max(0, Math.floor(cursorRange.endCursor))
  };
}
