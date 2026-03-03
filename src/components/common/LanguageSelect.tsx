import { MenuItem, Select } from "@mui/material";
import type { Language } from "../../types/flight";

interface LanguageSelectProps {
  value: Language;
  onChange: (language: Language) => void;
}

export function LanguageSelect({ value, onChange }: LanguageSelectProps) {
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value as Language)}
      sx={{ minWidth: 112 }}
    >
      <MenuItem value="zh-CN">中文</MenuItem>
      <MenuItem value="en">English</MenuItem>
      <MenuItem value="ja">日本語</MenuItem>
    </Select>
  );
}
