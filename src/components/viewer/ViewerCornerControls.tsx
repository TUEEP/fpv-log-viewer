import NearMeRoundedIcon from "@mui/icons-material/NearMeRounded";
import SwapHorizRoundedIcon from "@mui/icons-material/SwapHorizRounded";
import { ButtonBase, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type { ViewMode } from "../../types/flight";

interface ViewerCornerControlsProps {
  viewMode: ViewMode;
  autoFollowMode: boolean;
  frontFollowMode: boolean;
  onAutoFollowChange: (enabled: boolean) => void;
  onFrontFollowChange: (enabled: boolean) => void;
  onToggleViewMode: () => void;
}

export function ViewerCornerControls({
  viewMode,
  autoFollowMode,
  frontFollowMode,
  onAutoFollowChange,
  onFrontFollowChange,
  onToggleViewMode
}: ViewerCornerControlsProps) {
  const { t } = useTranslation();

  return (
    <Stack
      direction="row"
      spacing={0.45}
      alignItems="center"
      sx={{
        position: "absolute",
        left: 12,
        bottom: 12,
        zIndex: 8
      }}
    >
      <ButtonBase
        onClick={onToggleViewMode}
        aria-label={viewMode === "2d" ? "switch-to-3d" : "switch-to-2d"}
        sx={{
          width: 36,
          minWidth: 36,
          height: 28,
          borderRadius: 0.8,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.paper, 0.8)
              : alpha(theme.palette.background.paper, 0.94),
          color: "text.primary",
          "&:hover": {
            bgcolor: (theme) =>
              theme.palette.mode === "dark"
                ? alpha(theme.palette.background.paper, 0.9)
                : alpha(theme.palette.background.paper, 1)
          }
        }}
      >
        <Stack spacing={0.12} alignItems="center" justifyContent="center">
          <Typography sx={{ fontSize: 10.5, lineHeight: 1, fontWeight: 800 }}>
            {viewMode.toUpperCase()}
          </Typography>
          <SwapHorizRoundedIcon sx={{ fontSize: 11 }} />
        </Stack>
      </ButtonBase>

      <ToggleButtonGroup
        size="small"
        value={[
          ...(autoFollowMode ? ["auto"] : []),
          ...(frontFollowMode ? ["front"] : [])
        ]}
        onChange={(_event, next: Array<"auto" | "front">) => {
          onAutoFollowChange(next.includes("auto"));
          onFrontFollowChange(next.includes("front"));
        }}
        aria-label="follow-modes"
        sx={{
          borderRadius: 0.8,
          overflow: "hidden",
          backdropFilter: "blur(3px)",
          bgcolor: (theme) =>
            theme.palette.mode === "dark"
              ? alpha(theme.palette.background.paper, 0.82)
              : alpha(theme.palette.background.paper, 0.94),
          "& .MuiToggleButton-root": {
            px: 0.68,
            py: 0.2,
            minWidth: 0,
            height: 28,
            color: "text.secondary",
            borderColor: "divider",
            "&:hover": {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12)
            },
            "&.Mui-selected": {
              color: (theme) =>
                theme.palette.mode === "dark" ? "#e9f5ff" : theme.palette.primary.dark,
              borderColor: "primary.main",
              bgcolor: (theme) =>
                theme.palette.mode === "dark"
                  ? alpha(theme.palette.primary.main, 0.34)
                  : alpha(theme.palette.primary.main, 0.18),
              boxShadow: (theme) =>
                `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.45)}`,
              "&:hover": {
                bgcolor: (theme) =>
                  theme.palette.mode === "dark"
                    ? alpha(theme.palette.primary.main, 0.4)
                    : alpha(theme.palette.primary.main, 0.24)
              }
            }
          }
        }}
      >
        <Tooltip
          title={t("toolbar.followAutoHint", {
            defaultValue: "Auto follow center and zoom while playing"
          })}
        >
          <ToggleButton value="auto" aria-label="follow-auto" sx={{ minWidth: 74 }}>
            <Typography sx={{ fontSize: 10.5, fontWeight: 700, whiteSpace: "nowrap" }}>
              {t("toolbar.followAuto", { defaultValue: "Auto Follow" })}
            </Typography>
          </ToggleButton>
        </Tooltip>
        <Tooltip
          title={t("toolbar.followFrontHint", {
            defaultValue: "Keep camera facing movement direction while playing"
          })}
        >
          <ToggleButton value="front" aria-label="follow-front" sx={{ width: 30 }}>
            <NearMeRoundedIcon sx={{ fontSize: 13 }} />
          </ToggleButton>
        </Tooltip>
      </ToggleButtonGroup>
    </Stack>
  );
}
