import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "./i18n";
import { TopToolbar } from "./components/topbar/TopToolbar";
import { Viewer2D } from "./components/viewer/Viewer2D";
import { Viewer3D } from "./components/viewer/Viewer3D";
import { PointDetailPanel } from "./components/sidebar/PointDetailPanel";
import { PlaybackBar } from "./components/playback/PlaybackBar";
import { parseEdgeTxCsv } from "./lib/csv/parseEdgeTxCsv";
import { buildSmoothedTrack } from "./lib/math/smoothPath";
import { useViewerStore } from "./store/viewerStore";

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
  const pointSize = useViewerStore((state) => state.pointSize);
  const pointStride = useViewerStore((state) => state.pointStride);
  const zScale = useViewerStore((state) => state.zScale);
  const autoFollowMode = useViewerStore((state) => state.autoFollowMode);
  const frontFollowMode = useViewerStore((state) => state.frontFollowMode);
  const isFullscreen = useViewerStore((state) => state.isFullscreen);

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
  const setPointSize = useViewerStore((state) => state.setPointSize);
  const setPointStride = useViewerStore((state) => state.setPointStride);
  const setZScale = useViewerStore((state) => state.setZScale);
  const setAutoFollowMode = useViewerStore((state) => state.setAutoFollowMode);
  const setFrontFollowMode = useViewerStore((state) => state.setFrontFollowMode);
  const setIsFullscreen = useViewerStore((state) => state.setIsFullscreen);

  const smoothedTrack = useMemo(() => buildSmoothedTrack(points, 0.2, 10), [points]);
  const activeDetailPoint = points[selectedIndex] ?? points[playback.currentIndex] ?? null;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
    if (!playback.isPlaying) {
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

  useEffect(() => {
    if (playback.isPlaying) {
      setSelectedIndex(playback.currentIndex);
    }
  }, [playback.currentIndex, playback.isPlaying, setSelectedIndex]);

  const handleUpload = async (file: File) => {
    setIsLoading(true);
    try {
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

  return (
    <div className="app-shell" ref={shellRef}>
      <TopToolbar
        onUpload={handleUpload}
        viewMode={viewMode}
        setViewMode={setViewMode}
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
        pointSize={pointSize}
        setPointSize={setPointSize}
        pointStride={pointStride}
        setPointStride={setPointStride}
        zScale={zScale}
        setZScale={setZScale}
        autoFollowMode={autoFollowMode}
        setAutoFollowMode={setAutoFollowMode}
        frontFollowMode={frontFollowMode}
        setFrontFollowMode={setFrontFollowMode}
        isFullscreen={isFullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />

      <div className="main-layout">
        <section className="viewer-panel">
          {viewMode === "2d" ? (
            <Viewer2D
              points={points}
              smoothedTrack={smoothedTrack}
              selectedIndex={selectedIndex}
              currentIndex={playback.currentIndex}
              isPlaying={playback.isPlaying}
              autoFollowMode={autoFollowMode}
              frontFollowMode={frontFollowMode}
              mapProvider={mapProvider}
              mapStyle={mapStyle}
              pointSize={pointSize}
              pointStride={pointStride}
              onSelect={handlePointSelect}
            />
          ) : (
            <Viewer3D
              points={points}
              altitudeMode={altitudeMode}
              mapProvider={mapProvider}
              mapStyle={mapStyle}
              zScale={zScale}
              selectedIndex={selectedIndex}
              currentIndex={playback.currentIndex}
              isPlaying={playback.isPlaying}
              autoFollowMode={autoFollowMode}
              frontFollowMode={frontFollowMode}
              pointSize={pointSize}
              pointStride={pointStride}
              onSelect={handlePointSelect}
            />
          )}

          {points.length === 0 ? (
            <div className="empty-overlay">
              <div>{isLoading ? "Parsing CSV..." : t("app.empty")}</div>
            </div>
          ) : null}

          {errors.length > 0 ? (
            <div className="warning-badge">{`${errors.length} parse warnings`}</div>
          ) : null}
        </section>

        <PointDetailPanel point={activeDetailPoint} language={language} />
      </div>

      <PlaybackBar
        total={points.length}
        currentIndex={playback.currentIndex}
        isPlaying={playback.isPlaying}
        speed={playback.speed}
        currentTimestamp={points[playback.currentIndex]?.timestampMs ?? null}
        startTimestamp={points[0]?.timestampMs ?? null}
        endTimestamp={points[points.length - 1]?.timestampMs ?? null}
        onPrev={() => {
          const next = Math.max(playback.currentIndex - 1, 0);
          setCurrentIndex(next);
          setSelectedIndex(next);
        }}
        onPlayPause={handlePlayPause}
        onNext={() => {
          const next = Math.min(playback.currentIndex + 1, Math.max(points.length - 1, 0));
          setCurrentIndex(next);
          setSelectedIndex(next);
        }}
        onSpeedChange={setSpeed}
        onSeek={(index) => {
          setCurrentIndex(index);
          setSelectedIndex(index);
        }}
      />
    </div>
  );
}
