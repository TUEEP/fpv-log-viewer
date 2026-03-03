import UploadFileRoundedIcon from "@mui/icons-material/UploadFileRounded";
import { Button } from "@mui/material";
import { useRef } from "react";

interface UploadButtonProps {
  label: string;
  onFileSelected: (file: File) => void;
}

export function UploadButton({ label, onFileSelected }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <Button
        variant="contained"
        size="small"
        startIcon={<UploadFileRoundedIcon fontSize="small" />}
        onClick={() => inputRef.current?.click()}
      >
        {label}
      </Button>
      <input
        ref={inputRef}
        className="hidden-file-input"
        type="file"
        accept=".csv,text/csv"
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
