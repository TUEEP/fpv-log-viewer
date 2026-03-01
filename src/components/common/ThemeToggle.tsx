import type { ThemeMode } from "../../types/flight";

interface ThemeToggleProps {
  value: ThemeMode;
  darkLabel: string;
  lightLabel: string;
  onChange: (next: ThemeMode) => void;
}

export function ThemeToggle({ value, darkLabel, lightLabel, onChange }: ThemeToggleProps) {
  return (
    <div className="segmented-control">
      <button
        className={`segment ${value === "dark" ? "active" : ""}`}
        type="button"
        onClick={() => onChange("dark")}
      >
        {darkLabel}
      </button>
      <button
        className={`segment ${value === "light" ? "active" : ""}`}
        type="button"
        onClick={() => onChange("light")}
      >
        {lightLabel}
      </button>
    </div>
  );
}
