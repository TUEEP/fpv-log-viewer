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
  setViewMode: (mode: ViewMode) => void;
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
  setViewMode,
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
    <header className="top-toolbar">
      <div className="toolbar-title">{t("app.title")}</div>

      <div className="toolbar-controls">
        <UploadButton label={t("toolbar.upload")} onFileSelected={onUpload} />

        <div className="segmented-control">
          <button
            className={`segment ${viewMode === "2d" ? "active" : ""}`}
            type="button"
            onClick={() => setViewMode("2d")}
          >
            {t("toolbar.view2d")}
          </button>
          <button
            className={`segment ${viewMode === "3d" ? "active" : ""}`}
            type="button"
            onClick={() => setViewMode("3d")}
          >
            {t("toolbar.view3d")}
          </button>
        </div>

        <label className="inline-control">
          <span>{t("toolbar.mapSource", { defaultValue: "Map Source" })}</span>
          <select
            className="control-select"
            value={mapProvider}
            onChange={(event) => setMapProvider(event.target.value as MapProvider)}
          >
            <option value="osm">{t("toolbar.sourceOsm", { defaultValue: "OpenStreetMap" })}</option>
            <option value="amap">{t("toolbar.sourceAmap", { defaultValue: "Amap" })}</option>
          </select>
        </label>

        <label className="inline-control">
          <span>{t("toolbar.mapStyle")}</span>
          <select
            className="control-select"
            value={mapStyle}
            onChange={(event) => setMapStyle(event.target.value as MapStyleMode)}
          >
            <option value="street">{t("toolbar.street")}</option>
            <option value="satellite">{t("toolbar.satellite")}</option>
          </select>
        </label>

        <label className="inline-control">
          <span>{t("toolbar.altitude")}</span>
          <select
            className="control-select"
            value={altitudeMode}
            onChange={(event) => setAltitudeMode(event.target.value as AltitudeMode)}
          >
            <option value="alt1">{t("toolbar.alt1")}</option>
            <option value="alt2">{t("toolbar.alt2")}</option>
          </select>
        </label>

        <label className="inline-control">
          <span>{t("toolbar.language")}</span>
          <LanguageSelect value={language} onChange={setLanguage} />
        </label>

        <label className="inline-control">
          <span>{t("toolbar.theme")}</span>
          <ThemeToggle
            value={theme}
            darkLabel={t("toolbar.dark")}
            lightLabel={t("toolbar.light")}
            onChange={setTheme}
          />
        </label>

        <label className="inline-control slider-inline">
          <span>{t("toolbar.pointSize")}</span>
          <input
            type="range"
            min={0.4}
            max={3}
            step={0.1}
            value={pointSize}
            onChange={(event) => setPointSize(Number(event.target.value))}
          />
        </label>

        <label className="inline-control slider-inline">
          <span>{t("toolbar.pointStride")}</span>
          <input
            type="range"
            min={1}
            max={10}
            step={1}
            value={pointStride}
            onChange={(event) => setPointStride(Number(event.target.value))}
          />
        </label>

        {viewMode === "3d" ? (
          <label className="inline-control slider-inline">
            <span>{t("toolbar.zScale")}</span>
            <input
              type="range"
              min={0.5}
              max={20}
              step={0.5}
              value={zScale}
              onChange={(event) => setZScale(Number(event.target.value))}
            />
          </label>
        ) : null}

        <FullscreenButton
          label={t("toolbar.fullscreen")}
          isFullscreen={isFullscreen}
          onToggle={onToggleFullscreen}
        />
      </div>
    </header>
  );
}
