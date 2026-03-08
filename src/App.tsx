import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Box, CircularProgress, CssBaseline, ThemeProvider, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { TopToolbar } from "./components/topbar/TopToolbar";
import { PointDetailPanel } from "./components/sidebar/PointDetailPanel";
import { PlaybackBar } from "./components/playback/PlaybackBar";
import { buildSmoothedTrack } from "./lib/math/smoothPath";
import { resolvePlaybackCursor } from "./lib/playback/playbackEngine";
import { playbackSpeedOptions, useViewerStore } from "./store/viewerStore";
import { createAppTheme } from "./theme/muiTheme";

const Viewer2D = lazy(async () => {
  const module = await import("./components/viewer/Viewer2D");
  return { default: module.Viewer2D };
});

const Viewer3D = lazy(async () => {
  const module = await import("./components/viewer/Viewer3D");
  return { default: module.Viewer3D };
});

export default function App() {
  const { t } = useTranslation();
  const shellRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const points = useViewerStore((state) => state.points);
  const errors = useViewerStore((state) => state.errors);
  const selectedIndex = useViewerStore((state) => state.selectedIndex);
  const playback = useViewerStore((state) => state.playback);
  const viewMode = useViewerStore((state) => state.viewMode);
  const mapProvider = useViewerStore((state) => state.mapProvider);
  const mapStyle = useViewerStore((state) => state.mapStyle);
  const altitudeMode = useViewerStore((state) => state.altitudeMode);
  const language = useViewerStore((state) => state.language);
  const theme = useViewerStore((state) => state.theme);
  const trackWidth = useViewerStore((state) => state.trackWidth);
  const zScale = useViewerStore((state) => state.zScale);
  const autoFollowMode = useViewerStore((state) => state.autoFollowMode);
  const frontFollowMode = useViewerStore((state) => state.frontFollowMode);
  const isFullscreen = useViewerStore((state) => state.isFullscreen);
  const playbackCarryMs = useViewerStore((state) => state.playbackCarryMs);

  const setData = useViewerStore((state) => state.setData);
  const setSelectedIndex = useViewerStore((state) => state.setSelectedIndex);
  const setCurrentIndex = useViewerStore((state) => state.setCurrentIndex);
  const togglePlay = useViewerStore((state) => state.togglePlay);
  const setSpeed = useViewerStore((state) => state.setSpeed);
  const advancePlayback = useViewerStore((state) => state.advancePlayback);
  const setViewMode = useViewerStore((state) => state.setViewMode);
  const setMapProvider = useViewerStore((state) => state.setMapProvider);
  const setMapStyle = useViewerStore((state) => state.setMapStyle);
  const setAltitudeMode = useViewerStore((state) => state.setAltitudeMode);
  const setTheme = useViewerStore((state) => state.setTheme);
  const setLanguage = useViewerStore((state) => state.setLanguage);
  const setTrackWidth = useViewerStore((state) => state.setTrackWidth);
  const setZScale = useViewerStore((state) => state.setZScale);
  const setAutoFollowMode = useViewerStore((state) => state.setAutoFollowMode);
  const setFrontFollowMode = useViewerStore((state) => state.setFrontFollowMode);
  const setIsFullscreen = useViewerStore((state) => state.setIsFullscreen);

  const smoothedTrack = useMemo(() => buildSmoothedTrack(points, 0.2, 10), [points]);
  const playbackCursor = useMemo(() => {
    if (!playback.isPlaying) {
      return playback.currentIndex;
    }
    return resolvePlaybackCursor(points, playback.currentIndex, playbackCarryMs);
  }, [points, playback.currentIndex, playback.isPlaying, playbackCarryMs]);
  const selectedIndexForView = playback.isPlaying ? playback.currentIndex : selectedIndex;
  const activeDetailPoint = points[selectedIndexForView] ?? points[playback.currentIndex] ?? null;
  const muiTheme = useMemo(() => createAppTheme(theme), [theme]);

  useEffect(() => {
    void i18n.changeLanguage(language);
  }, [language]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [setIsFullscreen]);

  useEffect(() => {
    if (!playback.isPlaying || points.length === 0 || playback.speed <= 0) {
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (time: number) => {
      const elapsed = time - lastTime;
      lastTime = time;
      advancePlayback(elapsed);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [playback.isPlaying, playback.speed, points.length, advancePlayback]);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
      const { parseEdgeTxCsv } = await import("./lib/csv/parseEdgeTxCsv");
      const parsed = await parseEdgeTxCsv(file);
      setData(parsed);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePointSelect = (index: number) => {
    setSelectedIndex(index);
    if (playback.isPlaying) {
      setCurrentIndex(index);
    }
  };

  const handleToggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await shellRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore browser fullscreen API errors.
    }
  };

  const handlePlayPause = () => {
    if (!playback.isPlaying && points.length > 0 && playback.currentIndex >= points.length - 1) {
      setCurrentIndex(0);
      setSelectedIndex(0);
    }
    togglePlay();
  };

  const handleAdjustSpeed = (direction: -1 | 1) => {
    const currentSpeedIndex = playbackSpeedOptions.indexOf(playback.speed);
    if (currentSpeedIndex < 0) {
      return;
    }
    const nextSpeedIndex = Math.max(
      0,
      Math.min(playbackSpeedOptions.length - 1, currentSpeedIndex + direction)
    );
    if (nextSpeedIndex === currentSpeedIndex) {
      return;
    }
    setSpeed(playbackSpeedOptions[nextSpeedIndex]);
  };

  return (
    <ThemeProvider theme={muiTheme}>
      <CssBaseline />
      <Box
        ref={shellRef}
        sx={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          gap: 1,
          p: { xs: 1, sm: 1.2 }
        }}
      >
        <TopToolbar
          onUpload={handleUpload}
          viewMode={viewMode}
          mapProvider={mapProvider}
          setMapProvider={setMapProvider}
          mapStyle={mapStyle}
          setMapStyle={setMapStyle}
          altitudeMode={altitudeMode}
          setAltitudeMode={setAltitudeMode}
          language={language}
          setLanguage={setLanguage}
          theme={theme}
          setTheme={setTheme}
          trackWidth={trackWidth}
          setTrackWidth={setTrackWidth}
          zScale={zScale}
          setZScale={setZScale}
          isFullscreen={isFullscreen}
          onToggleFullscreen={handleToggleFullscreen}
        />

        <Box
          sx={{
            minHeight: 0,
            flex: 1,
            display: "grid",
            gap: 1,
            gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1fr) 300px" },
            gridTemplateRows: { xs: "minmax(0, 1fr) minmax(240px, 36vh)", lg: "minmax(0, 1fr)" }
          }}
        >
          <Box
            sx={{
              minWidth: 0,
              minHeight: 0,
              position: "relative",
              borderRadius: 1.5,
              overflow: "hidden",
              border: "1px solid",
              borderColor: "divider",
              bgcolor: "background.paper"
            }}
          >
            <Suspense
              fallback={
                <Box
                  sx={{
                    position: "absolute",
                    inset: 0,
                    display: "grid",
                    placeItems: "center",
                    gap: 1,
                    alignContent: "center",
                    bgcolor: "background.paper"
                  }}
                >
                  <CircularProgress size={26} />
                  <Typography variant="body2" color="text.secondary">
                    Loading viewer...
                  </Typography>
                </Box>
              }
            >
              {viewMode === "2d" ? (
                <Viewer2D
                  points={points}
                  smoothedTrack={smoothedTrack}
                  selectedIndex={selectedIndexForView}
                  currentIndex={playback.currentIndex}
                  playbackCursor={playbackCursor}
                  isPlaying={playback.isPlaying}
                  autoFollowMode={autoFollowMode}
                  frontFollowMode={frontFollowMode}
                  mapProvider={mapProvider}
                  mapStyle={mapStyle}
                  trackWidth={trackWidth}
                  setAutoFollowMode={setAutoFollowMode}
                  setFrontFollowMode={setFrontFollowMode}
                  onToggleViewMode={() => setViewMode("3d")}
                  onSelect={handlePointSelect}
                />
              ) : (
                <Viewer3D
                  points={points}
                  altitudeMode={altitudeMode}
                  mapProvider={mapProvider}
                  mapStyle={mapStyle}
                  zScale={zScale}
                  selectedIndex={selectedIndexForView}
                  currentIndex={playback.currentIndex}
                  playbackCursor={playbackCursor}
                  isPlaying={playback.isPlaying}
                  autoFollowMode={autoFollowMode}
                  frontFollowMode={frontFollowMode}
                  trackWidth={trackWidth}
                  setAutoFollowMode={setAutoFollowMode}
                  setFrontFollowMode={setFrontFollowMode}
                  onToggleViewMode={() => setViewMode("2d")}
                  onSelect={handlePointSelect}
                />
              )}
            </Suspense>

            {points.length === 0 ? (
              <Box
                sx={{
                  position: "absolute",
                  inset: 0,
                  display: "grid",
                  placeItems: "center",
                  pointerEvents: "none",
                  backgroundColor: "rgba(10, 24, 38, 0.38)"
                }}
              >
                <Typography variant="subtitle1" color="text.secondary">
                  {isLoading ? "Parsing CSV..." : t("app.empty")}
                </Typography>
              </Box>
            ) : null}

            {errors.length > 0 ? (
              <Alert
                severity="warning"
                variant="filled"
                sx={{
                  position: "absolute",
                  left: 12,
                  bottom: 12,
                  py: 0.2,
                  px: 0.8,
                  zIndex: 6,
                  alignItems: "center"
                }}
              >
                {`${errors.length} parse warnings`}
              </Alert>
            ) : null}
          </Box>

          <PointDetailPanel point={activeDetailPoint} language={language} />
        </Box>

        <PlaybackBar
          total={points.length}
          currentIndex={playback.currentIndex}
          isPlaying={playback.isPlaying}
          speed={playback.speed}
          currentTimestamp={points[playback.currentIndex]?.timestampMs ?? null}
          startTimestamp={points[0]?.timestampMs ?? null}
          endTimestamp={points[points.length - 1]?.timestampMs ?? null}
          onDecreaseSpeed={() => handleAdjustSpeed(-1)}
          onPlayPause={handlePlayPause}
          onIncreaseSpeed={() => handleAdjustSpeed(1)}
          onSpeedChange={setSpeed}
          onSeek={(index) => {
            setCurrentIndex(index);
            setSelectedIndex(index);
          }}
        />
      </Box>
    </ThemeProvider>
  );
}
