import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { playbackSpeedOptions } from "../../store/viewerStore";
import type { PlaybackSpeed } from "../../types/flight";

interface PlaybackBarProps {
  total: number;
  currentIndex: number;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  currentTimestamp: number | null;
  startTimestamp: number | null;
  endTimestamp: number | null;
  onPrev: () => void;
  onPlayPause: () => void;
  onNext: () => void;
  onSpeedChange: (speed: PlaybackSpeed) => void;
  onSeek: (index: number) => void;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return "00:00";
  }
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function PlaybackBar({
  total,
  currentIndex,
  isPlaying,
  speed,
  currentTimestamp,
  startTimestamp,
  endTimestamp,
  onPrev,
  onPlayPause,
  onNext,
  onSpeedChange,
  onSeek
}: PlaybackBarProps) {
  const { t } = useTranslation();

  const currentElapsed = useMemo(() => {
    if (currentTimestamp === null || startTimestamp === null) {
      return 0;
    }
    return Math.max(0, currentTimestamp - startTimestamp);
  }, [currentTimestamp, startTimestamp]);

  const totalElapsed = useMemo(() => {
    if (startTimestamp === null || endTimestamp === null) {
      return 0;
    }
    return Math.max(0, endTimestamp - startTimestamp);
  }, [startTimestamp, endTimestamp]);

  const disabled = total <= 1;

  return (
    <footer className="playback-bar">
      <button type="button" className="control-button" onClick={onPrev} disabled={disabled}>
        {t("playback.prev")}
      </button>
      <button
        type="button"
        className="control-button active"
        onClick={onPlayPause}
        disabled={disabled}
      >
        {isPlaying ? t("playback.pause") : t("playback.play")}
      </button>
      <button type="button" className="control-button" onClick={onNext} disabled={disabled}>
        {t("playback.next")}
      </button>

      <label className="inline-control">
        <span>{t("playback.speed")}</span>
        <select
          className="control-select"
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value) as PlaybackSpeed)}
          disabled={disabled}
        >
          {playbackSpeedOptions.map((option) => (
            <option key={option} value={option}>
              {option}x
            </option>
          ))}
        </select>
      </label>

      <div className="timeline-wrap">
        <input
          type="range"
          min={0}
          max={Math.max(total - 1, 0)}
          value={Math.min(currentIndex, Math.max(total - 1, 0))}
          onChange={(event) => onSeek(Number(event.target.value))}
          disabled={disabled}
        />
      </div>

      <div className="timeline-meta">
        <div>
          {t("playback.frame")}: {total === 0 ? "0 / 0" : `${currentIndex + 1} / ${total}`}
        </div>
        <div>
          {t("playback.time")}: {formatDuration(currentElapsed)} / {formatDuration(totalElapsed)}
        </div>
      </div>
    </footer>
  );
}
