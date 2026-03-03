interface TimestampedPoint {
  timestampMs: number;
}

export interface TrailRange {
  startIndex: number;
  endIndex: number;
}

export function resolveTrailRange(
  points: TimestampedPoint[],
  currentIndex: number,
  isPlaying: boolean,
  windowMs: number
): TrailRange {
  if (points.length === 0) {
    return { startIndex: 0, endIndex: -1 };
  }

  if (!isPlaying) {
    return { startIndex: 0, endIndex: points.length - 1 };
  }

  const clampedCurrent = Math.max(0, Math.min(points.length - 1, currentIndex));
  if (windowMs <= 0) {
    return { startIndex: clampedCurrent, endIndex: clampedCurrent };
  }

  const currentTimestamp = points[clampedCurrent]?.timestampMs;
  if (!Number.isFinite(currentTimestamp)) {
    return { startIndex: 0, endIndex: clampedCurrent };
  }

  let startIndex = clampedCurrent;
  while (startIndex > 0) {
    const previousTimestamp = points[startIndex - 1]?.timestampMs;
    if (!Number.isFinite(previousTimestamp)) {
      break;
    }

    const elapsed = currentTimestamp - previousTimestamp;
    if (elapsed < 0 || elapsed > windowMs) {
      break;
    }
    startIndex -= 1;
  }

  return { startIndex, endIndex: clampedCurrent };
}
