import {
  Box,
  Paper,
  Typography
} from "@mui/material";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { formatPointForPanel } from "../../lib/panel/formatPointForPanel";
import type { FlightPoint, Language } from "../../types/flight";

interface PointDetailPanelProps {
  point: FlightPoint | null;
  language: Language;
}

export function PointDetailPanel({ point, language }: PointDetailPanelProps) {
  const { t } = useTranslation();

  const formatted = useMemo(() => {
    if (!point) {
      return null;
    }
    return formatPointForPanel(point, language);
  }, [point, language]);

  if (!point || !formatted) {
    return (
      <Paper
        component="aside"
        variant="outlined"
        sx={{
          minWidth: 0,
          minHeight: 0,
          borderRadius: 1.5,
          p: 1.4,
          display: "flex",
          flexDirection: "column",
          gap: 1
        }}
      >
        <Typography variant="subtitle1" fontWeight={700}>
          {t("panel.title")}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t("panel.noData")}
        </Typography>
      </Paper>
    );
  }

  const summaryRows = [
    { label: t("panel.time"), value: formatted.summary.time },
    { label: t("panel.latlon"), value: formatted.summary.latLon },
    { label: t("panel.distance"), value: formatted.summary.distance },
    { label: t("panel.altitude"), value: formatted.summary.altitude },
    { label: t("panel.speed"), value: formatted.summary.speed },
    { label: t("panel.voltage"), value: formatted.summary.voltage },
    { label: t("panel.current"), value: formatted.summary.current },
    { label: t("panel.satellites"), value: formatted.summary.satellites },
    { label: t("panel.mode"), value: formatted.summary.mode }
  ];

  return (
    <Paper
      component="aside"
      variant="outlined"
      sx={{
        minWidth: 0,
        minHeight: 0,
        borderRadius: 1.5,
        p: 1.4,
        display: "flex",
        flexDirection: "column",
        gap: 1
      }}
    >
      <Typography variant="subtitle1" fontWeight={700}>
        {t("panel.title")}
      </Typography>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(86px, auto) minmax(0, 1fr)",
          gap: "6px 8px"
        }}
      >
        {summaryRows.map((row) => (
          <Box
            key={row.label}
            sx={{
              display: "contents"
            }}
          >
            <Typography variant="caption" color="text.secondary">
              {row.label}
            </Typography>
            <Typography variant="caption" textAlign="right" sx={{ wordBreak: "break-all" }}>
              {row.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
