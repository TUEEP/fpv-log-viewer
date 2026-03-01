interface FullscreenButtonProps {
  label: string;
  isFullscreen: boolean;
  onToggle: () => void;
}

export function FullscreenButton({ label, isFullscreen, onToggle }: FullscreenButtonProps) {
  return (
    <button
      className={`control-button ${isFullscreen ? "active" : ""}`}
      type="button"
      onClick={onToggle}
    >
      {label}
    </button>
  );
}
