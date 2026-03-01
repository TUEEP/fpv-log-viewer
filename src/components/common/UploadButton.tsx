import { useRef } from "react";

interface UploadButtonProps {
  label: string;
  onFileSelected: (file: File) => void;
}

export function UploadButton({ label, onFileSelected }: UploadButtonProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        className="control-button"
        onClick={() => inputRef.current?.click()}
        type="button"
      >
        {label}
      </button>
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
