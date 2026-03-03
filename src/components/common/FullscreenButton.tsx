import FullscreenExitRoundedIcon from "@mui/icons-material/FullscreenExitRounded";
import FullscreenRoundedIcon from "@mui/icons-material/FullscreenRounded";
import { Button } from "@mui/material";

interface FullscreenButtonProps {
  label: string;
  isFullscreen: boolean;
  onToggle: () => void;
}

export function FullscreenButton({ label, isFullscreen, onToggle }: FullscreenButtonProps) {
  return (
    <Button
      variant={isFullscreen ? "contained" : "outlined"}
      color={isFullscreen ? "secondary" : "primary"}
      size="small"
      startIcon={isFullscreen ? <FullscreenExitRoundedIcon /> : <FullscreenRoundedIcon />}
      onClick={onToggle}
    >
      {label}
    </Button>
  );
}
