import AddRoundedIcon from "@mui/icons-material/AddRounded";
import ExploreRoundedIcon from "@mui/icons-material/ExploreRounded";
import RemoveRoundedIcon from "@mui/icons-material/RemoveRounded";
import { Box, ButtonBase, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

interface ViewerNavigationControlsProps {
  bearingDeg: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth: () => void;
}

export function ViewerNavigationControls({
  bearingDeg,
  onZoomIn,
  onZoomOut,
  onResetNorth
}: ViewerNavigationControlsProps) {
  const { t } = useTranslation();
  const headingDeg = ((Math.round(bearingDeg) % 360) + 360) % 360;

  return (
    <Paper
      variant="outlined"
      sx={{
        position: "absolute",
        top: 12,
        right: 12,
        zIndex: 8,
        overflow: "hidden",
        borderRadius: 0.9,
        backdropFilter: "blur(3px)",
        bgcolor: (theme) =>
          theme.palette.mode === "dark"
            ? alpha(theme.palette.background.paper, 0.82)
            : alpha(theme.palette.background.paper, 0.94)
      }}
    >
      <Stack spacing={0}>
        <ButtonBase
          onClick={onZoomIn}
          aria-label={t("viewer.zoomIn")}
          sx={{
            width: 34,
            height: 34,
            color: "text.primary",
            borderBottom: "1px solid",
            borderColor: "divider",
            "&:hover": {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12)
            }
          }}
        >
          <AddRoundedIcon sx={{ fontSize: 18 }} />
        </ButtonBase>
        <ButtonBase
          onClick={onZoomOut}
          aria-label={t("viewer.zoomOut")}
          sx={{
            width: 34,
            height: 34,
            color: "text.primary",
            borderBottom: "1px solid",
            borderColor: "divider",
            "&:hover": {
              bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12)
            }
          }}
        >
          <RemoveRoundedIcon sx={{ fontSize: 18 }} />
        </ButtonBase>
        <Tooltip title={t("viewer.northHeading", { heading: headingDeg })} placement="left">
          <ButtonBase
            onClick={onResetNorth}
            aria-label={t("viewer.resetNorth", { heading: headingDeg })}
            sx={{
              width: 34,
              height: 34,
              color: "text.primary",
              "&:hover": {
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12)
              }
            }}
          >
            <Box
              sx={{
                position: "relative",
                width: 20,
                height: 20,
                transform: `rotate(${-bearingDeg - 45}deg)`,
                transition: "transform 180ms ease"
              }}
            >
              <ExploreRoundedIcon
                sx={{
                  position: "absolute",
                  inset: 0,
                  fontSize: 20
                }}
              />
              <Box
                sx={{
                  position: "absolute",
                  left: "50%",
                  top: "50%",
                  transform: "translate(-50%, -50%) rotate(45deg) translateY(-10px)",
                  transition: "transform 180ms ease"
                }}
              >
                <Typography
                  component="span"
                  sx={{
                    display: "block",
                    transform: `rotate(${bearingDeg}deg)`,
                    transition: "transform 180ms ease",
                    fontSize: 7,
                    lineHeight: 1,
                    fontWeight: 900,
                    letterSpacing: 0.2,
                    color: "text.primary",
                    textShadow: (theme) =>
                      theme.palette.mode === "dark"
                        ? `0 0 4px ${alpha("#000000", 0.9)}`
                        : `0 0 4px ${alpha("#ffffff", 0.92)}`
                  }}
                >
                  N
                </Typography>
              </Box>
            </Box>
          </ButtonBase>
        </Tooltip>
      </Stack>
    </Paper>
  );
}
