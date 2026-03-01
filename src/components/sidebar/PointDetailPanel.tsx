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
      <aside className="detail-panel">
        <div className="panel-title">{t("panel.title")}</div>
        <div className="empty-panel">{t("panel.noData")}</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <div className="panel-title">{t("panel.title")}</div>
      <dl className="summary-list">
        <div className="summary-row">
          <dt>{t("panel.time")}</dt>
          <dd>{formatted.summary.time}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.latlon")}</dt>
          <dd>{formatted.summary.latLon}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.distance")}</dt>
          <dd>{formatted.summary.distance}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.altitude")}</dt>
          <dd>{formatted.summary.altitude}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.speed")}</dt>
          <dd>{formatted.summary.speed}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.voltage")}</dt>
          <dd>{formatted.summary.voltage}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.current")}</dt>
          <dd>{formatted.summary.current}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.satellites")}</dt>
          <dd>{formatted.summary.satellites}</dd>
        </div>
        <div className="summary-row">
          <dt>{t("panel.mode")}</dt>
          <dd>{formatted.summary.mode}</dd>
        </div>
      </dl>

      <div className="field-table-wrap">
        <table className="field-table">
          <thead>
            <tr>
              <th>{t("panel.field")}</th>
              <th>{t("panel.value")}</th>
            </tr>
          </thead>
          <tbody>
            {formatted.rows.map((row) => (
              <tr key={row.field}>
                <td>{row.field}</td>
                <td>{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
