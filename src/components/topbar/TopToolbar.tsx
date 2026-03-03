import {
  Box,
  MenuItem,
  Paper,
  Select,
  Slider,
  Stack,
  Typography
} from "@mui/material";
import { useTranslation } from "react-i18next";
import type {
  AltitudeMode,
  Language,
  MapProvider,
  MapStyleMode,
  ThemeMode,
  ViewMode
} from "../../types/flight";
import { UploadButton } from "../common/UploadButton";
import { ThemeToggle } from "../common/ThemeToggle";
import { LanguageSelect } from "../common/LanguageSelect";
import { FullscreenButton } from "../common/FullscreenButton";

interface TopToolbarProps {
  onUpload: (file: File) => void;
  viewMode: ViewMode;
  mapProvider: MapProvider;
  setMapProvider: (provider: MapProvider) => void;
  mapStyle: MapStyleMode;
  setMapStyle: (style: MapStyleMode) => void;
  altitudeMode: AltitudeMode;
  setAltitudeMode: (mode: AltitudeMode) => void;
  language: Language;
  setLanguage: (language: Language) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
  pointSize: number;
  setPointSize: (size: number) => void;
  pointStride: number;
  setPointStride: (stride: number) => void;
  zScale: number;
  setZScale: (scale: number) => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function TopToolbar({
  onUpload,
  viewMode,
  mapProvider,
  setMapProvider,
  mapStyle,
  setMapStyle,
  altitudeMode,
  setAltitudeMode,
  language,
  setLanguage,
  theme,
  setTheme,
  pointSize,
  setPointSize,
  pointStride,
  setPointStride,
  zScale,
  setZScale,
  isFullscreen,
  onToggleFullscreen
}: TopToolbarProps) {
  const { t } = useTranslation();

  return (
    <Paper
      component="header"
      variant="outlined"
      sx={{
        borderRadius: 1.5,
        px: { xs: 1.2, sm: 1.6 },
        py: 1.2,
        display: "flex",
        flexDirection: "column",
        gap: 1.25
      }}
    >
      <Stack
        direction={{ xs: "column", md: "row" }}
        alignItems={{ xs: "flex-start", md: "center" }}
        justifyContent="space-between"
        spacing={1}
      >
        <Typography variant="h6">{t("app.title")}</Typography>

        <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
          <UploadButton label={t("toolbar.upload")} onFileSelected={onUpload} />
          <FullscreenButton
            label={t("toolbar.fullscreen")}
            isFullscreen={isFullscreen}
            onToggle={onToggleFullscreen}
          />
          <ThemeToggle
            value={theme}
            darkLabel={t("toolbar.dark")}
            lightLabel={t("toolbar.light")}
            onChange={setTheme}
          />
        </Stack>
      </Stack>

      <Stack
        direction="row"
        spacing={1.5}
        useFlexGap
        flexWrap="wrap"
        alignItems="flex-end"
      >
        <Box sx={{ minWidth: 136 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.mapSource", { defaultValue: "Map Source" })}
          </Typography>
          <Select
            size="small"
            value={mapProvider}
            onChange={(event) => setMapProvider(event.target.value as MapProvider)}
            fullWidth
          >
            <MenuItem value="osm">{t("toolbar.sourceOsm", { defaultValue: "OpenStreetMap" })}</MenuItem>
            <MenuItem value="amap">{t("toolbar.sourceAmap", { defaultValue: "Amap" })}</MenuItem>
          </Select>
        </Box>

        <Box sx={{ minWidth: 116 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.mapStyle")}
          </Typography>
          <Select
            size="small"
            value={mapStyle}
            onChange={(event) => setMapStyle(event.target.value as MapStyleMode)}
            fullWidth
          >
            <MenuItem value="street">{t("toolbar.street")}</MenuItem>
            <MenuItem value="satellite">{t("toolbar.satellite")}</MenuItem>
          </Select>
        </Box>

        <Box sx={{ minWidth: 116 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.altitude")}
          </Typography>
          <Select
            size="small"
            value={altitudeMode}
            onChange={(event) => setAltitudeMode(event.target.value as AltitudeMode)}
            fullWidth
          >
            <MenuItem value="alt1">{t("toolbar.alt1")}</MenuItem>
            <MenuItem value="alt2">{t("toolbar.alt2")}</MenuItem>
          </Select>
        </Box>

        <Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.language")}
          </Typography>
          <LanguageSelect value={language} onChange={setLanguage} />
        </Box>

        <Box sx={{ width: { xs: 130, sm: 146 } }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.pointSize")}: {pointSize.toFixed(1)}
          </Typography>
          <Slider
            size="small"
            min={0.4}
            max={3}
            step={0.1}
            value={pointSize}
            valueLabelDisplay="auto"
            onChange={(_, value) => {
              if (typeof value === "number") {
                setPointSize(value);
              }
            }}
          />
        </Box>

        <Box sx={{ width: { xs: 130, sm: 146 } }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
            {t("toolbar.pointStride")}: {pointStride}
          </Typography>
          <Slider
            size="small"
            min={1}
            max={10}
            step={1}
            value={pointStride}
            valueLabelDisplay="auto"
            onChange={(_, value) => {
              if (typeof value === "number") {
                setPointStride(value);
              }
            }}
          />
        </Box>

        {viewMode === "3d" ? (
          <Box sx={{ width: { xs: 130, sm: 146 } }}>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block" }}>
              {t("toolbar.zScale")}: {zScale.toFixed(1)}
            </Typography>
            <Slider
              size="small"
              min={0.5}
              max={20}
              step={0.5}
              value={zScale}
              valueLabelDisplay="auto"
              onChange={(_, value) => {
                if (typeof value === "number") {
                  setZScale(value);
                }
              }}
            />
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
