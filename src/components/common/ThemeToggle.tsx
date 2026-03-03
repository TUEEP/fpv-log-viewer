import DarkModeRoundedIcon from "@mui/icons-material/DarkModeRounded";
import LightModeRoundedIcon from "@mui/icons-material/LightModeRounded";
import { IconButton, Tooltip } from "@mui/material";
import type { ThemeMode } from "../../types/flight";

interface ThemeToggleProps {
  value: ThemeMode;
  darkLabel: string;
  lightLabel: string;
  onChange: (next: ThemeMode) => void;
}

export function ThemeToggle({ value, darkLabel, lightLabel, onChange }: ThemeToggleProps) {
  const isDark = value === "dark";
  const currentLabel = isDark ? darkLabel : lightLabel;

  return (
    <Tooltip title={currentLabel}>
      <IconButton
        size="small"
        color={isDark ? "secondary" : "primary"}
        aria-label={currentLabel}
        onClick={() => onChange(isDark ? "light" : "dark")}
      >
        {isDark ? <DarkModeRoundedIcon fontSize="small" /> : <LightModeRoundedIcon fontSize="small" />}
      </IconButton>
    </Tooltip>
  );
}
