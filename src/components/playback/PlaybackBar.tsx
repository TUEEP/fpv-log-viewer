import FastForwardRoundedIcon from "@mui/icons-material/FastForwardRounded";
import FastRewindRoundedIcon from "@mui/icons-material/FastRewindRounded";
import PauseRoundedIcon from "@mui/icons-material/PauseRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import {
  Box,
  IconButton,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Typography
} from "@mui/material";
import { useId, useMemo } from "react";
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
  onDecreaseSpeed: () => void;
  onPlayPause: () => void;
  onIncreaseSpeed: () => void;
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
  onDecreaseSpeed,
  onPlayPause,
  onIncreaseSpeed,
  onSpeedChange,
  onSeek
}: PlaybackBarProps) {
  const { t } = useTranslation();
  const speedLabelId = useId();

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
  const sliderMax = Math.max(total - 1, 0);
  const speedIndex = playbackSpeedOptions.indexOf(speed);
  const canDecreaseSpeed = speedIndex > 0;
  const canIncreaseSpeed = speedIndex >= 0 && speedIndex < playbackSpeedOptions.length - 1;

  return (
    <Paper component="footer" variant="outlined" sx={{ borderRadius: 1.5, px: 1.2, py: 1 }}>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={1}
        alignItems={{ xs: "stretch", md: "center" }}
      >
        <Stack direction="row" spacing={0.4} alignItems="center">
          <IconButton
            size="small"
            onClick={onDecreaseSpeed}
            disabled={disabled || !canDecreaseSpeed}
            aria-label={t("playback.slower")}
          >
            <FastRewindRoundedIcon />
          </IconButton>
          <IconButton
            size="small"
            color={isPlaying ? "secondary" : "primary"}
            onClick={onPlayPause}
            disabled={disabled}
            aria-label={isPlaying ? t("playback.pause") : t("playback.play")}
          >
            {isPlaying ? <PauseRoundedIcon /> : <PlayArrowRoundedIcon />}
          </IconButton>
          <IconButton
            size="small"
            onClick={onIncreaseSpeed}
            disabled={disabled || !canIncreaseSpeed}
            aria-label={t("playback.faster")}
          >
            <FastForwardRoundedIcon />
          </IconButton>

          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ pl: 0.5 }}>
            <Typography id={speedLabelId} variant="caption" color="text.secondary">
              {t("playback.speed")}
            </Typography>
            <Select
              size="small"
              value={speed}
              onChange={(event) => onSpeedChange(Number(event.target.value) as PlaybackSpeed)}
              disabled={disabled}
              inputProps={{ "aria-labelledby": speedLabelId }}
              sx={{ minWidth: 80 }}
            >
              {playbackSpeedOptions.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}x
                </MenuItem>
              ))}
            </Select>
          </Stack>
        </Stack>

        <Box sx={{ flex: 1, px: { md: 1 }, minWidth: 0 }}>
          <Slider
            size="small"
            min={0}
            max={sliderMax}
            value={Math.min(currentIndex, sliderMax)}
            onChange={(_, value) => {
              if (typeof value === "number") {
                onSeek(Math.round(value));
              }
            }}
            disabled={disabled}
            aria-label={t("playback.seek")}
            getAriaValueText={(value) =>
              t("playback.seekValue", {
                current: Number(value) + 1,
                total: Math.max(total, 1)
              })
            }
          />
        </Box>

        <Stack
          direction={{ xs: "row", md: "column" }}
          justifyContent="space-between"
          spacing={{ xs: 1.2, md: 0.2 }}
          sx={{ minWidth: { md: 188 } }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {t("playback.frame")}: {total === 0 ? "0 / 0" : `${currentIndex + 1} / ${total}`}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: "nowrap" }}>
            {t("playback.time")}: {formatDuration(currentElapsed)} / {formatDuration(totalElapsed)}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}
