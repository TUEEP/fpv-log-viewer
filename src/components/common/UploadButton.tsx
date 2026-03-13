import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { Button } from "@mui/material";
import { useId } from "react";

interface UploadButtonProps {
  label: string;
  onFileSelected: (file: File) => void;
}

export function UploadButton({ label, onFileSelected }: UploadButtonProps) {
  const inputId = useId();
  const triggerId = `${inputId}-trigger`;

  return (
    <>
      <Button
        component="label"
        htmlFor={inputId}
        id={triggerId}
        variant="contained"
        size="small"
        startIcon={<UploadFileRoundedIcon fontSize="small" />}
      >
        {label}
      </Button>
      <input
        id={inputId}
        className="hidden-file-input"
        type="file"
        accept=".csv,text/csv"
        aria-labelledby={triggerId}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) {
            onFileSelected(file);
          }
          event.currentTarget.value = "";
        }}
      />
    </>
  );
}
