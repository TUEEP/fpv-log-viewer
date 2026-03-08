import { Box, Paper, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

export function ViewerSpeedLegend() {
  const { t } = useTranslation();

  return (
    <Paper
      variant="outlined"
      aria-hidden="true"
      sx={{
        position: "absolute",
        left: 12,
        top: 12,
        zIndex: 5,
        borderRadius: 1,
        px: 1.1,
        py: 0.6,
        display: "inline-flex",
        alignItems: "center",
        gap: 0.8,
        backdropFilter: "blur(3px)",
        bgcolor: (theme) =>
          theme.palette.mode === "dark"
            ? alpha(theme.palette.background.paper, 0.74)
            : alpha(theme.palette.background.paper, 0.92)
      }}
    >
      <Typography variant="caption" color="text.secondary">
        {t("viewer3d.slow", { defaultValue: "Slow" })}
      </Typography>
      <Box
        sx={{
          width: 92,
          height: 8,
          borderRadius: 999,
          background: "linear-gradient(90deg, #6f8cff 0%, #6ecdb9 56%, #ffc07a 100%)"
        }}
      />
      <Typography variant="caption" color="text.secondary">
        {t("viewer3d.fast", { defaultValue: "Fast" })}
      </Typography>
    </Paper>
  );
}
